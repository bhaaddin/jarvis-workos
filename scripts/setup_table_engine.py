"""Build or verify the owned, source-bound table-analysis container."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from init import ROOT

SOURCES = ('Dockerfile', 'worker.py', '.dockerignore')


def source_digest(root=ROOT):
    digest = hashlib.sha256()
    for name in SOURCES:
        digest.update(name.encode())
        digest.update(b'\0')
        digest.update((root / 'operator/table-sandbox' / name).read_bytes())
        digest.update(b'\0')
    return digest.hexdigest()


def inspect_engine(root=ROOT):
    record = root / 'runtime/table-engine.json'
    if not record.is_file():
        return {'ready': False, 'code': 'TABLE_ENGINE_NOT_INSTALLED'}
    try:
        value = json.loads(record.read_text(encoding='utf-8'))
        if value.get('owner') != 'jarvis-table-engine' or value.get('sourceHash') != source_digest(root):
            return {'ready': False, 'code': 'TABLE_ENGINE_SOURCE_CHANGED'}
        result = subprocess.run(['docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', value['image']],
            capture_output=True, text=True, timeout=20, check=False)
        if result.returncode:
            return {'ready': False, 'code': 'TABLE_ENGINE_IMAGE_MISSING'}
        labels = json.loads(result.stdout) or {}
        if labels.get('dev.jarvis.component') != 'table-analysis' or labels.get('dev.jarvis.source') != value['sourceHash']:
            return {'ready': False, 'code': 'TABLE_ENGINE_PROVENANCE_MISMATCH'}
        return {'ready': True, 'image': value['image'], 'sourceHash': value['sourceHash']}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return {'ready': False, 'code': 'TABLE_ENGINE_CHECK_FAILED'}


def install_engine(root=ROOT, runner=None):
    prior = inspect_engine(root)
    if prior['ready']:
        return prior
    record = root / 'runtime/table-engine.json'
    if record.exists() and json.loads(record.read_text(encoding='utf-8')).get('owner') != 'jarvis-table-engine':
        raise RuntimeError('The table-engine record is not owned by this setup.')
    source = source_digest(root)
    command = ['docker', 'build', '--label', 'dev.jarvis.component=table-analysis', '--label', 'dev.jarvis.source=' + source,
               '--tag', 'jarvis-table-query:managed', str(root / 'operator/table-sandbox')]
    if runner:
        runner('table-image-build', command, root)
    else:
        subprocess.run(command, cwd=root, check=True, timeout=600)
    if source_digest(root) != source:
        raise RuntimeError('The table-engine source changed during its build; no new pin was written.')
    image = subprocess.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'jarvis-table-query:managed'],
        cwd=root, capture_output=True, text=True, timeout=20, check=True).stdout.strip()
    if len(image) != 71 or not image.startswith('sha256:'):
        raise RuntimeError('Docker did not return an immutable image ID.')
    record.parent.mkdir(exist_ok=True)
    temporary = record.with_suffix('.tmp')
    temporary.write_text(json.dumps({'owner': 'jarvis-table-engine', 'version': 1, 'image': image,
        'sourceHash': source, 'duckdb': '1.5.6'}, indent=2) + '\n', encoding='utf-8')
    temporary.replace(record)
    result = inspect_engine(root)
    if not result['ready']:
        raise RuntimeError('The rebuilt table engine failed provenance verification.')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['check', 'install'])
    args = parser.parse_args()
    try:
        result = inspect_engine() if args.operation == 'check' else install_engine()
        print(json.dumps(result))
        raise SystemExit(0 if result['ready'] else 1)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print(json.dumps({'ready': False, 'code': 'TABLE_ENGINE_SETUP_FAILED'}))
        raise SystemExit(1)
