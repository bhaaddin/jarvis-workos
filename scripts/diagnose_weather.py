"""Trace one synthetic Prague weather request, retaining timing and safe tool metadata."""
import argparse
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
import re
import sys
import time
import urllib.request
import uuid

from init import ROOT
sys.path.insert(0, str(ROOT))
from project_hub.gateway import Gateway

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--deadline', type=float, default=60)
args = parser.parse_args()
folder = ROOT / 'logs' / ('weather-diagnostic-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir()
base = 'http://127.0.0.1:18791'
browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
with browser.open(base + '/api/session', timeout=5): pass

def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    call = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json', 'Origin': base})
    with browser.open(call, timeout=70) as response:
        return json.load(response)

thread = request('/api/conversations', {'project': 'medical'})
identifier = uuid.uuid4().hex
body = {'project': 'medical', 'thread': thread['thread'], 'message': "What's the weather in Prague?", 'voice_mode': True, 'request_id': identifier}
start = time.monotonic()
request('/api/chat/jobs', body)
result = {'question': body['message'], 'admission_seconds': round(time.monotonic() - start, 3), 'text': '', 'thread': thread['thread']}
offset = 0
while True:
    value = request(f'/api/chat/jobs/{identifier}?project=medical&thread={thread["thread"]}&offset={offset}')
    if value['text']:
        result.setdefault('first_text_seconds', round(time.monotonic() - start, 3))
        result['text'] += value['text']
    offset = value['next_offset']
    if value['status'] != 'running' and not value['has_more']:
        result['status'], result['error'] = value['status'], value.get('error')
        break
    if time.monotonic() - start >= args.deadline:
        result['status'] = 'diagnostic_deadline'
        break
    time.sleep(.25)
result['elapsed_seconds'] = round(time.monotonic() - start, 3)
history = Gateway().rpc('chat.history', {'sessionKey': thread['session'], 'limit': 30})
tools = []
def inspect(value):
    if isinstance(value, dict):
        if value.get('type') in ('toolCall', 'tool_use', 'function'):
            name = value.get('name') or (value.get('function') or {}).get('name')
            arguments = value.get('arguments') or value.get('input') or {}
            if isinstance(arguments, str):
                try: arguments = json.loads(arguments)
                except ValueError: arguments = {}
            command = arguments.get('command', '') if isinstance(arguments, dict) else ''
            item = {'name': name}
            if command:
                item['command_length'] = len(command)
                item['weather_hosts'] = [host for host in ('wttr.in', 'api.open-meteo.com', 'geocoding-api.open-meteo.com') if host in command]
                item['uses_curl'] = bool(re.search(r'\bcurl\b', command))
                item['has_explicit_curl_deadline'] = bool(re.search(r'--max-time|\s-m\s|--connect-timeout', command))
                item['uses_plain_http'] = 'http://' in command or bool(re.search(r'["\s]wttr\.in/', command))
            if isinstance(arguments, dict) and str(arguments.get('path', '')).endswith('SKILL.md'):
                item['reads_skill'] = True
            tools.append(item)
        for child in value.values(): inspect(child)
    elif isinstance(value, list):
        for child in value: inspect(child)
inspect(history)
result['tools'] = tools
if result['status'] == 'diagnostic_deadline':
    request('/api/conversations/abort', {'project': 'medical', 'thread': thread['thread']})
(folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
print('Artifacts:', folder)
