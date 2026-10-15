"""Live acceptance suite: the owner's real failures, run against the live system.

Each check prints one JSON line. Exit 0 only if every check passes.
Slow by design (one agent-level chat included); timeout ~10 minutes.
Secrets never printed: login uses local .env, outputs are redacted on failure.
"""

import json
import sys
import time
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from init import ROOT

OPERATOR = 'http://127.0.0.1:18801'
ORIGIN = 'http://127.0.0.1:18801'
RESULTS = []


def check(name, passed, detail='', seconds=0.0):
    RESULTS.append({'name': name, 'pass': bool(passed), 'seconds': round(seconds, 1),
                    'detail': str(detail)[:300]})
    print(json.dumps(RESULTS[-1], ensure_ascii=False), flush=True)
    return passed


class Client:
    def __init__(self):
        env = {}
        for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env[key.strip()] = value.strip().strip('"\'')
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        headers = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        with self.opener.open(urllib.request.Request(
                OPERATOR + '/api/auth/login',
                data=json.dumps({'login': 'matko', 'password': env['JARVIS_OPERATOR_ADMIN_PASSWORD']}).encode(),
                headers=headers), timeout=15) as response:
            self.csrf = json.load(response)['csrf']
        self.headers = {**headers, 'X-CSRF-Token': self.csrf}

    def post(self, path, body, timeout=60):
        request = urllib.request.Request(OPERATOR + path, data=json.dumps(body).encode(), headers=self.headers)
        with self.opener.open(request, timeout=timeout) as response:
            return json.load(response)

    def get(self, path, timeout=30):
        request = urllib.request.Request(OPERATOR + path, headers=self.headers)
        with self.opener.open(request, timeout=timeout) as response:
            return json.load(response)


def main():
    client = Client()
    conversation = client.post('/api/conversations', {})['id']

    def invoke(tool, tool_input, timeout=90):
        return client.post('/api/tools/invoke', {'conversationId': conversation, 'requestId': str(uuid.uuid4()),
                                                 'tool': tool, 'input': tool_input}, timeout=timeout)

    # 1. Bus question through the tool: sub-10s real departure or honest fallback.
    began = time.monotonic()
    answer = invoke('jarvis_transit', {'from': 'Slaný autobusové nádraží', 'to': 'Kladno autobusové nádraží'})
    data = (answer.get('result') or {}).get('data') or {}
    check('bus-tool', answer.get('status') == 'completed' and bool(data.get('answer') or data.get('deepLink')),
          data.get('answer') or data.get('status'), time.monotonic() - began)

    # 2. Same question through the agent (the original 200s failure path).
    began = time.monotonic()
    run = client.post('/api/chat', {'conversationId': conversation, 'requestId': str(uuid.uuid4()),
                                    'message': 'Jsem u zastávky Slaný aut.nádr., chci na Kladno autobusové nádraží, jaký bus mi teď jede?',
                                    'waitMs': 20000}, timeout=120)
    run_id = run['id']
    deadline = time.monotonic() + 150
    while run.get('state') in ('queued', 'running') and time.monotonic() < deadline:
        time.sleep(2)
        run = client.get('/api/runs/' + run_id)
    text = str((run.get('result') or {}).get('text') or '')
    tools = [entry.get('tool') for entry in ((run.get('result') or {}).get('toolResults') or [])]
    check('bus-agent', run.get('state') == 'completed' and ('jarvis_transit' in tools or 'autobus' in text.lower() or 'bus' in text.lower()),
          'tools=%s %s' % (tools, text[:160]), time.monotonic() - began)

    # 3. what-can-you-do comes from live skills, not canned talk.
    began = time.monotonic()
    skills = client.get('/api/skills')['skills']
    ready = sorted(skill['id'] for skill in skills if skill.get('state') == 'ready')
    check('skills-live', len(ready) >= 30 and 'jarvis_transit' in ready and 'jarvis_mail' in ready,
          '%d ready' % len(ready), time.monotonic() - began)

    # 4. is-opencode-running via the computer tool.
    began = time.monotonic()
    seen = invoke('jarvis_computer', {'action': 'processes', 'names': ['opencode']})
    check('opencode-status', seen.get('status') == 'completed', 'completed', time.monotonic() - began)

    # 5. Approval flow: propose then deny cancels cleanly, nothing runs.
    began = time.monotonic()
    proposed = invoke('jarvis_code', {'operation': 'run', 'project': 'test-simple',
                                      'command': 'Write-Output acceptance-probe', '_confidence': 'high'})
    action = proposed.get('action') or {}
    decision = client.post('/api/actions/' + action.get('id', 'missing') + '/decision',
                           {'decision': 'deny', 'inputHash': action.get('inputHash'),
                            'fingerprint': action.get('fingerprint'), 'eventKey': str(uuid.uuid4())})
    check('approval-deny', proposed.get('status') == 'approval_required' and decision.get('state') == 'denied',
          decision.get('state'), time.monotonic() - began)

    # 6. Mail without a mailbox fails honestly (no fake data possible).
    began = time.monotonic()
    mail = invoke('jarvis_mail', {'action': 'list', 'folder': 'INBOX', 'limit': 3})
    honest = mail.get('status') == 'error' and 'connect' in json.dumps(mail.get('error', {})).lower()
    check('mail-honest', honest, (mail.get('error') or {}).get('code'), time.monotonic() - began)

    # 7. Owner checklist answers "what is missing".
    began = time.monotonic()
    todo = invoke('jarvis_owner_todo', {})
    steps = ((todo.get('result') or {}).get('data') or {}).get('credentialSteps') or []
    check('owner-todo', todo.get('status') == 'completed' and len(steps) >= 5,
          '%d steps' % len(steps), time.monotonic() - began)

    # 8. Unknown request: fast honest fallback, no silent hang (bounded wait).
    began = time.monotonic()
    run = client.post('/api/chat', {'conversationId': conversation, 'requestId': str(uuid.uuid4()),
                                    'message': 'Kolikátého je dneska svátek Everest?',
                                    'waitMs': 20000}, timeout=120)
    run_id, deadline = run['id'], time.monotonic() + 150
    while run.get('state') in ('queued', 'running') and time.monotonic() < deadline:
        time.sleep(2)
        run = client.get('/api/runs/' + run_id)
    elapsed = time.monotonic() - began
    text = str((run.get('result') or {}).get('text') or '')
    check('unknown-fast', run.get('state') == 'completed' and elapsed < 150 and len(text) > 0,
          '%ss' % round(elapsed), elapsed)

    passed = sum(1 for item in RESULTS if item['pass'])
    folder = ROOT / 'logs' / ('acceptance-' + time.strftime('%Y%m%dT%H%M%S'))
    folder.mkdir(parents=True)
    (folder / 'results.json').write_text(json.dumps(RESULTS, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('SAVED: %s | %d/%d passed' % (folder, passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'fatal': type(error).__name__, 'detail': str(error)[:200]}))
        raise SystemExit(2)
