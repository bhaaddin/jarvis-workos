"""Start a temporary authenticated notebook call link; credentials stay on this PC."""

import argparse
import base64
from datetime import datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

from init import ROOT
from projects import ensure_running
from owned_process import creation_time, lifecycle_lock, retire

VERSION = '2026.9.3'
DIGEST = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'
CONFIG = ROOT / 'runtime/notebook-call.json'
PORT = 18794
MARKER = '<!-- JARVIS generated notebook access -->'
ACCESS = Path.home() / 'Desktop/JARVIS Notebook Access.html'


def save_config(value):
    temporary = CONFIG.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    temporary.replace(CONFIG)


def request(config, url, timeout=10):
    authorization = base64.b64encode((config['username'] + ':' + config['password']).encode()).decode()
    return urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Basic ' + authorization}), timeout=timeout)


def access_page(config):
    if ACCESS.exists() and MARKER not in ACCESS.read_text(encoding='utf-8'):
        raise RuntimeError('The Desktop access-page name is already in use by another file.')
    expiry = datetime.fromtimestamp(config['expires']).strftime('%Y-%m-%d %H:%M')
    ACCESS.write_text(f'''<!doctype html>{MARKER}<html><meta charset="utf-8"><title>JARVIS — open on your notebook</title>
<style>body{{font:18px system-ui;background:#0b1320;color:#e5ecf5;max-width:850px;margin:7vh auto;padding:30px}}h1{{color:#8ae1c1}}input{{display:block;width:100%;box-sizing:border-box;padding:14px;margin:10px 0 25px;background:#142338;color:white;border:1px solid #536d8d;border-radius:8px;font:17px monospace}}p{{line-height:1.7}}small{{color:#a1b1c8}}label{{font-weight:600}}</style>
<h1>Use JARVIS from your notebook</h1>
<p>Copy this address out of TeamViewer. Open it in <strong>Chrome or Edge on your own notebook</strong>.
Your notebook supplies the microphone and speakers; this PC runs JARVIS.</p>
<label>1. Address — select and copy</label><input readonly onclick="this.select()" value="{html.escape(config['url'] + ('/#operator' if config.get('operator_enabled') else '/#assistant'), quote=True)}">
<label>2. Username</label><input readonly onclick="this.select()" value="{html.escape(config['username'], quote=True)}">
<label>3. Password — enter in the browser sign-in prompt</label><input readonly onclick="this.select()" value="{html.escape(config['password'], quote=True)}">
<p>Type a job, attach a document, download results, or press <strong>Call JARVIS</strong> and allow microphone access on the notebook.</p>
<small>This authenticated test link uses the Cloudflare relay and expires {expiry} (PC local time).
Keep this PC and JARVIS running. Treat the password as private. Run JARVIS Notebook again if the link expires.</small></html>''', encoding='utf-8')


