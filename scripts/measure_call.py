"""Measure a synthetic voice turn, including first text versus complete answer."""
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
from project_hub.chat import stream_events

URL = 'http://127.0.0.1:18791'
folder = ROOT / 'logs' / ('call-timing-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir()
browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
with browser.open(URL + '/api/session', timeout=10):
    pass

def request(path, value, content_type='application/json'):
    data = json.dumps(value).encode() if isinstance(value, dict) else value
    return urllib.request.Request(URL + path, data=data, headers={'Content-Type': content_type, 'Origin': URL})

result = {}
prompt = 'There are twelve appointments of twenty five minutes, with five minute gaps only between appointments. How many minutes is that?'
start = time.monotonic()
with browser.open(request('/api/voice/speak', {'text': prompt, 'voice': 'af_heart'}), timeout=120) as response:
    audio = response.read()
result['fixture_tts_seconds'] = round(time.monotonic() - start, 3)
start = time.monotonic()
with browser.open(request('/api/voice/transcribe', audio, 'audio/wav'), timeout=120) as response:
    transcript = json.load(response)['text']
result['transcript'] = transcript
result['stt_seconds'] = round(time.monotonic() - start, 3)
start = time.monotonic()
answer = ''
with browser.open(request('/api/chat', {'project': 'medical', 'thread': str(uuid.uuid4()), 'message': transcript, 'voice_mode': True, 'stream': True}), timeout=245) as response:
    # Hub SSE is already typed and terminates on its done frame, not [DONE].
    for raw in response:
        if not raw.startswith(b'data: '):
            continue
        event = json.loads(raw[6:])
        if event['type'] == 'error':
            raise RuntimeError(event['error'])
        if event['type'] == 'delta':
            result.setdefault('first_text_seconds', round(time.monotonic() - start, 3))
            answer += event.get('text', '')
            if re.search(r'[.!?](?:\s|$)', answer) and len(answer) > 35:
                result.setdefault('first_sentence_seconds', round(time.monotonic() - start, 3))
        if event['type'] == 'done':
            result['usage'] = event.get('usage')
result['full_answer_seconds'] = round(time.monotonic() - start, 3)
result['answer'] = answer
result['answer_contains_expected_355'] = '355' in answer
start = time.monotonic()
with browser.open(request('/api/voice/speak', {'text': answer[:6000], 'voice': 'bm_george'}), timeout=120) as response:
    response.read()
result['answer_tts_seconds'] = round(time.monotonic() - start, 3)
(folder / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
print('Artifacts:', folder)
