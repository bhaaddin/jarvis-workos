"""Time real basic requests over the notebook link; retain no live credentials."""
import argparse
import base64
from datetime import datetime, timezone
import json
import sys
import time
import urllib.request
import uuid

from init import ROOT
sys.path.insert(0, str(ROOT))
from project_hub.gateway import Gateway
from project_hub.weather import Weather


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider-only', action='store_true')
    args = parser.parse_args()
    folder = ROOT / 'logs' / ('basic-speed-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir()
    if args.provider_only:
        service = Weather()
        try:
            results = [service.lookup(city, 'CZ') for city in ('Prague', 'Prague', 'Brno')]
            (folder / 'provider.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(json.dumps([{'available': value['available'], 'lookup_ms': value.get('lookup_ms'), 'cached': value.get('cached'), 'location': value.get('location'), 'reason': value.get('reason')} for value in results], indent=2))
            print('Artifacts:', folder)
            return 0 if all(value['available'] for value in results) else 1
        finally: service.pool.shutdown()

    config = json.loads((ROOT / 'runtime/notebook-call.json').read_text(encoding='utf-8'))
    base = config['url']
    authorization = 'Basic ' + base64.b64encode((config['username'] + ':' + config['password']).encode()).decode()
    def api(path, body=None):
        request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', 'Origin': base, 'Authorization': authorization})
        with urllib.request.urlopen(request, timeout=10) as response: return json.load(response)
    thread = api('/api/conversations', {'project': 'medical'})
    results, last_tools = [], 0
    questions = ["What's the weather in Prague?", "What's the weather in Prague?", "What's the weather in Brno?", 'Hi Jarvis!', 'What is 2+2?']
    for question in questions:
        identifier = uuid.uuid4().hex
        started = time.monotonic()
        api('/api/chat/jobs', {'request_id': identifier, 'project': 'medical', 'thread': thread['thread'], 'message': question, 'voice_mode': True})
        row = {'question': question, 'admission_seconds': round(time.monotonic() - started, 3), 'answer': ''}
        offset = 0
        while time.monotonic() - started < 26:
            value = api(f'/api/chat/jobs/{identifier}?project=medical&thread={thread["thread"]}&offset={offset}')
            if value['text']:
                row.setdefault('first_text_seconds', round(time.monotonic() - started, 3))
                row['answer'] += value['text']
            offset = value['next_offset']
            if value['status'] != 'running' and not value['has_more']:
                row['status'], row['error'] = value['status'], value.get('error')
                row['route'] = value.get('route')
                break
            time.sleep(.2)
        else:
            api('/api/conversations/abort', {'project': 'medical', 'thread': thread['thread']})
            row['status'] = 'deadline'
        row['seconds'] = round(time.monotonic() - started, 3)
        history = Gateway().rpc('chat.history', {'sessionKey': thread['session'], 'limit': 80})
        calls = []
        def inspect(value):
            if isinstance(value, dict):
                if value.get('type') in ('toolCall', 'tool_use') and isinstance(value.get('name'), str): calls.append(value['name'])
                for child in value.values(): inspect(child)
            elif isinstance(value, list):
                for child in value: inspect(child)
        inspect(history)
        row['tools'] = calls[last_tools:]
        last_tools = len(calls)
        row['passed'] = row['status'] == 'completed' and row['seconds'] < 6 and bool(row['answer'].strip())
        if 'weather' in question.lower():
            row['passed'] = row['passed'] and row['tools'] == [] and row['route'] == 'direct-weather' and 'open' in row['answer'].lower()
        projected = api(f'/api/conversations/history?project=medical&thread={thread["thread"]}')
        row['history_contains_question_and_answer'] = any(item['role'] == 'user' and item['text'] == question for item in projected['messages']) and any(item['role'] == 'assistant' and item['text'] == row['answer'] for item in projected['messages'])
        row['passed'] = row['passed'] and row['history_contains_question_and_answer']
        results.append(row)
        print(json.dumps(row), flush=True)
    (folder / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print('Artifacts:', folder)
    return 0 if all(row['passed'] for row in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