def binary():
    tools = ROOT / 'runtime/tools'
    tools.mkdir(exist_ok=True)
    path = tools / f'cloudflared-{VERSION}.exe'
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == DIGEST:
        return path
    url = f'https://github.com/cloudflare/cloudflared/releases/download/{VERSION}/cloudflared-windows-amd64.exe'
    print('Downloading pinned Cloudflare connector from its official release...', flush=True)
    with urllib.request.urlopen(url, timeout=90) as response:
        data = response.read(70 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != DIGEST:
        raise RuntimeError('Cloudflare connector SHA-256 did not match the published release.')
    path.write_bytes(data)
    return path


def start(open_page, tasks=False):
    if tasks:
        # A healthy Node listener is not a warm brain. Use the native startup
        # path so the first spoken request does not pay the model's cold load.
        from dev import up
        up(voice=True)
    else:
        ensure_running()
    if CONFIG.exists():
        existing = json.loads(CONFIG.read_text(encoding='utf-8'))
        if not existing.get('call_secret'):
            existing['call_secret'] = secrets.token_hex(32)
            save_config(existing)
        if existing.get('expires', 0) > time.time() and existing.get('url') and existing.get('operator_enabled', False) == tasks:
            try:
                with request(existing, existing['url'] + '/health', 15) as response:
                    if json.load(response).get('service') == 'jarvis-notebook-relay':
                        access_page(existing)
                        if open_page: webbrowser.open(ACCESS.as_uri())
                        print(f'Notebook link is ready: {existing["url"]}\nSign-in details: {ACCESS}')
                        return
            except (OSError, ValueError):
                pass
        stop()
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(('127.0.0.1', PORT))
    connector = binary()
    config = {'username': 'jarvis', 'password': secrets.token_urlsafe(24),
               'url': '', 'expires': time.time() + 8 * 3600, 'operator_enabled': tasks, 'relay_pid': None, 'tunnel_pid': None,
               'call_secret': secrets.token_hex(32)}
    save_config(config)
    stamp = datetime.now().strftime('%Y%m%dT%H%M%S%f')
    logs = ROOT / 'logs' / ('notebook-' + stamp)
    logs.mkdir()
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    relay = tunnel = None
    try:
        with (logs / 'relay.log').open('ab') as log:
            relay = subprocess.Popen([sys.executable, '-u', '-m', 'project_hub.remote_call', '--config', str(CONFIG)],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags)
        config['relay_pid'] = relay.pid
        config['relay_created'] = creation_time(int(relay._handle))
        save_config(config)
        local_deadline = time.monotonic() + 15
        while time.monotonic() < local_deadline:
            if relay.poll() is not None:
                raise RuntimeError('Notebook relay exited before readiness.')
            try:
                with request(config, f'http://127.0.0.1:{PORT}/health', 1) as response:
                    if json.load(response).get('pid') == relay.pid:
                        break
            except (OSError, ValueError):
                pass
            time.sleep(.2)
        else:
            raise RuntimeError('Notebook relay did not become ready.')
        tunnel_log = logs / 'tunnel.log'
        with tunnel_log.open('ab') as log:
            tunnel = subprocess.Popen([str(connector), 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{PORT}', '--protocol', 'http2'],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags)
        config['tunnel_pid'] = tunnel.pid
        config['tunnel_created'] = creation_time(int(tunnel._handle))
        save_config(config)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if relay.poll() is not None or tunnel.poll() is not None:
                raise RuntimeError('A notebook connector exited; inspect its retained logs.')
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', tunnel_log.read_text(encoding='utf-8', errors='replace'))
            if match:
                config['url'] = match[0]
                save_config(config)
                try:
                    with request(config, config['url'] + '/health', 8) as response:
                        if json.load(response).get('service') == 'jarvis-notebook-relay':
                            break
                except (OSError, ValueError):
                    pass
            time.sleep(2)
        else:
            raise RuntimeError('The public HTTPS notebook link did not become ready in 90 seconds.')
        access_page(config)
        if open_page: webbrowser.open(ACCESS.as_uri())
        print(f'Notebook link ready: {config["url"]}\nSign-in details: {ACCESS}\nLogs: {logs}')
    except BaseException:
        config['expires'] = 0
        save_config(config)
        failed = False
        for process in (tunnel, relay):
            try:
                if process and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                failed = True
        if not failed:
            CONFIG.unlink(missing_ok=True)
        raise


def stop():
    if not CONFIG.exists():
        print('No notebook test link is configured.')
        return
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    # Revoke before stopping only the processes whose creation times we recorded.
    config['expires'] = 0
    save_config(config)
    failed = False
    for role in ('tunnel', 'relay'):
        try:
            retire(config.get(role + '_pid'), config.get(role + '_created'))
        except (OSError, RuntimeError):
            failed = True
    if ACCESS.exists() and MARKER in ACCESS.read_text(encoding='utf-8'):
        ACCESS.unlink()
    if failed:
        raise RuntimeError('Access was revoked; a connector could not be retired safely. Its config was retained.')
    CONFIG.unlink(missing_ok=True)
    print('Notebook connection stopped and generated sign-in details removed.')


def reload_relay():
    """Update the loopback relay without changing the notebook URL or credential."""
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    if config['expires'] <= time.time():
        raise RuntimeError('The notebook link expired. Start a new link instead.')
    retire(config.get('relay_pid'), config.get('relay_created'))
    folder = ROOT / 'logs' / ('notebook-reload-' + datetime.now().strftime('%Y%m%dT%H%M%S%f'))
    folder.mkdir()
    with (folder / 'relay.log').open('ab') as log:
        relay = subprocess.Popen([sys.executable, '-u', '-m', 'project_hub.remote_call', '--config', str(CONFIG)],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    config['relay_pid'] = relay.pid
    config['relay_created'] = creation_time(int(relay._handle))
    save_config(config)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if relay.poll() is not None:
            raise RuntimeError('Reloaded notebook relay exited.')
        try:
            with request(config, f'http://127.0.0.1:{PORT}/health', 1) as response:
                if json.load(response).get('pid') == relay.pid:
                    print('Notebook relay updated; existing URL and sign-in preserved.')
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError('Reloaded notebook relay did not become ready.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('start', 'stop', 'install', 'reload-relay'))
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--tasks', action='store_true', help='Expose the authenticated task UI and its scoped API as well as calls.')
    args = parser.parse_args()
    try:
        with lifecycle_lock(ROOT):
            if args.command == 'install':
                print(f'Verified connector: {binary()}')
            elif args.command == 'start':
                start(args.open, args.tasks)
            elif args.command == 'reload-relay':
                reload_relay()
            else:
                stop()
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Notebook connection failed: {error}', file=sys.stderr)
        raise SystemExit(1)
