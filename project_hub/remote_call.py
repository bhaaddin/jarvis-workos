"""Authenticated, call-only loopback relay for a temporary HTTPS notebook link."""

import argparse
import base64
from collections import OrderedDict
import gzip
import hashlib
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from .operator_client import ROUTES as OPERATOR_ROUTES

HUB = 'http://127.0.0.1:18791'
MAX_RESPONSE = 32 * 1024 * 1024
# One-click tokens live as long as the tunnel itself (8h): a tap must open the
# call, not a password popup, at any point while the link is alive. The bearer
# lives only in the owner's private bot chat; the tunnel death kills it anyway.
CALL_TOKEN_TTL = 8 * 3600


def mint_call_token(secret, now=None):
    """Short-lived signed token for one-click call entry. Stateless on verify."""
    import hashlib
    import hmac as hmac_module
    moment = str(int((now if now is not None else time.time()) + CALL_TOKEN_TTL))
    signature = hmac_module.new(secret.encode('utf-8'), moment.encode('utf-8'), hashlib.sha256).hexdigest()
    return moment + '.' + signature


def valid_call_token(secret, token, now=None):
    """Constant-time check of a minted token. No server state, no replay list."""
    import hashlib
    import hmac as hmac_module
    if not secret or not isinstance(token, str):
        return False
    try:
        moment, signature = token.split('.', 1)
        moment_int = int(moment)
    except (ValueError, AttributeError):
        return False
    if moment_int <= (now if now is not None else time.time()):
        return False
    expected = hmac_module.new(secret.encode('utf-8'), moment.encode('utf-8'), hashlib.sha256).hexdigest()
    return secrets.compare_digest(signature.encode('utf-8'), expected.encode('utf-8'))
GET_PATHS = {'/', '/icon.svg', '/api/session', '/api/projects', '/api/preferences',
             '/api/system', '/api/voice/status', '/api/conversations', '/api/conversations/history'}
POST_PATHS = {'/api/chat', '/api/conversations', '/api/conversations/abort',
              '/api/voice/transcribe', '/api/voice/speak', '/api/chat/jobs'}
EMPTY_LISTS = {'/api/skills': 'skills', '/api/operations': 'operations', '/api/reviews': 'jobs'}
PROJECT_READ_ACTIONS = {'list', 'connections', 'compatibility', 'overview', 'tree', 'read', 'search', 'git', 'instructions'}


def accepts_gzip(value):
    """Honor an explicit gzip opt-out even when a wildcard is also present."""
    choices = {}
    if len(value) > 1024:
        return False
    for item in value.lower().split(','):
        parts = [part.strip() for part in item.split(';')]
        if parts[0] not in ('gzip', '*'):
            continue
        quality = 1.0
        try:
            values = [part[2:].strip() for part in parts[1:] if part.startswith('q=')]
            if len(values) > 1:
                quality = 0
            elif values:
                quality = float(values[0])
        except ValueError:
            quality = 0
        choices[parts[0]] = quality if 0 <= quality <= 1 else 0
    return choices.get('gzip', choices.get('*', 0)) > 0


class AssetCompressor:
    """Bounded cache of public build assets; no pages, API data or speech audio."""
    def __init__(self, max_bytes=16 * 1024 * 1024):
        self.max_bytes = max_bytes
        self.bytes = 0
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def encode(self, body):
        key = hashlib.sha256(body).digest()
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            compressed = gzip.compress(body, compresslevel=6, mtime=0)
            result = compressed if len(compressed) < len(body) else None
            size = len(result) if result is not None else 0
            if size <= self.max_bytes:
                while self.cache and (self.bytes + size > self.max_bytes or len(self.cache) >= 32):
                    _, old = self.cache.popitem(last=False)
                    self.bytes -= len(old) if old is not None else 0
                self.cache[key] = result
                self.bytes += size
            return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


class RelayServer(ThreadingHTTPServer):
    def __init__(self, *args, **kwargs):
        self.connections = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def process_request(self, request, address):
        request.settimeout(30)
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()


