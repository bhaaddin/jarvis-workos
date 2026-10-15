"""Local-owner bridge to the operational API; credentials never reach the UI."""
from http.cookiejar import CookieJar
import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from .projects import ProjectError

UUID = r"[0-9a-fA-F-]{36}"
ROUTES = {
    'GET': [r'/conversations', rf'/conversations/{UUID}/messages', rf'/runs/{UUID}', r'/actions', rf'/actions/{UUID}',
            r'/skills', r'/runtime', r'/artifacts', rf'/artifacts/{UUID}/download', r'/tasks', r'/firm/profile', r'/audit', r'/notifications', r'/connections/(clinic|mail)', r'/schedules',
            r'/social/connections', r'/social/contacts', r'/social/searches', r'/social/contacts/export', r'/finance'],
    'POST': [r'/conversations', r'/chat', rf'/conversations/{UUID}/cancel', rf'/conversations/{UUID}/runs/{UUID}/cancel', rf'/actions/{UUID}/decision', rf'/actions/{UUID}/cancel',
             r'/tools/invoke', r'/files/upload', r'/connections/(clinic|mail)', r'/permissions', rf'/notifications/{UUID}/ack',
             r'/social/connections/(instagram|tiktok)/(start|save|disconnect|close)'],
}


class OperatorClient:
    def __init__(self, password, origin='http://127.0.0.1:18801'):
        self.url = 'http://127.0.0.1:18801'
        self.origin = origin
        self.password = password
        self.cookies = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf = None
        self.lock = threading.Lock()

    def login(self):
        if not self.password:
            raise ProjectError('Start the operational service to initialize its local connection.', 503)
        request = urllib.request.Request(self.url + '/api/auth/login',
            data=json.dumps({'login': 'matko', 'password': self.password}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': self.origin})
        with self.opener.open(request, timeout=8) as response:
            self.csrf = json.load(response)['csrf']

    def request(self, method, route, body=None):
        parsed = urllib.parse.urlsplit(route)
        if not any(re.fullmatch(pattern, parsed.path) for pattern in ROUTES.get(method, [])):
            raise ProjectError('This operational route is not available through the command center.', 403)
        if parsed.query and not (parsed.path == '/notifications' and re.fullmatch(r'after=[0-9]{1,15}', parsed.query)):
            raise ProjectError('Unsupported operational query.', 400)
        try:
            for attempt in range(2):
                # Snapshot a matching cookie/CSRF pair under the auth lock. Long
                # task waits must not block cancellation or progress requests.
                with self.lock:
                    if self.csrf is None:
                        self.login()
                    csrf = self.csrf
                    request = urllib.request.Request(self.url + '/api' + route, method=method,
                        data=json.dumps(body).encode() if body is not None else None,
                        headers={'Content-Type': 'application/json', 'Origin': self.origin, 'X-CSRF-Token': csrf})
                    self.cookies.add_cookie_header(request)
                try:
                    with self.opener.open(request, timeout=55) as response:
                        content = response.read(21 * 1024 * 1024)
                        return response.status, content, response.headers.get('Content-Type', 'application/json'), response.headers.get('Content-Disposition')
                except urllib.error.HTTPError as error:
                    try:
                        result = json.load(error)
                        detail = result.get('error', {})
                        message = detail.get('message') if isinstance(detail, dict) else detail
                    except (ValueError, OSError):
                        detail = {}
                        message = None
                    if error.code == 401 and attempt == 0 and isinstance(detail, dict) and detail.get('code') in ('AUTH_REQUIRED', 'INVALID_SESSION'):
                        # Only an explicit pre-admission auth rejection may retry.
                        with self.lock:
                            if self.csrf == csrf:
                                self.login()
                        continue
                    raise ProjectError(message or 'The operational request could not complete.', error.code) from error
        except ProjectError:
            raise
        except (OSError, ValueError, KeyError) as error:
            raise ProjectError('The operational service is unavailable. Start JARVIS again; accepted jobs retain their recorded state.', 503) from error
