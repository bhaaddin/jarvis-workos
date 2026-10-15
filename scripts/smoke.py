"""Verify real service boundaries. --model also makes a local inference request."""

import argparse
import json
import subprocess
import urllib.error
import urllib.request
import uuid

from init import ROOT, read_env


def get_json(url, payload=None, headers=None, timeout=30):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', action='store_true')
    args = parser.parse_args()
    env = read_env()
    for name, url in (
        ('OpenClaw', 'http://127.0.0.1:18789/healthz'),
        ('n8n', 'http://127.0.0.1:5679/healthz/readiness'),
        ('Ollama', 'http://127.0.0.1:11435/api/tags'),
    ):
        get_json(url)
        print(f'PASS: {name} responds.')

    endpoint = 'http://127.0.0.1:5679/webhook/jarvis/demo-briefing'
    request_id = str(uuid.uuid4())
    payload = {'schema_version': 1, 'request_id': request_id}
    try:
        get_json(endpoint, payload)
    except urllib.error.HTTPError as error:
        check(error.code in (401, 403), f'Unexpected unauthenticated status: {error.code}')
    else:
        raise RuntimeError('The webhook accepted a request without its credential.')
    print('PASS: The workflow requires its credential.')

    result = get_json(endpoint, payload, {'X-Jarvis-Key': env['JARVIS_WORKFLOW_TOKEN']})
    check(result.get('request_id') == request_id and result.get('mode') == 'demo'
          and result.get('status') == 'completed', 'Unexpected workflow result.')
    print('PASS: The authenticated workflow returns a matching request ID and demo result.')

    subprocess.run([
        'docker', 'compose', 'exec', '-T', 'openclaw', 'node',
        '/home/node/.openclaw/workspace/skills/jarvis-workflows/bridge.mjs', 'demo-briefing',
    ], cwd=ROOT, check=True)
    print('PASS: The bridge runs inside the assistant container and reaches n8n.')

    if args.model:
        result = get_json('http://127.0.0.1:11435/api/chat', {
            'model': 'qwen3.5:9b',
            'messages': [{'role': 'user', 'content': 'Reply with exactly: JARVIS_LOCAL_OK'}],
            'think': False,
            'stream': False,
            'options': {'num_ctx': 32768, 'num_predict': 64, 'temperature': 0},
        }, timeout=300)
        content = result.get('message', {}).get('content', '')
        check('JARVIS_LOCAL_OK' in content, f'Unexpected local model result: {content!r}')
        print('PASS: Local model inference returned JARVIS_LOCAL_OK.')
    else:
        print('NOT CHECKED: Model inference. Use --model after downloading the model.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'FAIL: {error}')
        raise SystemExit(1)
