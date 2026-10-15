"""Same-origin local Project Hub and the assistant's project-tool endpoint."""

import argparse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import threading
import socket
import time
import mimetypes
import uuid
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request

from .projects import ProjectError, Projects
from .jobs import Reviews, launch_coding
from .voice import MAX_AUDIO, Voice
from .gateway import Gateway
from .catalog import Catalog
from .conversations import Conversations
from .chat import Chat
from .chat_jobs import ChatJobs
from .calculate import calculate
from .weather import Weather
from .quick_replies import QuickReplies
from .operations import Operations
from .preferences import Preferences
from .operator_client import OperatorClient
from .connections import Connections
from . import whatsapp_calling

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.5.0'
MAX_BODY = 65536


class Hub:
    def __init__(self, projects, project_token, gateway_token, gateway_url='http://127.0.0.1:18789', reviews=True, voice=None, operator=None, connections=None):
        self.projects = projects
        self.project_token = project_token
        self.gateway_token = gateway_token
        self.gateway_url = gateway_url
        self.voice = voice
        self.operator = operator
        self.connections = connections or Connections(projects)
        self.weather = Weather()
        self.cookie = secrets.token_hex(32)
        self.reviews = Reviews(projects) if reviews else None
        self.chats = threading.BoundedSemaphore(2)
        self.lifecycle = threading.Lock()
        self.stopping = False
        self.active_chats = 0
        self.gateway = Gateway()
        self.catalog = Catalog(projects, self.gateway)
        self.conversations = Conversations(projects, self.gateway)
        self.quick_replies = QuickReplies(self)
        self.chat_service = Chat(self, self.conversations)
        self.chat_jobs = ChatJobs(self.chat_service)
        self.operations = Operations(projects)
        self.preferences = Preferences(projects)
        self.health_cache = None

    def chat(self, request):
        return self.chat_service.reply(request)

    def system(self, refresh=False):
        if self.health_cache and not refresh and time.monotonic() - self.health_cache[0] < 15:
            return self.health_cache[1]
        endpoints = [('OpenClaw', 'http://127.0.0.1:18789/healthz'), ('Ollama', 'http://127.0.0.1:11435/api/tags'),
                     ('Local voice', 'http://127.0.0.1:18792/health'), ('n8n', 'http://127.0.0.1:5679/healthz/readiness')]
        def probe(item):
            name, url = item
            started = time.monotonic()
            try:
                with urllib.request.urlopen(url, timeout=3) as response:
                    healthy = response.status == 200
                return {'name': name, 'status': 'healthy' if healthy else 'unavailable', 'latency_ms': round((time.monotonic() - started) * 1000)}
            except OSError:
                return {'name': name, 'status': 'unavailable', 'latency_ms': None}
        with ThreadPoolExecutor(max_workers=4) as pool:
            services = list(pool.map(probe, endpoints))
        model = 'OpenClaw configured model'
        try:
            value = self.gateway.command('config', 'get', 'agents.defaults.model', '--json', timeout=8, as_json=True)
            model = value.get('primary', model)
        except ProjectError:
            pass
        result = {'version': VERSION, 'services': services, 'model': model, 'projects': len(self.projects.list()),
                  'catalog': self.catalog.stats(), 'active_operations': self.operations.count()}
        self.health_cache = (time.monotonic(), result)
        return result

    def demo_workflow(self, progress):
        from sys import path
        if str(ROOT / 'scripts') not in path:
            path.insert(0, str(ROOT / 'scripts'))
        from init import read_env
        key = read_env()['JARVIS_WORKFLOW_TOKEN']
        identifier = str(uuid.uuid4())
        request = urllib.request.Request('http://127.0.0.1:5679/webhook/jarvis/demo-briefing',
            data=json.dumps({'schema_version': 1, 'request_id': identifier}).encode(),
            headers={'Content-Type': 'application/json', 'X-Jarvis-Key': key})
        progress({'message': 'Calling the authenticated n8n demonstration.'})
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        if result.get('request_id') != identifier or result.get('mode') != 'demo' or result.get('status') != 'completed':
            raise ProjectError('n8n did not return the expected demonstration result.', 502)
        return result


