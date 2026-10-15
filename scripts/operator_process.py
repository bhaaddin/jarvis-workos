"""Start/status/gracefully stop the owned local operational service."""
import argparse
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

from init import ROOT, read_env
from owned_process import creation_time, lifecycle_lock

URL = 'http://127.0.0.1:18801'
STATE = ROOT / 'runtime/operator-process.json'


def health():
    try:
        with urllib.request.urlopen(URL + '/health', timeout=3) as response:
            return json.load(response)
    except OSError:
        return None


def stop():
    current = health()
    if current is None:
        return
    if current.get('service') != 'jarvis-operator' or not STATE.is_file():
        raise RuntimeError('No owned operator listener is recorded; existing listener was preserved.')
    recorded = json.loads(STATE.read_text())
    if current.get('pid') != recorded.get('pid'):
        raise RuntimeError('The listener identity changed; it was preserved.')
    env = read_env()
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    headers = {'Content-Type': 'application/json', 'Origin': env.get('JARVIS_PUBLIC_ORIGIN', URL)}
    with browser.open(urllib.request.Request(URL + '/api/auth/login', data=json.dumps({'login': 'matko', 'password': env['JARVIS_OPERATOR_ADMIN_PASSWORD']}).encode(), headers=headers), timeout=8) as response:
        csrf = json.load(response)['csrf']
    try:
        with browser.open(urllib.request.Request(URL + '/api/admin/shutdown', data=b'{}', headers={**headers, 'X-CSRF-Token': csrf}), timeout=8):
            pass
    except urllib.error.HTTPError as error:
        detail = json.load(error).get('error', {})
        raise RuntimeError(detail.get('message', 'The operator refused shutdown.')) from None
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        if health() is None:
            STATE.unlink(missing_ok=True)
            return
        time.sleep(.5)
    raise RuntimeError('Graceful shutdown did not finish; active work was not forcibly killed.')


def start():
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js24 is required. Run python -B scripts/dev.py doctor.')
    build = subprocess.run([node, str(ROOT / 'scripts/build-stamp.mjs'), 'check', 'operator'],
                           capture_output=True, text=True, timeout=30, check=False)
    if build.returncode:
        raise RuntimeError('The operator build is missing or stale. Run python -B scripts/dev.py setup.')
    current = health()
    if current:
        if current.get('service') != 'jarvis-operator':
            raise RuntimeError('Port 18801 belongs to another service.')
        if current.get('buildSource') != json.loads(build.stdout).get('source'):
            raise RuntimeError('The running operator is using an older build. Run python -B scripts/operator_process.py restart when its work is idle.')
        return current
    if not node or not (ROOT / 'operator/dist/main.js').is_file():
        raise RuntimeError('Build the operator before starting it.')
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(('127.0.0.1', 18801))
    folder = ROOT / 'logs' / ('operator-service-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir()
    STATE.parent.mkdir(exist_ok=True)
    with (folder / 'service.log').open('ab') as output:
        process = subprocess.Popen([node, str(ROOT / 'operator/dist/main.js')], cwd=ROOT / 'operator',
            stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    STATE.write_text(json.dumps({'pid': process.pid, 'created': creation_time(int(process._handle)), 'logs': str(folder)}, indent=2))
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Operator exited ({process.returncode}); inspect {folder / "service.log"}.')
        current = health()
        if current and current.get('service') == 'jarvis-operator' and current.get('pid') == process.pid:
            return current
        time.sleep(.3)
    raise RuntimeError(f'Operator readiness timed out; inspect {folder / "service.log"}.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'stop', 'restart', 'status'])
    command = parser.parse_args().command
    try:
        with lifecycle_lock(ROOT / 'runtime/operator-lifecycle'):
            if command in ('stop', 'restart'):
                stop()
            if command in ('start', 'restart'):
                print(json.dumps(start()))
            elif command == 'status':
                print(json.dumps(health()))
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(f'Operator lifecycle: {error}') from None
