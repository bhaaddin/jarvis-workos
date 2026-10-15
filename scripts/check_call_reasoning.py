"""Compare synthetic answer quality at inherited versus higher session reasoning."""
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
import sys
import time
import urllib.request

from init import ROOT
sys.path.insert(0, str(ROOT))
from project_hub.gateway import Gateway

base = 'http://127.0.0.1:18791'
browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
with browser.open(base + '/api/session', timeout=10):
    pass

def api(path, value):
    request = urllib.request.Request(base + path, data=json.dumps(value).encode(), headers={'Content-Type': 'application/json', 'Origin': base})
    with browser.open(request, timeout=245) as response:
        return json.load(response)

results = []
questions = [
    ('gap-count', 'There are 12 appointments, each takes 25 minutes. There is a 5-minute gap only between consecutive appointments, none before or after. What is the total in minutes? Reply in one sentence.', '355'),
    ('discount-order', 'A subscription costs 80 euros. Apply a 25 percent discount, then add 20 percent tax to the discounted price. What is the final price? Reply in one sentence.', '72'),
    ('independent-gap-count', 'Seven appointments take 18 minutes each, with a four-minute gap only between consecutive appointments. How many minutes altogether? Reply in one sentence.', '150'),
]
for level in (None, 'high'):
    for identifier, question, expected in questions:
        thread = api('/api/conversations', {'project': 'medical'})
        if level:
            Gateway().rpc('sessions.patch', {'key': thread['session'], 'thinkingLevel': level})
        start = time.monotonic()
        reply = api('/api/chat', {'project': 'medical', 'thread': thread['thread'], 'message': question, 'voice_mode': True})
        elapsed = round(time.monotonic() - start, 3)
        history = Gateway().rpc('chat.history', {'sessionKey': thread['session'], 'limit': 20})
        def used_calculator(value):
            if isinstance(value, dict):
                return value.get('name') == 'jarvis_calculate' or value.get('toolName') == 'jarvis_calculate' or any(used_calculator(item) for item in value.values())
            return isinstance(value, list) and any(used_calculator(item) for item in value)
        result = {'case': identifier, 'thinking': level or 'inherited', 'seconds': round(time.monotonic() - start, 3),
                  'expected': expected, 'correct_number': expected in reply['answer'], 'answer': reply['answer'],
                  'reply_seconds': elapsed, 'calculator_used': used_calculator(history)}
        results.append(result)
        print(json.dumps(result), flush=True)
folder = ROOT / 'logs' / ('call-reasoning-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir()
(folder / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print('Artifacts:', folder)