def handler_for(hub):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'JarvisProjectHub/' + VERSION

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, format_string, *args):
            # Body, query strings, cookies, and credentials are deliberately absent.
            print(f'{self.command} {urllib.parse.urlsplit(self.path).path} {args[1] if len(args) > 1 else ""}', flush=True)

        def respond(self, status, payload, content_type='application/json; charset=utf-8', cookie=False, disposition=None):
            # Drain small rejected bodies so closing a Windows socket does not reset
            # the connection before the client can read its JSON error response.
            if status >= 400 and not getattr(self, 'body_consumed', False):
                lengths = self.headers.get_all('Content-Length', [])
                if lengths and len(set(lengths)) == 1 and lengths[0].isdigit() and int(lengths[0]) <= MAX_BODY:
                    previous_timeout = self.connection.gettimeout()
                    try:
                        self.connection.settimeout(.2)
                        self.rfile.read(int(lengths[0]))
                    except OSError:
                        pass
                    finally:
                        self.connection.settimeout(previous_timeout)
                    self.body_consumed = True
            if not isinstance(payload, bytes):
                payload = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            asset = status == 200 and self.command == 'GET' and urllib.parse.urlsplit(self.path).path.startswith('/assets/')
            self.send_header('Cache-Control', 'private, max-age=31536000, immutable' if asset else 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if status == 401 and not getattr(self, 'session_authenticated', False):
                self.send_header('X-Jarvis-Session-Rejected', 'true')
            if disposition:
                self.send_header('Content-Disposition', disposition)
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if cookie:
                self.send_header('Set-Cookie', f'jarvis_hub={hub.cookie}; HttpOnly; SameSite=Strict; Path=/')
            try:
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def host_check(self):
            port = self.server.server_address[1]
            local_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
            hosts = local_hosts | {f'host.docker.internal:{port}'}
            if self.headers.get('Host', '') not in hosts:
                raise ProjectError('Unsupported host.', 403)
            origin = self.headers.get('Origin')
            if origin and origin not in {f'http://{host}' for host in local_hosts}:
                raise ProjectError('Cross-origin requests are not accepted.', 403)
            if self.headers.get('Sec-Fetch-Site') not in (None, 'none', 'same-origin'):
                raise ProjectError('Open Project Hub directly from its local URL.', 403)
            return local_hosts

        def identity(self):
            self.host_check()
            authorization = self.headers.get('Authorization', '')
            if authorization:
                if secrets.compare_digest(authorization.encode('utf-8'), ('Bearer ' + hub.project_token).encode('utf-8')):
                    return 'agent'
                raise ProjectError('Invalid project credential.', 401)
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get('Cookie', ''))
            except Exception as error:
                raise ProjectError('Invalid session cookie.', 401) from error
            value = cookie.get('jarvis_hub')
            if value and secrets.compare_digest(value.value.encode('utf-8'), hub.cookie.encode('utf-8')):
                if self.command != 'GET' and not self.headers.get('Origin'):
                    raise ProjectError('A same-origin browser request is required.', 403)
                return 'operator'
            raise ProjectError('Open Project Hub in your browser to start a local session.', 401)

        def raw_body(self, maximum):
            try:
                if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                    raise ProjectError('Use one Content-Length header and an unencoded JSON body.')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= maximum:
                    raise ProjectError(f'Request body must be between 1 and {maximum} bytes.', 413)
                self.body_consumed = True
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ProjectError('Incomplete request body.')
                return raw
            except socket.timeout as error:
                raise ProjectError('The request body timed out.', 408) from error
            except ValueError as error:
                raise ProjectError('Invalid request length.') from error

        def body(self, maximum=MAX_BODY):
            if self.headers.get_content_type() != 'application/json':
                raise ProjectError('Use application/json.', 415)
            try:
                value = json.loads(self.raw_body(maximum))
            except (ValueError, UnicodeError) as error:
                raise ProjectError('Invalid JSON request.') from error
            if not isinstance(value, dict):
                raise ProjectError('The request must be a JSON object.')
            return value

        def event_response(self, events):
            iterator = iter(events)
            first = next(iterator)  # Validate and reserve the turn before sending headers.
            self.close_connection = True
            def write(event):
                self.wfile.write(('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode())
                self.wfile.flush()
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Connection', 'close')
                self.end_headers()
                write(first)
                for event in iterator:
                    write(event)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            except Exception as error:
                try:
                    write({'type': 'error', 'error': str(error)})
                except OSError:
                    pass
            finally:
                iterator.close()

        def start_operation(self, kind, title, action, key=None):
            with hub.lifecycle:
                if hub.stopping:
                    raise ProjectError('Project Hub is stopping.', 503)
                result = hub.operations.start(kind, title, action, key)
            return self.respond(202, result)

        def dispatch(self):
            self.session_authenticated = False
            path = urllib.parse.urlsplit(self.path).path
            local_hosts = self.host_check()
            if self.command == 'GET' and path == '/health':
                return self.respond(200, {'service': 'jarvis-project-hub', 'version': VERSION, 'pid': os.getpid()})
            if self.command == 'GET' and path == '/api/session':
                if self.headers.get('Host') not in local_hosts or not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    raise ProjectError('Open the command center on this PC.', 403)
                return self.respond(200, {'version': VERSION}, cookie=True)
            frontend = ROOT / 'frontend/dist'
            if self.command == 'GET' and (path == '/' and (frontend / 'index.html').is_file() or path.startswith('/assets/')):
                if self.headers.get('Host') not in local_hosts or not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    raise ProjectError('The command center is local to this PC.', 403)
                relative = 'index.html' if path == '/' else urllib.parse.unquote(path).lstrip('/')
                asset = (frontend / relative).resolve()
                if not asset.is_relative_to(frontend.resolve()) or not asset.is_file():
                    raise ProjectError('Frontend asset not found.', 404)
                return self.respond(200, asset.read_bytes(), mimetypes.guess_type(asset)[0] or 'application/octet-stream', cookie=path == '/')
            if self.command == 'GET' and path == '/classic':
                if self.headers.get('Host') not in local_hosts:
                    raise ProjectError('The project dashboard is local to this PC.', 403)
                return self.respond(200, (ROOT / 'project_hub/web/index.html').read_bytes(), 'text/html; charset=utf-8', cookie=True)
            if self.command == 'GET' and path in ('/', '/app.js', '/voice.js', '/style.css', '/icon.svg'):
                if self.headers.get('Host') not in local_hosts or not ipaddress.ip_address(self.client_address[0]).is_loopback:
                    raise ProjectError('The project dashboard is local to this PC.', 403)
                file = ROOT / 'project_hub/web' / ('index.html' if path == '/' else path[1:])
                content_type = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml'}[file.suffix]
                return self.respond(200, file.read_bytes(), content_type + '; charset=utf-8', cookie=path == '/')
            if self.command == 'GET' and path == '/api/whatsapp/webhook':
                try:
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    challenge = whatsapp_calling.verify_handshake(query, os.environ.get('WHATSAPP_VERIFY_TOKEN', ''))
                except whatsapp_calling.WhatsAppError as error:
                    raise ProjectError(str(error), 403) from None
                return self.respond(200, challenge.encode('utf-8'), 'text/plain; charset=utf-8')
            if self.command == 'POST' and path == '/api/whatsapp/webhook':
                raw = self.raw_body(256 * 1024)
                try:
                    whatsapp_calling.verify_signature(raw, self.headers.get('X-Hub-Signature-256', ''),
                                                      os.environ.get('WHATSAPP_APP_SECRET', ''))
                    try:
                        payload = json.loads(raw)
                    except (ValueError, UnicodeError) as error:
                        raise ProjectError('Invalid webhook JSON.') from error
                    if not isinstance(payload, dict):
                        raise ProjectError('Invalid webhook payload.')
                    events = whatsapp_calling.parse_event(payload)
                except whatsapp_calling.WhatsAppError as error:
                    raise ProjectError(str(error), 403) from None
                return self.respond(200, {'received': True, 'events': events})
            if self.command == 'GET' and path == '/api/whatsapp/status':
                return self.respond(200, whatsapp_calling.configured(os.environ))
            role = self.identity()
            self.session_authenticated = True
            if self.command == 'GET' and path == '/api/projects':
                return self.respond(200, {'projects': hub.projects.list()})
            if self.command == 'POST' and path == '/api/tool':
                body = self.body()
                return self.respond(200, hub.connections.tool(body) if body.get('action') in ('connections', 'compatibility') else hub.projects.tool(body))
            if self.command == 'GET' and path == '/api/connections':
                values = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                try:
                    start, limit = int(values.get('start', ['1'])[0]), int(values.get('limit', ['50'])[0])
                except ValueError as error:
                    raise ProjectError('Connection page values must be integers.') from error
                return self.respond(200, hub.connections.catalog(values.get('q', [''])[0], start, limit))
            if self.command == 'GET' and re.fullmatch(r'/api/connections/[a-z0-9][a-z0-9-]{0,63}', path):
                values = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                return self.respond(200, hub.connections.compatibility(path.rsplit('/', 1)[-1], refresh=values.get('refresh') == ['1']))
            if self.command == 'POST' and path == '/api/calculate':
                return self.respond(200, calculate(self.body().get('expression')))
            if self.command == 'POST' and path == '/api/weather':
                body = self.body()
                scope = body.get('scope', 'current')
                if scope not in ('current', 'forecast'): raise ProjectError('Choose current weather or forecast.')
                result = hub.weather.lookup(body.get('location'), body.get('country_code'))
                if scope == 'current': result.pop('forecast', None)
                return self.respond(200, result)
            if self.command == 'GET' and path == '/api/capabilities':
                values = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                action, search = values.get('action', ['search'])[0], values.get('q', [''])[0]
                try:
                    limit = min(20, max(1, int(values.get('limit', [8])[0])))
                except ValueError as error:
                    raise ProjectError('Capability limit must be an integer.') from error
                if action == 'search':
                    result = hub.catalog.search(search, limit=limit)
                    result['entry_kind'] = 'skill'
                    result['activation'] = 'Use Command Center > Skills library > Install selected version, then Installed > Enable after requirements pass. These are skills, not plugins; plugin enable commands do not activate SKILL.md entries.'
                    result['items'] = [{key: item[key] for key in ('id','name','owner','version','status','license','url','topics')}
                                       | {'description': item['description'][:450]} for item in result['items']]
                    return self.respond(200, result)
                if action == 'installed':
                    skills = [item for item in hub.gateway.skills() if search.lower() in (item['name'] + ' ' + item['description']).lower()]
                    return self.respond(200, {'total': len(skills), 'items': [{key:item.get(key) for key in ('name','ready','missing','modelVisible','source')}
                        | {'description':item['description'][:300]} for item in skills[:limit]]})
                raise ProjectError('Choose search or installed.')
            if role != 'operator':
                raise ProjectError('This operation is available from the local project dashboard or CLI.', 403)
            if path.startswith('/api/operator/'):
                if not hub.operator:
                    raise ProjectError('The operational connection is not configured. Restart JARVIS after setup.', 503)
                body = self.body(28 * 1024 * 1024 if path == '/api/operator/files/upload' else 128 * 1024) if self.command == 'POST' else None
                with hub.lifecycle:
                    if hub.stopping:
                        raise ProjectError('Project Hub is stopping.', 503)
                    hub.active_chats += 1
                try:
                    status, data, media, disposition = hub.operator.request(self.command, self.path[len('/api/operator'):], body)
                    return self.respond(status, data, media, disposition=disposition)
                finally:
                    with hub.lifecycle:
                        hub.active_chats -= 1
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            if self.command == 'GET' and path == '/api/system':
                return self.respond(200, hub.system(query.get('refresh') == ['true']))
            if self.command == 'GET' and path == '/api/preferences':
                return self.respond(200, hub.preferences.get())
            if self.command == 'POST' and path == '/api/preferences':
                return self.respond(200, hub.preferences.save(self.body()))
            if self.command == 'GET' and path == '/api/catalog':
                return self.respond(200, hub.catalog.search(query.get('q', [''])[0], query.get('category', [''])[0],
                    query.get('page', [0])[0], query.get('limit', [30])[0], query.get('generation', [None])[0]))
            if self.command == 'GET' and path == '/api/catalog/detail':
                return self.respond(200, hub.catalog.get(query.get('id', [''])[0]))
            if self.command == 'POST' and path == '/api/catalog/sync':
                self.body()
                target = max(12000, hub.catalog.stats()['available'] + 1000)
                return self.start_operation('catalog', 'Expand skill catalog', lambda progress: hub.catalog.sync(progress, target), 'catalog-sync')
            if self.command == 'POST' and path == '/api/catalog/install':
                body = self.body()
                entry = hub.catalog.get(body.get('id'))
                return self.start_operation('skill-install', 'Install ' + entry['name'], lambda progress: hub.catalog.install(entry['id'], progress), entry['id'])
            if self.command == 'GET' and path == '/api/skills':
                return self.respond(200, {'skills': hub.gateway.skills(query.get('refresh') == ['true'])})
            if self.command == 'POST' and path == '/api/skills/enable':
                name = self.body().get('name')
                if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}', name):
                    raise ProjectError('Select a valid installed skill name.')
                return self.start_operation('skill-enable', 'Enable ' + name, lambda progress: hub.gateway.enable_skill(name), 'enable-' + name)
            if self.command == 'GET' and path == '/api/operations':
                return self.respond(200, {'operations': hub.operations.list()})
            if self.command == 'GET' and path.startswith('/api/operations/'):
                return self.respond(200, hub.operations.get(path.rsplit('/', 1)[-1]))
            if self.command == 'POST' and path == '/api/workflows/demo':
                self.body()
                return self.start_operation('workflow', 'n8n connection demonstration', hub.demo_workflow)
            if self.command == 'GET' and path == '/api/conversations':
                return self.respond(200, {'conversations': hub.conversations.list(query.get('project', [None])[0])})
            if self.command == 'POST' and path == '/api/conversations':
                body = self.body()
                return self.respond(201, hub.conversations.ensure(body.get('project'), body.get('thread')))
            if self.command == 'GET' and path == '/api/conversations/history':
                result = hub.conversations.history(query.get('project', [None])[0], query.get('thread', [None])[0], query.get('offset', [0])[0])
                with hub.lifecycle:
                    result['active'] = result['active'] or result['conversation']['session'] in hub.chat_service.sessions
                return self.respond(200, result)
            if self.command == 'POST' and path == '/api/conversations/abort':
                body = self.body()
                hub.chat_jobs.cancel_thread(body.get('project'), body.get('thread'))
                return self.respond(200, hub.conversations.abort(body.get('project'), body.get('thread')))
            if self.command == 'POST' and path == '/api/chat/jobs':
                return self.respond(202, hub.chat_jobs.start(self.body()))
            match = re.fullmatch(r'/api/chat/jobs/([0-9a-f]{32})(/cancel)?', path)
            if match:
                if self.command == 'GET' and not match[2]:
                    return self.respond(200, hub.chat_jobs.get(match[1], query.get('project', [None])[0], query.get('thread', [None])[0], query.get('offset', [0])[0]))
                if self.command == 'POST' and match[2]:
                    body = self.body()
                    return self.respond(200, hub.chat_jobs.cancel(match[1], body.get('project'), body.get('thread')))
                raise ProjectError('Unsupported voice turn operation.', 405)
            if self.command == 'GET' and path == '/api/voice/status':
                return self.respond(200, hub.voice.status() if hub.voice else {'available': False, 'voices': [], 'message': 'Local voice is not configured.'})
            if self.command == 'POST' and path in ('/api/voice/transcribe', '/api/voice/speak'):
                if not hub.voice:
                    raise ProjectError('Local voice is not configured.', 503)
                with hub.lifecycle:
                    if hub.stopping:
                        raise ProjectError('Project Hub is stopping.', 503)
                    hub.active_chats += 1
                try:
                    if path.endswith('/transcribe'):
                        result = hub.voice.transcribe(self.raw_body(MAX_AUDIO), self.headers.get_content_type())
                        return self.respond(200, result)
                    body = self.body()
                    return self.respond(200, hub.voice.speak(body.get('text'), body.get('voice', 'bm_george')), 'audio/wav')
                finally:
                    with hub.lifecycle:
                        hub.active_chats -= 1
            if self.command == 'POST' and path == '/api/projects':
                body = self.body()
                return self.respond(201, hub.projects.connect(body.get('name'), body.get('roots'), body.get('id')))
            if self.command == 'DELETE' and path.startswith('/api/projects/'):
                return self.respond(200, hub.projects.disconnect(path.rsplit('/', 1)[-1]))
            if self.command == 'POST' and path == '/api/chat':
                body = self.body()
                if body.get('stream') is True:
                    return self.event_response(hub.chat_service.events(body))
                return self.respond(200, hub.chat(body))
            if self.command == 'POST' and path == '/api/coding/open':
                body = self.body()
                return self.respond(200, launch_coding(hub.projects.root(body.get('project'), body.get('root'))))
            if self.command == 'POST' and path == '/api/reviews' and hub.reviews:
                body = self.body()
                with hub.lifecycle:
                    if hub.stopping:
                        raise ProjectError('Project Hub is stopping.', 503)
                    job = hub.reviews.start(body)
                return self.respond(202, job)
            if self.command == 'GET' and path.startswith('/api/reviews/') and hub.reviews:
                return self.respond(200, hub.reviews.get(path.rsplit('/', 1)[-1]))
            if self.command == 'GET' and path == '/api/reviews' and hub.reviews:
                project = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('project', [None])[0]
                return self.respond(200, {'jobs': hub.reviews.latest(project)})
            if self.command == 'POST' and path == '/api/shutdown':
                self.body()
                with hub.lifecycle:
                    if hub.active_chats or hub.operations.count() or (hub.reviews and hub.reviews.active_count()):
                        raise ProjectError('Wait for active chats/reviews to finish before stopping Project Hub.', 409)
                    hub.stopping = True
                self.respond(200, {'stopping': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            raise ProjectError('Endpoint not found.', 404)

        def handle_request(self):
            try:
                self.dispatch()
            except ProjectError as error:
                self.respond(error.status, {'error': str(error)})
            except FileNotFoundError:
                self.respond(404, {'error': 'The selected folder or source file no longer exists.'})
            except (PermissionError, NotADirectoryError):
                self.respond(403, {'error': 'The selected source path cannot be read.'})
            except Exception as error:
                print(f'Unhandled {type(error).__name__}: {error}', flush=True)
                self.respond(500, {'error': 'Project Hub encountered an internal error. Check logs/project-hub.log.'})

        do_GET = handle_request
        do_POST = handle_request
        do_DELETE = handle_request

    return Handler


class HubServer(ThreadingHTTPServer):
    allow_reuse_address = False


def serve(port=18791):
    # Import from this project's existing initializer rather than duplicating secret handling.
    import sys
    sys.path.insert(0, str(ROOT / 'scripts'))
    from init import initialize
    env = initialize()
    # Bind before recovering interrupted jobs: a second launch must not touch live jobs.
    server = HubServer(('127.0.0.1', port), BaseHTTPRequestHandler)
    hub = None
    server.daemon_threads = True
    try:
        projects = Projects(ROOT / 'runtime/project-hub.sqlite')
        registry = Connections(projects, json.loads((ROOT / 'config/connections.json').read_text(encoding='utf-8')), environment=env)
        hub = Hub(projects, env['JARVIS_PROJECT_TOKEN'], env['OPENCLAW_GATEWAY_TOKEN'],
                  voice=Voice(env['JARVIS_VOICE_TOKEN'], base_url=env.get('JARVIS_SPEECH_URL', 'http://127.0.0.1:18902')),
                  operator=OperatorClient(env.get('JARVIS_OPERATOR_ADMIN_PASSWORD'), env.get('JARVIS_PUBLIC_ORIGIN', 'http://127.0.0.1:18801')), connections=registry)
        server.RequestHandlerClass = handler_for(hub)
        print(f'JARVIS Project Hub {VERSION}: http://127.0.0.1:{port}', flush=True)
        server.serve_forever()
    finally:
        server.server_close()
        if hub and hub.reviews:
            hub.reviews.pool.shutdown(wait=True)
        if hub:
            hub.operations.pool.shutdown(wait=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18791)
    serve(parser.parse_args().port)
