"""JARVIS 24/7 watchdog: keep operator, hub, Telegram bridge and the call link alive.

check  -> report only, exit 0 when everything is up, 1 otherwise.
repair -> start whatever is missing, refresh an expiring call link, then report.

Designed for Windows Task Scheduler: one task at logon plus a 15-minute
repetition, both running `python -B scripts/jarvis_watchdog.py repair`.
Overlapping runs refuse via a PID lock. Repairs never stop healthy services
and never touch credentials. The PC itself must stay awake; sleep/hibernate
still kills everything (see power guidance in the report).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from init import ROOT

STATE = ROOT / 'runtime' / 'watchdog'
LOCK_FILE = STATE / 'watchdog.pid'
OPERATOR = 'http://127.0.0.1:18801'
HUB = 'http://127.0.0.1:18791'
CALL_FILE = ROOT / 'runtime' / 'notebook-call.json'
CALL_REFRESH_BEFORE = 2 * 3600
PYTHON = sys.executable


def check_url(url: str, timeout: int = 5) -> bool:
    try:
        return urllib.request.urlopen(url, timeout=timeout).status == 200
    except OSError:
        return False


def process_running(pid: int) -> bool:
    if pid <= 1:
        return False
    try:
        import csv
        import io
        result = subprocess.run(
            ['tasklist.exe', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'],
            capture_output=True, text=True, errors='replace', timeout=15)
    except OSError:
        return False
    return any(len(row) > 1 and row[1].strip() == str(pid)
               for row in csv.reader(io.StringIO(result.stdout)))


def take_lock() -> bool:
    STATE.mkdir(parents=True, exist_ok=True)
    try:
        pid = int(LOCK_FILE.read_text(encoding='utf-8').strip())
        if process_running(pid):
            return False
    except (OSError, ValueError):
        pass
    LOCK_FILE.write_text(str(os.getpid()), encoding='utf-8')
    return True


def launch_detached(args: list[str]) -> bool:
    try:
        subprocess.Popen([PYTHON, '-B'] + args, cwd=ROOT, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                         creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0))
        return True
    except OSError:
        return False


def run_once(args: list[str], timeout: int = 120) -> tuple[bool, str]:
    try:
        result = subprocess.run([PYTHON, '-B'] + args, cwd=ROOT, capture_output=True,
                                text=True, errors='replace', timeout=timeout)
        return result.returncode == 0, (result.stdout + result.stderr)[-500:]
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)[:200]


def bridge_pid() -> int:
    try:
        sys.path.insert(0, str(ROOT / 'scripts'))
        import telegram_bridge as bridge
        return int(bridge.PID_FILE.read_text(encoding='utf-8').strip())
    except (OSError, ValueError, ImportError):
        return 0


def call_expires_in() -> float | None:
    try:
        return float(json.loads(CALL_FILE.read_text(encoding='utf-8')).get('expires') or 0) - time.time()
    except (OSError, ValueError):
        return None


def call_link_works() -> bool:
    """End-to-end: mint a one-click token and load the public page through the tunnel."""
    try:
        sys.path.insert(0, str(ROOT))
        from project_hub.remote_call import mint_call_token
        config = json.loads(CALL_FILE.read_text(encoding='utf-8'))
        url, secret = str(config.get('url') or ''), str(config.get('call_secret') or '')
        if not url or not secret or float(config.get('expires') or 0) <= time.time():
            return False
        target = url.rstrip('/') + '/?call=' + mint_call_token(secret)
        with urllib.request.urlopen(target, timeout=25) as response:
            return response.status == 200 and 'jarvis-remote-call' in response.read(200000).decode('utf-8', 'replace')
    except Exception:
        return False


def check() -> dict:
    return {'operator': check_url(OPERATOR + '/health'),
            'hub': check_url(HUB + '/health'),
            'bridge': process_running(bridge_pid()),
            'call_seconds_left': call_expires_in()}


def repair(report: dict) -> dict:
    fixed = []
    if not report['operator']:
        ok, _ = run_once(['scripts/operator_process.py', 'restart'], timeout=180)
        time.sleep(5)
        report['operator'] = check_url(OPERATOR + '/health')
        if report['operator']:
            fixed.append('operator restarted')
    if not report['hub']:
        ok, _ = run_once(['scripts/projects.py', 'start'], timeout=120)
        time.sleep(8)
        report['hub'] = check_url(HUB + '/health')
        if report['hub']:
            fixed.append('hub started')
    if not report['bridge']:
        if launch_detached(['scripts/telegram_bridge.py', 'run']):
            time.sleep(8)
            report['bridge'] = process_running(bridge_pid())
            if report['bridge']:
                fixed.append('telegram bridge started')
    left = call_expires_in()
    link_ok = call_link_works()
    if link_ok is False:
        time.sleep(20)
        link_ok = call_link_works()
    if left is None or left < CALL_REFRESH_BEFORE or not link_ok:
        if left is not None and left >= CALL_REFRESH_BEFORE:
            run_once(['scripts/remote_call.py', 'stop'], timeout=120)
        ok, _ = run_once(['scripts/remote_call.py', 'start', '--tasks'], timeout=180)
        left = call_expires_in()
        report['call_seconds_left'] = left
        if left is not None and left > 0 and call_link_works():
            fixed.append('call link refreshed')
        elif left is not None and left > 0:
            fixed.append('call link renewed (page check flaky, tunnel may need a minute)')
    else:
        report['call_seconds_left'] = left
    report['fixed'] = fixed
    return report


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if mode not in ('check', 'repair'):
        print('Usage: jarvis_watchdog.py [check|repair]')
        return 2
    if not take_lock():
        print(json.dumps({'skipped': 'another watchdog run is active'}))
        return 0
    try:
        report = check()
        if mode == 'repair':
            report = repair(report)
        report['ok'] = bool(report['operator'] and report['hub'] and report['bridge'])
        print(json.dumps(report, indent=2))
        return 0 if report['ok'] else 1
    finally:
        LOCK_FILE.unlink(missing_ok=True)


if __name__ == '__main__':
    raise SystemExit(main())
