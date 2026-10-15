"""Inspect or download approved local model candidates with retained evidence."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:11435'


def http(route, body=None, timeout=20):
    request = urllib.request.Request(BASE + route, data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def inventory():
    result = {'at': datetime.now(timezone.utc).isoformat(), 'ollama': http('/api/version'),
              'installed': http('/api/tags').get('models', []), 'loaded': http('/api/ps').get('models', [])}
    from warm_operator_model import selected_model
    selected = selected_model()
    result['selectedModel'] = {'primary': selected['reference']}
    result['thinkingDefault'] = selected['thinking']
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=memory.total,memory.used,memory.free,utilization.gpu',
                          '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=15, check=True)
    result['gpuMiBTotalUsedFreeUtilizationPercent'] = gpu.stdout.strip()
    speech = subprocess.run(['docker', 'exec', 'jarvis-voice-eval-voice-1', 'python', '-c',
        "import json; from speaches.config import Config; c=Config(); print(json.dumps({'whisperDevice':c.whisper.inference_device,'computeType':c.whisper.compute_type,'excludedOrtProviders':c.unstable_ort_opts.exclude_providers}))"],
        capture_output=True, text=True, timeout=30, check=True)
    result['speechConfiguration'] = json.loads(speech.stdout)
    for name, url in {'operator': 'http://127.0.0.1:18801/health', 'hub': 'http://127.0.0.1:18791/health',
                      'speech': 'http://127.0.0.1:18902/health', 'medical': 'http://127.0.0.1:5092/health'}.items():
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                result[name] = {'httpStatus': response.status}
        except OSError as error:
            result[name] = {'httpStatus': getattr(error, 'code', None), 'available': False}
    return result


def main():
    global BASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['inventory', 'pull', 'unload', 'remote-info', 'hf-info', 'progress', 'create-text-27b', 'create-text-38', 'create-text-moe'])
    parser.add_argument('model', nargs='?')
    parser.add_argument('--background', action='store_true')
    parser.add_argument('--folder', type=Path)
    parser.add_argument('--base', default=BASE)
    parser.add_argument('--full-gpu', action='store_true')
    args = parser.parse_args()
    BASE = args.base.rstrip('/')
    folder = args.folder or ROOT / 'logs' / ('model-upgrade-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True, exist_ok=True)
    if args.background:
        if args.operation != 'pull' or not args.model:
            parser.error('Background mode requires a model pull.')
        from owned_process import creation_time
        with (folder / 'download.log').open('ab') as output:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), 'pull', args.model, '--folder', str(folder), '--base', BASE], cwd=ROOT,
                stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
        state = {'pid': process.pid, 'created': creation_time(int(process._handle)), 'model': args.model, 'folder': str(folder)}
        (folder / 'process.json').write_text(json.dumps(state, indent=2), encoding='utf-8')
        print(json.dumps(state, indent=2))
        return 0
    started = time.monotonic()
    try:
        if args.operation == 'inventory':
            result = inventory()
        elif args.operation == 'remote-info':
            name, tag = args.model.rsplit(':', 1)
            with urllib.request.urlopen('https://registry.ollama.ai/v2/library/' + name + '/manifests/' + tag, timeout=30) as response:
                manifest = json.load(response)
            with urllib.request.urlopen('https://registry.ollama.ai/v2/library/' + name + '/blobs/' + manifest['config']['digest'], timeout=30) as response:
                metadata = json.load(response)
            result = {'model': args.model, 'bytes': sum(layer['size'] for layer in manifest['layers']),
                      'layers': len(manifest['layers']), 'metadata': metadata}
        elif args.operation == 'hf-info':
            request = urllib.request.Request('https://huggingface.co/api/models/' + args.model + '/tree/main?recursive=true&expand=false', headers={'User-Agent': 'JARVIS-local-model-qualification/1.0'})
            with urllib.request.urlopen(request, timeout=30) as response:
                files = json.load(response)
            result = {'repository': args.model, 'candidates': [item for item in files if item.get('type') == 'file' and any(value in item.get('path', '').lower() for value in ('q3_', 'iq3', 'q4_k_s'))]}
        elif args.operation == 'progress':
            call = urllib.request.Request(BASE + '/api/pull', data=json.dumps({'model': args.model, 'stream': True}).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(call, timeout=20) as response:
                for raw in response:
                    status = json.loads(raw)
                    if status.get('total') or status.get('error') or status.get('status') == 'success':
                        result = {'model': args.model, 'progress': status}
                        break
                else:
                    raise RuntimeError('No pull progress was returned.')
        elif args.operation == 'unload':
            if not args.model:
                parser.error('A model name is required.')
            result = {'model': args.model, 'unload': http('/api/generate', {'model': args.model, 'keep_alive': 0, 'stream': False})}
        elif args.operation in ('create-text-27b', 'create-text-38', 'create-text-moe'):
            latest = args.operation == 'create-text-38'
            moe = args.operation == 'create-text-moe'
            name = ('jarvis-qwen3.8:27b-text-gpu' if args.full_gpu else 'jarvis-qwen3.8:27b-text-q3xl') if latest else ('jarvis-qwen3.5:27b-text-gpu' if args.full_gpu else 'jarvis-qwen3.5:27b-text-q3km')
            files = {'Qwen3.8-27B-UD-Q3_K_XL.gguf': 'sha256:8c2a45ff85e7674ca185ec8eb6cdeab0e617ed9d8018caed0b64380eb2a67a5e'} if latest else {'Qwen3.5-27B-Q3_K_M.gguf': 'sha256:f08ce37ebe8a7130db0c198262336773976b1e374f2444f898c41117710f0bb3'}
            if moe:
                name = 'jarvis-qwen3.6:35b-a3b-text-gpu' if args.full_gpu else 'jarvis-qwen3.6:35b-a3b-text-iq3s'
                files = {'Qwen3.6-35B-A3B-UD-IQ3_S.gguf': 'sha256:66a3ca888ce13482b40c333db2432c0ebde3a7b13754fc29f0c6f5e89703ec66'}
            created = http('/api/create', {'model': name, 'stream': False,
                'files': files, 'renderer': 'qwen3.8' if latest else 'qwen3.5', 'parser': 'qwen3.5', 'license': 'Apache-2.0',
                'parameters': {'num_ctx': 32768, 'num_batch': 256, **({'num_gpu': 999} if args.full_gpu else {}),
                    **({'temperature': 1.0, 'top_p': 0.95, 'top_k': 20, 'min_p': 0.0, 'presence_penalty': 0.0, 'repeat_penalty': 1.0} if latest or moe else {})}}, 180)
            result = {'model': name, 'create': created, 'modelInfo': http('/api/show', {'model': name})}
        else:
            if not args.model:
                parser.error('A model name is required.')
            print('Downloading/resuming ' + args.model + ' into the existing Ollama model volume.', flush=True)
            result = {'model': args.model, 'pull': http('/api/pull', {'model': args.model, 'stream': False}, 3600)}
            if result['pull'].get('status') != 'success':
                raise RuntimeError('Ollama did not report download success.')
            result['modelInfo'] = http('/api/show', {'model': args.model})
            # The template is technical evidence, not data from user conversations.
            result['installed'] = [model for model in http('/api/tags')['models'] if model['name'] == args.model]
        result['elapsedSeconds'] = round(time.monotonic() - started, 3)
        (folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        printable = result if args.operation == 'inventory' else {key: value for key, value in result.items() if key != 'modelInfo'}
        print(json.dumps(printable, indent=2))
        print('Artifacts:', folder)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result = {'operation': args.operation, 'model': args.model, 'failed': True, 'error': str(error), 'elapsedSeconds': round(time.monotonic() - started, 3)}
        (folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
