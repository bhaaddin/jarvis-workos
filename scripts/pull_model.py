"""Download the local model with one final result instead of terminal animation."""

import json
import urllib.error
import urllib.request


def main():
    print('Downloading/resuming qwen3.5:9b (about 6.6 GB) into the Ollama volume.', flush=True)
    request = urllib.request.Request(
        'http://127.0.0.1:11435/api/pull',
        data=json.dumps({'model': 'qwen3.5:9b', 'stream': False}).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=1800) as response:
        result = json.load(response)
    if result.get('status') != 'success':
        raise RuntimeError(f'Model download did not succeed: {result}')
    print('Model download succeeded.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Model download failed: {error}', flush=True)
        raise SystemExit(1)