class HubClient:
    def __init__(self):
        self.cookie = None
        self.lock = threading.Lock()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def session(self, renew=False):
        with self.lock:
            if self.cookie is None or renew:
                with self.opener.open(HUB + '/api/session', timeout=10) as response:
                    values = SimpleCookie()
                    values.load(response.headers.get('Set-Cookie', ''))
                    self.cookie = 'jarvis_hub=' + values['jarvis_hub'].value
            return self.cookie

    def request(self, method, path, data, content_type):
        for attempt in range(2):
            request = urllib.request.Request(HUB + path, data=data, method=method, headers={
                'Cookie': self.session(renew=attempt == 1), 'Origin': HUB,
                'Content-Type': content_type, 'Accept-Encoding': 'identity',
            })
            try:
                response = self.opener.open(request, timeout=245)
            except urllib.error.HTTPError as error:
                if error.code == 401 and attempt == 0 and error.headers.get('X-Jarvis-Session-Rejected') == 'true':
                    error.close()
                    continue  # The Hub rejected authentication before any action.
                response = error
            with response:
                if 300 <= response.status < 400:
                    raise ValueError('The local Hub unexpectedly redirected a notebook request.')
                body = response.read(MAX_RESPONSE + 1)
                if len(body) > MAX_RESPONSE:
                    raise ValueError('The response exceeded the notebook relay limit.')
                return response.status, body, response.headers.get('Content-Type', 'application/json'), response.headers.get('Content-Disposition')
        raise RuntimeError('Local Hub authentication failed.')


