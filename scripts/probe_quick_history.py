"""Verify supported native bookkeeping before adding deterministic quick replies."""
from http.cookiejar import CookieJar
import json
import sys
import urllib.request
import uuid
from init import ROOT
sys.path.insert(0, str(ROOT))
from project_hub.gateway import Gateway

browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
base = 'http://127.0.0.1:18791'
with browser.open(base + '/api/session'): pass
request = urllib.request.Request(base + '/api/conversations', data=b'{"project":"medical"}', headers={'Content-Type': 'application/json', 'Origin': base})
with browser.open(request) as response: conversation = json.load(response)
gateway = Gateway()
gateway.rpc('sessions.patch', {'key': conversation['session']})
record = {'version': 1, 'id': uuid.uuid4().hex, 'kind': 'synthetic-test',
          'question': 'Synthetic quick-history check.', 'answer': 'Synthetic bookkeeping check passed.'}
result = gateway.rpc('chat.inject', {'sessionKey': conversation['session'], 'label': 'jarvis-quick-v1', 'message': json.dumps(record)})
history = gateway.rpc('chat.history', {'sessionKey': conversation['session'], 'limit': 5})
messages = history.get('messages', [])
print(json.dumps({'inject_response_keys': list(result), 'message_count': len(messages),
    'rows': [{'role': message.get('role'), 'provider': message.get('provider'), 'model': message.get('model'),
              'has_marker': 'jarvis-quick-v1' in json.dumps(message.get('content'))} for message in messages]}, indent=2))
