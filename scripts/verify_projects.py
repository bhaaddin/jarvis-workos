"""Run connector checks with full logs and the original failing exit code."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import time
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Also check the running OpenClaw project integration.')
    parser.add_argument('--frontend', action='store_true', help='Also run frontend tests and the production build.')
    args = parser.parse_args()
    folder = ROOT / 'logs' / ('project-checks-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir(parents=True, exist_ok=True)
    checks = [
        ('behavior-tests', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v']),
        ('dashboard-syntax', ['node', '--check', 'project_hub/web/app.js']),
        ('voice-ui-syntax', ['node', '--check', 'project_hub/web/voice.js']),
        ('plugin-syntax', ['node', '--check', 'plugins/jarvis-project-tools/index.js']),
        ('catalog-plugin-syntax', ['node', '--check', 'plugins/jarvis-capability-tools/index.js']),
        ('bridge-syntax', ['node', '--check', 'workspace/skills/jarvis-projects/bridge.mjs']),
        ('upgrade-syntax', ['node', '--check', 'scripts/enable-project-tools.mjs']),
    ]
    if args.frontend:
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node.js is required for frontend verification.')
        npm = str(Path(node).parent / 'node_modules/npm/bin/npm-cli.js')
        checks += [('frontend-tests', [node, npm, '--prefix', 'frontend', 'test']),
                   ('frontend-build', [node, npm, '--prefix', 'frontend', 'run', 'build'])]
    if args.live:
        base = ['docker', 'compose', 'exec', '-T', 'openclaw', 'node']
        checks += [
            ('gateway-config', base + ['dist/index.js', 'config', 'validate', '--json']),
            ('plugin-runtime', [sys.executable, 'scripts/verify_plugin_runtime.py', 'jarvis-project-tools', 'jarvis_projects', 'jarvis_calculate', 'jarvis_weather']),
            ('catalog-plugin-runtime', [sys.executable, 'scripts/verify_plugin_runtime.py', 'jarvis-capability-tools', 'jarvis_capabilities']),
            ('connected-projects', base + ['/home/node/.openclaw/workspace/skills/jarvis-projects/bridge.mjs', 'list']),
        ]
    for name, command in checks:
        path = folder / f'{name}.log'
        start = time.monotonic()
        with path.open('w', encoding='utf-8') as log:
            log.write('Command: ' + subprocess.list2cmdline(command) + '\n\n')
            log.flush()
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=False)
            log.write(f'\nExit code: {result.returncode}\n')
        print(f'{"PASS" if result.returncode == 0 else "FAIL"}: {name} ({time.monotonic() - start:.2f}s) -> {path}')
        if result.returncode:
            return result.returncode
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
