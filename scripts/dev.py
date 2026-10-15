"""Focused JARVIS setup, diagnostics, verification and resource management."""
import argparse
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from init import ROOT, initialize, read_env
from setup_table_engine import inspect_engine, install_engine


def execute(args, cwd=ROOT, timeout=30):
    return subprocess.run([str(value) for value in args], cwd=cwd, capture_output=True, text=True,
                          timeout=timeout, check=False)


def node_commands():
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Install Node.js24.16–24.x before setup.')
    version = execute([node, '--version'])
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)\s*', version.stdout)
    if version.returncode or not match or int(match[1]) != 24 or int(match[2]) < 16:
        raise RuntimeError('This operator requires Node.js24.16–24.x.')
    npm = Path(node).resolve().parent / 'node_modules/npm/bin/npm-cli.js'
    if not npm.is_file():
        raise RuntimeError('Install the standard Node.js distribution including npm.')
    return node, str(npm), version.stdout.strip()


def python_worker():
    return ROOT / 'operator/.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')


def request_json(url, payload=None, timeout=5):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password:
        raise RuntimeError('Diagnostics use only reviewed loopback endpoints.')
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def gpu_status():
    try:
        result = execute(['nvidia-smi', '--query-gpu=memory.total,memory.used,memory.free,utilization.gpu,power.draw,temperature.gpu',
                          '--format=csv,noheader,nounits'], timeout=10)
        if result.returncode:
            return {'available': False}
        values = result.stdout.strip().splitlines()[0].split(',')
        keys = ('totalMiB', 'usedMiB', 'freeMiB', 'utilizationPercent', 'powerWatts', 'temperatureC')
        return {'available': True, **{key: float(value.strip()) if re.fullmatch(r'\d+(?:\.\d+)?', value.strip()) else None for key, value in zip(keys, values)}}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return {'available': False}


def private_config_status(values):
    required = ('JARVIS_OPERATOR_GATEWAY_TOKEN', 'JARVIS_OPERATOR_DATA_KEY', 'JARVIS_OPERATOR_ADMIN_PASSWORD',
                'JARVIS_OPERATOR_CALLBACK_KEY', 'JARVIS_PROJECT_TOKEN', 'JARVIS_VOICE_TOKEN')
    missing = [name for name in required if not values.get(name) or values[name].startswith('__')]
    invalid = []
    for name in required:
        if name in missing:
            continue
        value = values[name]
        if name in ('JARVIS_OPERATOR_DATA_KEY', 'JARVIS_OPERATOR_CALLBACK_KEY'):
            valid = re.fullmatch(r'[0-9a-fA-F]{64}', value) is not None
        else:
            valid = len(value) >= (16 if name == 'JARVIS_OPERATOR_ADMIN_PASSWORD' else 32)
        if not valid:
            invalid.append(name)
    return {'missingNames': missing, 'invalidNames': invalid}