def handler(config_path, client=None):
    client = client or HubClient()
    slots = threading.BoundedSemaphore(16)
    assets = AssetCompressor()

    class Handler(BaseHTTPRequestHandler):
        server_version = 'JARVIS-Notebook'

        def log_message(self, format, *args):
            # Never log Authorization, cookies, request bodies, or URL credentials.
            print(f'{self.command} {urllib.parse.urlsplit(self.path).path} {args[1] if len(args) > 1 else ""}', flush=True)

        def respond(self, code, body, media='application/json', challenge=False,
                      disposition=None, call_cookie=None):
            # Closing a Windows socket with an unread POST body can replace a
            # legitimate HTTP denial with a reset. Discard only a small, bounded
            # declared body; never parse, forward or indefinitely wait for it.
            if code >= 400:
                query = urllib.parse.urlsplit(self.path).query
                print(f'DENY {self.command} {urllib.parse.urlsplit(self.path).path} {code} '
                      f'fetch-site={self.headers.get("Sec-Fetch-Site")} fetch-mode={self.headers.get("Sec-Fetch-Mode")} '
                      f'origin={self.headers.get("Origin")} '
                      f'auth={bool(self.headers.get("Authorization"))} callq={bool(query)}', flush=True)
            if code >= 400 and not getattr(self, '_body_read', False) and not self.headers.get('Transfer-Encoding'):
                lengths = self.headers.get_all('Content-Length', [])
                if len(lengths) == 1 and lengths[0].isdigit() and 0 < int(lengths[0]) <= 65536:
                    previous = self.connection.gettimeout()
                    try:
                        self.connection.settimeout(.25)
                        self.rfile.read(int(lengths[0]))
                    except OSError:
                        pass
                    finally:
                        self.connection.settimeout(previous)
                    self._body_read = True
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            path = urllib.parse.urlsplit(self.path).path
            asset = code == 200 and self.command == 'GET' and path.startswith('/assets/')
            compressed = None
            if asset and path.endswith(('.wasm', '.onnx', '.js', '.mjs', '.css', '.svg')) and len(body) >= 1024 and accepts_gzip(self.headers.get('Accept-Encoding', '')):
                # Compress on the PC, before the raw WASM/model crosses the
                # uplink. Cloudflare's downstream compression alone is too late.
                compressed = assets.encode(body)
            if compressed is not None:
                body = compressed
            self.send_response(code)
            self.send_header('Content-Type', media)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Connection', 'close')
            if asset:
                self.send_header('Vary', 'Accept-Encoding')
            if compressed is not None:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Cache-Control', 'private, max-age=31536000, immutable' if asset else 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if disposition:
                self.send_header('Content-Disposition', disposition)
            self.send_header('Permissions-Policy', 'microphone=(self), camera=()')
            if call_cookie:
                self.send_header('Set-Cookie', 'jarvis_call=' + call_cookie + '; Path=/; SameSite=Lax; Secure')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if challenge:
                self.send_header('WWW-Authenticate', 'Basic realm="JARVIS notebook call", charset="UTF-8"')
            try:
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def dispatch(self):
            self.connection.settimeout(30)
            config = json.loads(Path(config_path).read_text(encoding='utf-8'))
            url = urllib.parse.urlsplit(config.get('url', ''))
            local_host = f'127.0.0.1:{self.server.server_port}'
            host = self.headers.get('Host', '')
            if host not in {local_host, url.netloc} or not host:
                return self.respond(403, {'error': 'Unexpected notebook relay host.'})
            if time.time() >= config['expires']:
                return self.respond(410, {'error': 'This temporary notebook link expired. Run JARVIS Notebook on the PC again.'})
            call_token = ''
            query_token = (urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('call') or [''])[0]
            query_had_call = bool(query_token)
            if query_token and valid_call_token(config.get('call_secret', ''), query_token):
                call_token = query_token
            else:
                jarvis_call = SimpleCookie()
                try:
                    jarvis_call.load(self.headers.get('Cookie', ''))
                except Exception:
                    pass
                cookie_token = jarvis_call.get('jarvis_call')
                if cookie_token is not None and valid_call_token(config.get('call_secret', ''), cookie_token.value):
                    call_token = cookie_token.value
            expected = 'Basic ' + base64.b64encode((config['username'] + ':' + config['password']).encode()).decode()
            if not call_token and not secrets.compare_digest(self.headers.get('Authorization', '').encode(), expected.encode()):
                if query_had_call:
                    page = ('<!doctype html><html lang="en"><head><meta charset="UTF-8">'
                            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
                            '<title>JARVIS call link expired</title></head>'
                            '<body style="background:#0a0f1a;color:#e2e8f0;font-family:sans-serif;padding:40px 24px;text-align:center">'
                            '<h1>This call link expired</h1>'
                            '<p>Send <b>/call</b> to your JARVIS bot in Telegram for a fresh one-click link, '
                            'or sign in with the notebook username and password shown on your PC.</p>'
                            '</body></html>').encode()
                    return self.respond(200, page, media='text/html')
                return self.respond(401, {'error': 'Enter the notebook username and password shown on your PC.'}, challenge=True)
            origin = self.headers.get('Origin')
            accepted_origin = 'http://' + local_host if host == local_host else config['url']
            if (origin and origin != accepted_origin) or (self.command == 'POST' and origin != accepted_origin):
                return self.respond(403, {'error': 'Open the notebook link directly in your browser.'})
            # In-app browsers (e.g. tapping a link inside Telegram) send
            # Sec-Fetch-Site: cross-site on the top-level navigation. Allow that
            # visible navigation; keep denying cross-site subresource/fetch calls.
            # Forged cross-site POSTs stay harmless: the session cookie is
            # SameSite=Lax (never sent on them) and framing is CSP-blocked.
            fetch_site = self.headers.get('Sec-Fetch-Site')
            fetch_mode = self.headers.get('Sec-Fetch-Mode')
            if fetch_site not in (None, 'none', 'same-origin') and not (
                    fetch_site == 'cross-site' and fetch_mode in ('navigate', 'nested-navigate')):
                return self.respond(403, {'error': 'Cross-site relay requests are not accepted.'})

            parsed = urllib.parse.urlsplit(self.path)
            path = parsed.path
            if parsed.scheme or parsed.netloc or '\\' in self.path or self.path.startswith('//'):
                return self.respond(400, {'error': 'Invalid notebook request path.'})
            if path == '/health' and self.command == 'GET':
                return self.respond(200, {'service': 'jarvis-notebook-relay', 'expires': config['expires'], 'pid': os.getpid()})
            if path == '/api/session' and self.command == 'GET':
                return self.respond(200, {'remote': True, 'operator': config.get('operator_enabled', False), 'version': '0.4.0'})
            if self.command == 'GET' and path in EMPTY_LISTS:
                return self.respond(200, {EMPTY_LISTS[path]: []})
            allowed_get = path in GET_PATHS or bool(re.fullmatch(r'/assets/[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2?|onnx|wasm|svg)', path)) or bool(re.fullmatch(r'/api/chat/jobs/[0-9a-f]{32}', path))
            allowed_post = path in POST_PATHS or bool(re.fullmatch(r'/api/chat/jobs/[0-9a-f]{32}/cancel', path))
            operator_route = path[len('/api/operator'):] if path.startswith('/api/operator/') else ''
            allowed_operator = config.get('operator_enabled') is True and any(re.fullmatch(pattern, operator_route) for pattern in OPERATOR_ROUTES.get(self.command, []))
            project_read = config.get('operator_enabled') is True and (self.command == 'POST' and path == '/api/tool' or self.command == 'GET' and bool(re.fullmatch(r'/api/connections(?:/[a-z0-9][a-z0-9-]{0,63})?', path)))
            if not ((self.command == 'GET' and allowed_get) or (self.command == 'POST' and allowed_post) or allowed_operator or project_read):
                return self.respond(403, {'error': 'The notebook link provides calls and conversations only.'})
            data = None
            media = self.headers.get('Content-Type', 'application/json')
            if self.command == 'POST':
                maximum = 28 * 1024 * 1024 if path == '/api/operator/files/upload' and allowed_operator else 10 * 1024 * 1024 if path == '/api/voice/transcribe' else 128 * 1024 if allowed_operator else 65536
                lengths = self.headers.get_all('Content-Length', [])
                if self.headers.get('Transfer-Encoding') or len(lengths) != 1:
                    return self.respond(400, {'error': 'One Content-Length header is required.'})
                size = int(lengths[0])
                if not 0 < size <= maximum:
                    return self.respond(413, {'error': 'The notebook request is too large or empty.'})
                self._body_read = True
                data = self.rfile.read(size)
                if len(data) != size:
                    return self.respond(400, {'error': 'Incomplete notebook request.'})
                if project_read:
                    value = json.loads(data)
                    if self.headers.get_content_type() != 'application/json' or not isinstance(value, dict) or value.get('action') not in PROJECT_READ_ACTIONS or set(value) - {'action', 'project', 'root', 'path', 'query', 'start', 'limit'}:
                        return self.respond(403, {'error': 'Notebook project access permits declared source reads only.'})
                if path == '/api/chat':
                    if self.headers.get_content_type() != 'application/json':
                        return self.respond(415, {'error': 'Use JSON for a call message.'})
                    value = json.loads(data)
                    if not isinstance(value, dict):
                        return self.respond(400, {'error': 'Expected a call message object.'})
                    # Quick Tunnels do not support SSE. The browser uses buffered replies.
                    value['stream'] = False
                    data = json.dumps(value).encode()
            if time.time() >= json.loads(Path(config_path).read_text(encoding='utf-8'))['expires']:
                return self.respond(410, {'error': 'The notebook link has expired.'})
            forwarded = client.request(self.command, self.path, data, media)
            code, body, content_type = forwarded[:3]
            disposition = forwarded[3] if len(forwarded) > 3 else None
            if path == '/' and code == 200:
                body = body.replace(b'</head>', b'<meta name="jarvis-remote-call" content="true"></head>')
                if config.get('operator_enabled') is True:
                    body = body.replace(b'</head>', b'<meta name="jarvis-operator-enabled" content="true"></head>')
            self.respond(code, body, content_type, disposition=disposition,
                         call_cookie=query_token if query_token and call_token == query_token else None)

        def handle_request(self):
            self._body_read = False
            if not slots.acquire(blocking=False):
                return self.respond(429, {'error': 'The notebook connection is busy.'})
            try:
                self.dispatch()
            except (ValueError, UnicodeError):
                self.respond(400, {'error': 'Malformed notebook request.'})
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            except (OSError, KeyError, RuntimeError):
                self.respond(503, {'error': 'The PC connection is unavailable. Check JARVIS on the PC.'})
            finally:
                slots.release()

        do_GET = do_POST = do_OPTIONS = do_DELETE = do_PUT = do_PATCH = handle_request

    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--port', type=int, default=18794)
    args = parser.parse_args()
    server = RelayServer(('127.0.0.1', args.port), handler(args.config))
    print(f'Notebook relay listening on loopback port {args.port}.', flush=True)
    server.serve_forever()
