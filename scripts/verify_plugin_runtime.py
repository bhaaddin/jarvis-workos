"""Validate actual loaded tool contracts, not only the inspect command's exit code."""
import argparse
import json
import subprocess
import sys
from init import ROOT

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('plugin')
parser.add_argument('tools', nargs='+')
args = parser.parse_args()
result = subprocess.run(['docker', 'compose', 'exec', '-T', 'openclaw', 'node', 'dist/index.js',
    'plugins', 'inspect', args.plugin, '--runtime', '--json'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
print(result.stdout)
if result.stderr: print(result.stderr, file=sys.stderr)
if result.returncode: raise SystemExit(result.returncode)
data = json.loads(result.stdout)
names = {name for tool in data.get('tools', []) for name in tool.get('names', [])}
errors = [entry for entry in data.get('diagnostics', []) if entry.get('level') == 'error']
if data.get('plugin', {}).get('status') != 'loaded' or not set(args.tools).issubset(names) or errors:
    print('FAIL: required native tools were not all loaded cleanly.', file=sys.stderr)
    raise SystemExit(1)
print('Verified native tools: ' + ', '.join(args.tools))