class Evidence:
    def __init__(self, name):
        self.folder = ROOT / 'logs' / (name + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        self.folder.mkdir(parents=True)
        self.checks = []

    def run(self, name, command, cwd=ROOT, timeout=600):
        began = time.monotonic()
        target = self.folder / (name + '.log')
        with target.open('w', encoding='utf-8') as log:
            log.write('Command: ' + subprocess.list2cmdline([str(value) for value in command]) + '\n\n')
            log.flush()
            try:
                result = subprocess.run([str(value) for value in command], cwd=cwd, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=timeout, check=False)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
            log.write('\nExit code: ' + str(code) + '\n')
        self.checks.append({'name': name, 'exitCode': code, 'seconds': round(time.monotonic()-began, 3), 'log': str(target)})
        (self.folder / 'results.json').write_text(json.dumps(self.checks, indent=2), encoding='utf-8')
        print(f'{"PASS" if code == 0 else "FAIL"}: {name} -> {target}')
        if code:
            raise RuntimeError(f'{name} failed with exit{code}; inspect its retained log.')


def doctor(offline=False):
    checks = []
    def add(name, ok, detail, fix=None, warning=False):
        checks.append({'name': name, 'status': 'ok' if ok else 'warning' if warning else 'error', 'detail': detail, **({'fix': fix} if fix else {})})
    node = None
    try:
        node, _, version = node_commands()
        add('node', True, version)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        add('node', False, str(error))
    add('host-python', sys.version_info[:2] == (3, 13), '.'.join(map(str, sys.version_info[:3])), 'Use the Python3.13 host launcher.')
    if node:
        for component in ('operator', 'frontend'):
            result = execute([node, ROOT / 'scripts/build-stamp.mjs', 'check', component])
            try:
                state = json.loads(result.stdout)
            except ValueError:
                state = {'code': 'BUILD_CHECK_FAILED'}
            add(component + '-build', result.returncode == 0, state, 'python -B scripts/dev.py setup')
    worker = python_worker()
    if worker.is_file():
        result = execute([worker, '-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'])
        try:
            installed = {item['name'].lower().replace('_', '-'): item['version'] for item in json.loads(result.stdout)}
            expected = dict(line.strip().split('==') for line in (ROOT / 'operator/python/requirements.txt').read_text().splitlines() if line.strip() and not line.startswith('#'))
            mismatch = [name for name, version in expected.items() if installed.get(name.lower().replace('_', '-')) != version]
            add('document-dependencies', result.returncode == 0 and not mismatch, {'mismatchedPackages': mismatch}, 'python -B scripts/dev.py setup')
        except (ValueError, KeyError):
            add('document-dependencies', False, 'Unable to inspect the owned virtual environment.')
    else:
        add('document-dependencies', False, 'The document virtual environment is missing.', 'python -B scripts/dev.py setup')
    try:
        private = private_config_status(read_env())
        add('private-configuration', not private['missingNames'] and not private['invalidNames'], private,
            'Run setup for missing keys; review invalid existing values locally.')
    except OSError:
        add('private-configuration', False, 'Private configuration is missing.', 'python -B scripts/dev.py setup')
    if not offline:
        try:
            docker = execute(['docker', 'info', '--format', '{{.OSType}}'], timeout=15)
            add('docker', docker.returncode == 0 and docker.stdout.strip() == 'linux', 'Linux containers required', 'Start Docker Desktop with Linux containers.')
            engine = inspect_engine()
            add('table-engine', engine['ready'], engine, 'python -B scripts/setup_table_engine.py install')
        except (OSError, subprocess.SubprocessError):
            add('docker', False, 'Docker is unavailable.')
        try:
            model = json.loads((ROOT / 'operator/config/model.json').read_text(encoding='utf-8'))
            if model.get('transport') == 'ollama':
                base = model['baseUrl'].rstrip('/')
                tags = request_json(base + '/api/tags').get('models', [])
                installed = next((item for item in tags if item.get('name') == model['model']), None)
                loaded = next((item for item in request_json(base + '/api/ps').get('models', []) if item.get('name') == model['model']), None)
                add('selected-model', installed is not None, {'name': model['model'], 'installed': bool(installed), 'digest': installed.get('digest') if installed else None}, 'python -B scripts/dev.py setup --models')
                add('model-warmth', loaded is not None, {'loaded': bool(loaded), 'contextTokens': loaded.get('context_length') if loaded else None,
                    'reportedGpuBytes': loaded.get('size_vram') if loaded else None}, 'python -B scripts/warm_operator_model.py', warning=True)
            else:
                add('selected-model', False, 'Use the Gateway diagnostics for this explicitly selected transport.', warning=True)
        except (OSError, ValueError, KeyError, RuntimeError):
            add('selected-model', False, 'The configured model service is unavailable.', 'python -B scripts/operator_brain.py up')
        for name, url in [('operator', 'http://127.0.0.1:18801/health'), ('hub', 'http://127.0.0.1:18791/health'), ('speech', 'http://127.0.0.1:18902/health')]:
            try:
                with urllib.request.urlopen(url, timeout=4) as response:
                    value = json.load(response) if name == 'operator' else None
                add(name, True, 'Responding')
                if name == 'operator' and node:
                    stamp = next((item['detail'] for item in checks if item['name'] == 'operator-build'), {})
                    add('running-build', bool(stamp.get('valid') and value.get('buildSource') == stamp.get('source')),
                        'Compare the running process with the current build', 'python -B scripts/operator_process.py restart')
            except (OSError, ValueError, RuntimeError):
                add(name, False, 'Not responding', 'python -B scripts/start.py --gpu --voice', warning=True)
    return {'ready': not any(item['status'] == 'error' for item in checks), 'offline': offline,
            'checks': checks, **({'gpu': gpu_status()} if not offline else {})}


def setup(models=False):
    if sys.version_info[:2] != (3, 13):
        raise RuntimeError('Run setup with Python3.13.')
    node, npm, _ = node_commands()
    from operator_process import health, start, stop
    from owned_process import lifecycle_lock
    evidence = Evidence('environment-setup')
    with lifecycle_lock(ROOT / 'runtime/operator-lifecycle'):
        was_running = bool(health())
        if was_running:
            stop()  # Refuses active/queued work and preserves unrelated listeners.
        env = initialize()
        import secrets
        additions = []
        for key in ('JARVIS_OPERATOR_GATEWAY_TOKEN', 'JARVIS_OPERATOR_DATA_KEY', 'JARVIS_OPERATOR_ADMIN_PASSWORD', 'JARVIS_OPERATOR_CALLBACK_KEY'):
            if key not in env:
                additions.append(key + '=' + secrets.token_hex(32))
            elif not env[key] or env[key].startswith('__'):
                raise RuntimeError('Existing invalid private configuration was preserved: ' + key)
        if additions:
            with (ROOT / '.env').open('a', encoding='utf-8') as stream:
                stream.write('\n' + '\n'.join(additions) + '\n')
        for component in ('operator', 'frontend'):
            evidence.run(component + '-dependencies', [node, npm, 'ci'], ROOT / component)
        worker = python_worker()
        venv = ROOT / 'operator/.venv'
        if venv.exists() and not (venv / 'pyvenv.cfg').is_file():
            raise RuntimeError('The existing .venv is not a recognized virtual environment; it was preserved.')
        if not worker.is_file():
            evidence.run('document-venv', [sys.executable, '-m', 'venv', venv])
        evidence.run('document-dependencies', [worker, '-m', 'pip', 'install', '--require-virtualenv', '--no-deps', '--disable-pip-version-check', '-r', ROOT / 'operator/python/requirements.txt'])
        evidence.run('document-consistency', [worker, '-m', 'pip', 'check'])
        from start import ensure_docker
        ensure_docker()
        install_engine(runner=evidence.run)
        for component in ('operator', 'frontend'):
            evidence.run(component + '-build', [node, npm, 'run', 'build'], ROOT / component)
        if models:
            evidence.run('model-services', ['docker','compose','--env-file',ROOT / '.env','-f',ROOT / 'operator/compose.model.yaml','up','-d','--wait','--wait-timeout','90'])
            model = json.loads((ROOT / 'operator/config/model.json').read_text())
            if model.get('transport') != 'ollama':
                raise RuntimeError('The optional model installer supports the reviewed native transport only.')
            tags = request_json(model['baseUrl'].rstrip('/') + '/api/tags').get('models', [])
            if not any(item['name'] == model['model'] for item in tags):
                if model['model'] != 'jarvis-qwen3.8:27b-text-gpu':
                    raise RuntimeError('The selected model has no automatic reviewed installation recipe.')
                evidence.run('selected-model-download', [sys.executable, '-B', ROOT / 'scripts/model_upgrade.py', 'pull', 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL', '--base', model['baseUrl']], timeout=3900)
                evidence.run('selected-model-import', [sys.executable, '-B', ROOT / 'scripts/model_upgrade.py', 'create-text-38', '--full-gpu', '--base', model['baseUrl']])
        if was_running:
            start()
    print('Setup complete. Evidence: ' + str(evidence.folder))


def up(voice=False, open_page=False):
    from start import ensure_docker
    from projects import ensure_running
    from operator_process import start
    from owned_process import lifecycle_lock
    node, _, _ = node_commands()
    for component in ('operator', 'frontend'):
        if execute([node, ROOT / 'scripts/build-stamp.mjs', 'check', component]).returncode:
            raise RuntimeError(f'The {component} build is missing or stale. Run python -B scripts/dev.py setup.')
    evidence = Evidence('native-start')
    ensure_docker()
    ensure_running()
    evidence.run('model-service', ['docker','compose','--env-file',ROOT / '.env','-f',ROOT / 'operator/compose.model.yaml','up','-d','--wait','--wait-timeout','90'])
    if not inspect_engine()['ready']:
        raise RuntimeError('Prepare the table engine with python -B scripts/dev.py setup.')
    if voice:
        helper = ROOT.parent / 'Jarvis-Evaluation/scripts/voice_gpu.py'
        if not helper.is_file():
            raise RuntimeError('The configured speech service helper is missing.')
        evidence.run('speech-service', [sys.executable,'-B',helper,'up'])
        evidence.run('speech-warmup', [sys.executable,'-B',ROOT / 'scripts/warm_operator_voice.py'])
    evidence.run('model-warmup', [sys.executable,'-B',ROOT / 'scripts/warm_operator_model.py'])
    with lifecycle_lock(ROOT / 'runtime/operator-lifecycle'):
        print(json.dumps(start()))
    if open_page:
        import webbrowser
        webbrowser.open('http://127.0.0.1:18791/#operator')


def manage_resource(operation, profile=None):
    env = read_env()
    origin = env.get('JARVIS_PUBLIC_ORIGIN', 'http://127.0.0.1:18801')
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    headers = {'Content-Type': 'application/json', 'Origin': origin}
    with client.open(urllib.request.Request('http://127.0.0.1:18801/api/auth/login', headers=headers,
        data=json.dumps({'login': 'matko', 'password': env['JARVIS_OPERATOR_ADMIN_PASSWORD']}).encode()), timeout=10) as response:
        csrf = json.load(response)['csrf']
    before = gpu_status()
    payload = {'operation': operation, **({'profile': profile} if profile else {})}
    started = time.monotonic()
    try:
        with client.open(urllib.request.Request('http://127.0.0.1:18801/api/admin/runtime', data=json.dumps(payload).encode(),
            headers={**headers, 'X-CSRF-Token': csrf}), timeout=240) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(json.load(error).get('error', {}).get('message', 'Resource operation rejected.')) from None
    report = {'operation': operation, 'operationSeconds': round(time.monotonic()-started, 3), 'result': result, 'gpuBefore': before, 'gpuAfter': gpu_status()}
    evidence = Evidence('resource-operation')
    (evidence.folder / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    print('Evidence: ' + str(evidence.folder))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    diagnostic = commands.add_parser('doctor')
    diagnostic.add_argument('--offline', action='store_true')
    diagnostic.add_argument('--json', action='store_true')
    install = commands.add_parser('setup')
    install.add_argument('--models', action='store_true', help='Also install the selected reviewed model if absent.')
    commands.add_parser('verify')
    launch = commands.add_parser('up')
    launch.add_argument('--voice', action='store_true')
    launch.add_argument('--open', action='store_true')
    resources = commands.add_parser('resources')
    resources.add_argument('operation', choices=['standby', 'wake', 'interactive', 'balanced'])
    args = parser.parse_args()
    if args.command == 'doctor':
        result = doctor(args.offline)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            for item in result['checks']:
                print(f'{item["status"].upper()}: {item["name"]} - {item["detail"]}' + (f' | {item["fix"]}' if item.get('fix') and item['status'] != 'ok' else ''))
            if 'gpu' in result:
                print('GPU: ' + json.dumps(result['gpu']))
        return 0 if result['ready'] else 1
    if args.command == 'setup':
        setup(args.models)
    elif args.command == 'up':
        up(args.voice,args.open)
    elif args.command == 'verify':
        node, npm, _ = node_commands()
        evidence = Evidence('environment-verify')
        evidence.run('operator', [node, npm, 'run', 'check'], ROOT / 'operator')
        evidence.run('hub-frontend', [sys.executable, '-B', ROOT / 'scripts/verify_projects.py', '--frontend'])
    else:
        manage_resource('profile' if args.operation in ('interactive', 'balanced') else args.operation,
                        args.operation if args.operation in ('interactive', 'balanced') else None)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        # Commands here never contain secret values; private HTTP bodies are not logged.
        print('JARVIS development: ' + str(error))
        raise SystemExit(1)
