"""Compile a detached Medical verification worktree, retaining original exits."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = Path('C:/Users/Matko/AppData/Local/Temp/opencode/jarvis-medical-check-20260930')
PROJECT = 'src/SportMedical.Diagnostics.Api/SportMedical.Diagnostics.Api.csproj'


def main():
    if not (CHECKOUT / '.git').is_file():
        raise RuntimeError('The dedicated verification worktree is missing.')
    folder = ROOT / 'logs' / ('medical-source-check-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir()
    results = []
    for name, command in [
        ('sdk', ['dotnet', '--version']),
        ('restore', ['dotnet', 'restore', PROJECT, '--locked-mode']),
        ('build', ['dotnet', 'build', PROJECT, '--no-restore']),
    ]:
        start = time.monotonic()
        with (folder / (name + '.log')).open('w', encoding='utf-8') as output:
            output.write('Command: ' + subprocess.list2cmdline(command) + '\n');output.flush()
            result = subprocess.run(command, cwd=CHECKOUT, stdout=output, stderr=subprocess.STDOUT, timeout=600, check=False)
            output.write('\nExit: ' + str(result.returncode) + '\n')
        results.append({'check': name, 'command': command, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - start, 3)})
        (folder / 'results.json').write_text(json.dumps({'checkout': str(CHECKOUT), 'checks': results}, indent=2), encoding='utf-8')
        print(f'{name}: exit {result.returncode}; {folder / (name + ".log")}', flush=True)
        if result.returncode:
            return result.returncode
        if name == 'sdk' and '10.0.302' not in (folder / 'sdk.log').read_text():
            raise RuntimeError('The pinned SDK was not selected.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
