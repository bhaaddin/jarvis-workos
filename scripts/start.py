"""Start the isolated Compose project and install the demonstration once."""

import argparse
import json
import subprocess
import sys
import urllib.request
import webbrowser
import os
import time
import shutil
from pathlib import Path
from init import ROOT, initialize
from projects import ensure_running


def ensure_frontend():
    frontend = ROOT / 'frontend'
    if not (frontend / 'package.json').is_file():
        return
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Install Node.js to build the command-center frontend.')
    npm = Path(node).parent / 'node_modules/npm/bin/npm-cli.js'
    if not npm.is_file():
        raise RuntimeError('Run npm ci and npm run build in the frontend folder.')
    if subprocess.run([node,str(ROOT / 'scripts/build-stamp.mjs'),'check','frontend'],capture_output=True,timeout=30,check=False).returncode == 0:
        return
    print('Building the command-center frontend...', flush=True)
    subprocess.run([node, str(npm), 'ci'], cwd=frontend, check=True)
    subprocess.run([node, str(npm), 'run', 'build'], cwd=frontend, check=True)


def ensure_docker():
    probe = ['docker', 'info', '--format', '{{.ServerVersion}}']
    try:
        if subprocess.run(probe, capture_output=True, timeout=15, check=False).returncode == 0:
            return
    except subprocess.TimeoutExpired:
        pass
    desktop = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Docker/Docker/Docker Desktop.exe'
    if os.name != 'nt' or not desktop.is_file():
        raise RuntimeError('Start Docker with Linux containers, then run this command again.')
    print('Starting Docker Desktop...', flush=True)
    subprocess.Popen([str(desktop)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            if subprocess.run(probe, capture_output=True, timeout=10, check=False).returncode == 0:
                return
        except subprocess.TimeoutExpired:
            pass
        time.sleep(2)
    raise RuntimeError('Docker Desktop did not become ready. Check its startup screen.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gpu', action='store_true', help='Use the NVIDIA GPU override.')
    parser.add_argument('--pull-model', action='store_true', help='Download qwen3.5:9b (about 6.6 GB).')
    parser.add_argument('--open', action='store_true', help='Open Project Hub after successful startup.')
    parser.add_argument('--voice', action='store_true', help='Start and provision local speech recognition/output.')
    args = parser.parse_args()
    env = initialize()
    ensure_frontend()
    if (ROOT / 'operator/package.json').is_file():
        node = shutil.which('node')
        if not node or subprocess.run([node,str(ROOT / 'scripts/build-stamp.mjs'),'check','operator'],capture_output=True,timeout=30,check=False).returncode:
            raise RuntimeError('The operator build is missing or stale. Run python -B scripts/dev.py setup.')
    ensure_docker()
    ensure_running()
    compose = ['docker', 'compose', '-f', 'compose.yaml']
    if args.gpu:
        compose += ['-f', 'compose.gpu.yaml']
    if args.voice:
        compose += ['--profile', 'voice']

    def run(*arguments):
        subprocess.run(compose + list(arguments), cwd=ROOT, check=True)

    run('config', '--quiet')
    run('up', '-d', '--wait', '--wait-timeout', '240')
    if (ROOT / 'operator/dist/main.js').is_file():
        subprocess.run([sys.executable, str(ROOT / 'scripts/operator_brain.py'), 'up'], cwd=ROOT, check=True)
    if args.voice:
        subprocess.run([sys.executable, str(ROOT / 'scripts/setup_voice.py')], cwd=ROOT, check=True)
        gpu_voice = ROOT.parent / 'Jarvis-Evaluation/scripts/voice_gpu.py'
        if gpu_voice.is_file():
            subprocess.run([sys.executable, str(gpu_voice), 'up'], cwd=gpu_voice.parent, check=True)
            subprocess.run([sys.executable, str(ROOT / 'scripts/warm_operator_voice.py')], cwd=ROOT, check=True)
    if (ROOT / 'operator/dist/main.js').is_file():
        subprocess.run([sys.executable, str(ROOT / 'scripts/warm_operator_model.py')], cwd=ROOT, check=True)
        subprocess.run([sys.executable, str(ROOT / 'scripts/operator_process.py'), 'start'], cwd=ROOT, check=True)
    subprocess.run(compose + ['exec', '-T', 'openclaw', 'node', '--input-type=module'], cwd=ROOT,
                   input=(ROOT / 'scripts/enable-project-tools.mjs').read_text(encoding='utf-8'), text=True, check=True)
    run('exec', '-T', 'openclaw', 'node', 'dist/index.js', 'plugins', 'reload', 'jarvis-project-tools')
    run('exec', '-T', 'openclaw', 'node', 'dist/index.js', 'plugins', 'reload', 'jarvis-capability-tools')
    run('exec', '-T', 'openclaw', 'node',
        '/home/node/.openclaw/workspace/skills/jarvis-projects/bridge.mjs', 'list')
    marker = ROOT / 'runtime' / 'demo-installed'
    if not marker.exists():
        run('stop', 'n8n')
        try:
            run('run', '--rm', '--no-deps', 'n8n', 'import:credentials', '--input=/bootstrap/credentials.json')
            run('run', '--rm', '--no-deps', 'n8n', 'import:workflow', '--input=/workflows/demo-briefing.json')
            run('run', '--rm', '--no-deps', 'n8n', 'publish:workflow', '--id=jarvisDemoBriefing')
        finally:
            run('up', '-d', '--wait', '--wait-timeout', '180', 'n8n')
        request = urllib.request.Request(
            'http://127.0.0.1:5679/webhook/jarvis/demo-briefing',
            data=json.dumps({'schema_version': 1, 'request_id': 'bootstrap-check'}).encode(),
            headers={'Content-Type': 'application/json', 'X-Jarvis-Key': env['JARVIS_WORKFLOW_TOKEN']},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        if result.get('request_id') != 'bootstrap-check' or result.get('status') != 'completed':
            raise RuntimeError('The sample workflow did not return the expected result.')
        marker.write_text('The synthetic demonstration was imported and verified.\n', encoding='utf-8')

    if args.pull_model:
        subprocess.run([sys.executable, str(ROOT / 'scripts' / 'pull_model.py')], check=True)
    print('\nProject Hub: http://127.0.0.1:18791')
    print('Assistant: http://localhost:18789')
    print('Workflows: http://localhost:5679')
    print('Get the dashboard token locally from .env (OPENCLAW_GATEWAY_TOKEN).')
    print('Run: python scripts/smoke.py')
    if args.open:
        webbrowser.open('http://127.0.0.1:18791/#operator')


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError, RuntimeError) as error:
        print(f'Startup did not complete: {error}')
        raise SystemExit(1)
