"""Connect any project folder and manage the local Project Hub."""

import argparse
from http.cookiejar import CookieJar
from http.client import RemoteDisconnected
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

from init import ROOT, initialize

sys.path.insert(0, str(ROOT))
from project_hub.projects import ProjectError, Projects
from project_hub.server import VERSION

URL = 'http://127.0.0.1:18791'


def http(path, token=None, body=None):
    request = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def stop_hub():
    environment = initialize()
    health = http('/health')
    if health.get('service') != 'jarvis-project-hub':
        raise RuntimeError('The listener is not Project Hub.')
    http('/api/tool', environment['JARVIS_PROJECT_TOKEN'], {'action': 'list'})
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    with browser.open(URL + '/', timeout=3):
        pass
    request = urllib.request.Request(URL + '/api/shutdown', data=b'{}',
        headers={'Content-Type': 'application/json', 'Origin': URL})
    try:
        with browser.open(request, timeout=5):
            pass
    except urllib.error.HTTPError as error:
        result = json.load(error)
        raise RuntimeError(result.get('error', 'Project Hub refused shutdown.')) from error
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            http('/health')
            time.sleep(.2)
        except (urllib.error.URLError, ConnectionResetError, RemoteDisconnected):
            return
    raise RuntimeError('Project Hub did not stop before the shutdown deadline.')


def ensure_running(restart=False):
    env = initialize()
    try:
        health = http('/health')
    except (urllib.error.URLError, ConnectionResetError, RemoteDisconnected) as error:
        if isinstance(error, urllib.error.HTTPError):
            raise RuntimeError('Port 18791 is occupied by an unexpected service.') from error
        health = None
    if health:
        if health.get('service') != 'jarvis-project-hub':
            raise RuntimeError('Port 18791 is occupied by an unrelated service.')
        http('/api/tool', env['JARVIS_PROJECT_TOKEN'], {'action': 'list'})
        if not restart and health.get('version') == VERSION:
            return health
        stop_hub()
    (ROOT / 'logs').mkdir(exist_ok=True)
    with (ROOT / 'logs/project-hub.log').open('a', encoding='utf-8') as log:
        flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == 'nt' else 0
        process = subprocess.Popen([sys.executable, '-u', '-m', 'project_hub.server'], cwd=ROOT,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags, close_fds=True)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Project Hub exited with {process.returncode}. Check logs/project-hub.log.')
        try:
            health = http('/health')
            if health.get('service') == 'jarvis-project-hub' and health.get('pid') == process.pid:
                http('/api/tool', env['JARVIS_PROJECT_TOKEN'], {'action': 'list'})
                return health
        except (urllib.error.URLError, ConnectionResetError, RemoteDisconnected):
            pass
        time.sleep(.25)
    raise RuntimeError('Project Hub did not become ready. Check logs/project-hub.log.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    connect = commands.add_parser('connect', help='Connect a project folder.')
    connect.add_argument('path', nargs='?')
    connect.add_argument('--name', required=True)
    connect.add_argument('--root', action='append', default=[], help='label=absolute-path; repeat for multiple folders')
    commands.add_parser('list')
    commands.add_parser('open')
    commands.add_parser('start')
    commands.add_parser('restart')
    commands.add_parser('stop')
    commands.add_parser('status')
    args = parser.parse_args()
    env = initialize()
    if args.command in ('connect', 'list'):
        projects = Projects(ROOT / 'runtime/project-hub.sqlite')
        if args.command == 'list':
            print(json.dumps(projects.list(), indent=2, ensure_ascii=False))
        else:
            roots = [{'path': args.path}] if args.path else []
            for item in args.root:
                label, separator, path = item.partition('=')
                if not separator:
                    raise ProjectError('--root must use label=path.')
                roots.append({'label': label, 'path': path})
            project = projects.connect(args.name, roots)
            print(f'Connected {project["name"]} ({project["id"]}) with {len(project["roots"])} folder(s).')
    elif args.command in ('open', 'start', 'restart'):
        health = ensure_running(restart=args.command == 'restart')
        print(f'Project Hub ready at {URL} (PID {health["pid"]}).')
        if args.command == 'open':
            webbrowser.open(URL)
    elif args.command == 'status':
        print(json.dumps(http('/health'), indent=2))
    elif args.command == 'stop':
        stop_hub()
        print('Project Hub stopped. Connections are preserved.')


if __name__ == '__main__':
    try:
        main()
    except (ProjectError, OSError, ValueError, RuntimeError) as error:
        print(f'Project connection failed: {error}', file=sys.stderr)
        raise SystemExit(1)
