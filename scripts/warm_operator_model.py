"""Preload the actually selected operator model and verify its GPU residency."""
import json
import shutil
import subprocess
import time
import urllib.request

from init import ROOT


def selected_setting(key):
    result = subprocess.run(['docker', 'exec', 'jarvis-operator-brain-1', 'node', 'dist/index.js',
                             'config', 'get', key, '--json'], cwd=ROOT, capture_output=True, text=True,
                            timeout=45, check=True)
    return json.loads(result.stdout)


def selected_model():
    config_path = ROOT / 'operator/config/model.json'
    if config_path.is_file():
        config = json.loads(config_path.read_text(encoding='utf-8'))
        if config.get('transport') == 'ollama':
            return {'reference': 'native:' + config['model'], 'model': config['model'], 'base': config['baseUrl'],
                    'thinking': config['think'], 'contextTokens': config['contextTokens']}
    reference = selected_setting('agents.defaults.model')['primary']
    thinking = selected_setting('agents.defaults.thinkingDefault')
    provider, model = reference.split('/', 1)
    bases = {'jarvis-local': 'http://127.0.0.1:11436', 'ollama': 'http://127.0.0.1:11435'}
    if provider not in bases:
        raise RuntimeError('The selected provider has no reviewed local warmup endpoint.')
    return {'reference': reference, 'model': model, 'base': bases[provider], 'thinking': thinking, 'contextTokens': 32768}


def warm():
    selected = selected_model()
    reference, model, base, thinking = (selected[key] for key in ('reference', 'model', 'base', 'thinking'))
    if reference.startswith('native:'):
        logging = subprocess.run(['docker', 'inspect', '--format', '{{.HostConfig.LogConfig.Type}}', 'jarvis-operator-model-1'],
                                 capture_output=True, text=True, timeout=15, check=True)
        if logging.stdout.strip() != 'none':
            raise RuntimeError('The direct model requires disabled native console persistence.')
    started = time.monotonic()
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is required for the actual Gateway warmup.')
    result = subprocess.run([node, str(ROOT / 'operator/scripts/warm-model.mjs')], cwd=ROOT,
                            capture_output=True, text=True, timeout=200, check=True)
    if not json.loads(result.stdout).get('gatewayWarm'):
        raise RuntimeError('The selected model did not complete the private Gateway warmup.')
    with urllib.request.urlopen(base + '/api/ps', timeout=10) as response:
        resident = next((item for item in json.load(response)['models'] if item['name'] == model), None)
    if not resident or resident.get('context_length') != selected['contextTokens']:
        raise RuntimeError('The selected model is not resident with its reviewed 32K context.')
    full_gpu = resident['size'] == resident['size_vram']
    if model.endswith('-text-gpu') and not full_gpu:
        raise RuntimeError('The selected model did not fit fully on the GPU. Check other GPU workloads.')
    return {'model': reference, 'thinkingDefault': thinking, 'contextTokens': resident['context_length'],
            'allLayersAssignedToGpu': full_gpu, 'reportedModelBytes': resident['size'], 'reportedGpuBytes': resident['size_vram'],
            'note': 'Ollama GPU assignment does not prove physical VRAM residency.',
            'loadSeconds': round(time.monotonic() - started, 3), 'warmed': True}


if __name__ == '__main__':
    try:
        print(json.dumps(warm()))
    except subprocess.CalledProcessError as error:
        detail = 'process_failed'
        try:
            detail = json.loads(error.stdout).get('error', {}).get('code', detail)
        except (ValueError, TypeError, AttributeError):
            pass
        print(json.dumps({'warmed': False, 'stage': 'gateway_check', 'code': detail, 'exitCode': error.returncode}))
        raise SystemExit(1)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
        print('Operator model warmup failed. Check the selected model service, model installation and available GPU memory.')
        raise SystemExit(1)
