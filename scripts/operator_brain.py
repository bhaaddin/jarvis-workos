"""Initialize private operator keys and operate only its dedicated Gateway."""
import argparse
import secrets
import subprocess

from init import ROOT, read_env

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['up', 'down', 'status', 'repair', 'configure'])
args = parser.parse_args()
values = read_env()
if args.command == 'up':
    additions = []
    for key in ['JARVIS_OPERATOR_GATEWAY_TOKEN', 'JARVIS_OPERATOR_DATA_KEY', 'JARVIS_OPERATOR_ADMIN_PASSWORD', 'JARVIS_OPERATOR_CALLBACK_KEY']:
        if key not in values:
            additions.append(key + '=' + secrets.token_hex(32))
        elif not values[key] or values[key].startswith('__'):
            raise SystemExit(f'{key} has an invalid existing value; it was preserved.')
    if additions:
        with (ROOT / '.env').open('a', encoding='utf-8') as output:
            output.write('\n' + '\n'.join(additions) + '\n')
        print('Generated missing operator keys in the existing private environment file.')
command = ['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'operator/compose.brain.yaml')]
if args.command in ('repair', 'configure'):
    operations = [['stop','brain'], ['run','--rm','brain-init']]
    if args.command == 'repair':
        operations.append(['run','--rm','--no-deps','brain','node','dist/index.js','doctor','--fix'])
    operations.append(['up','-d','--wait','--wait-timeout','90','brain'])
    for operation in operations:
        result = subprocess.run([*command, *operation], cwd=ROOT, timeout=180, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)
else:
    command += {'up': ['up', '-d', '--wait', '--wait-timeout', '90'], 'down': ['down'], 'status': ['ps']}[args.command]
    result = subprocess.run(command, cwd=ROOT, timeout=180, check=False)
    raise SystemExit(result.returncode)
