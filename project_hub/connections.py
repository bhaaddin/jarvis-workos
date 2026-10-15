"""Validated source adapters and explicit read-only runtime contract probes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import re
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

from .projects import ProjectError, allowed_name, git, git_root, is_link, read_text, slug

ADAPTERS = {
    'local-source': {'kind': 'source', 'capabilities': ['tree', 'read', 'search', 'instructions']},
    'git-source': {'kind': 'source', 'capabilities': ['tree', 'read', 'search', 'instructions', 'git'], 'checkoutForms': ['normal', 'sparse', 'worktree', 'external-gitdir']},
    'http-health': {'kind': 'runtime', 'capabilities': ['readiness-probe']},
    'http-json': {'kind': 'runtime', 'capabilities': ['declared-json-contract-probe']},
    'ollama': {'kind': 'runtime', 'capabilities': ['version', 'model-catalog']},
    'openai-models': {'kind': 'runtime', 'capabilities': ['authenticated-model-catalog']},
    'openapi': {'kind': 'runtime', 'capabilities': ['advertised-api-contract']},
    'fhir': {'kind': 'runtime', 'capabilities': ['capability-statement']},
}
ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
MANIFESTS = ('package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'global.json', 'composer.json', 'Gemfile', 'CMakeLists.txt')


def clean_remote(value):
    """Never retain credentials, query parameters or local Git transport paths."""
    value = value.strip()
    match = re.fullmatch(r'[^@/:]+@([^/:]+):(.+)', value)
    if match:
        value = 'https://' + match[1] + '/' + match[2]
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ('http', 'https', 'ssh') or not parsed.hostname:
        return None
    route = parsed.path.rstrip('/').removesuffix('.git')
    if not re.fullmatch(r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', route):
        return None
    return 'https://' + parsed.hostname + route


def validate_runtime(value):
    permitted = {'id', 'adapter', 'baseUrl', 'path', 'credentialEnv', 'expected', 'expectedModelIds', 'description'}
    if not isinstance(value, dict) or set(value) - permitted or not ID.fullmatch(str(value.get('id', ''))):
        raise ProjectError('Invalid connection metadata.')
    if value.get('adapter') not in ADAPTERS or ADAPTERS[value['adapter']]['kind'] != 'runtime':
        raise ProjectError('Unknown runtime adapter; no generic fallback was selected.')
    base = value.get('baseUrl')
    if base is not None:
        if not isinstance(base, str) or len(base) > 400:
            raise ProjectError('Use a bounded service URL.')
        parsed = urllib.parse.urlsplit(base)
        try:
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                raise ValueError('Invalid port')
        except ValueError as error:
            raise ProjectError('The service URL has an invalid port.') from error
        local = parsed.hostname in ('127.0.0.1', 'localhost', '::1')
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.scheme not in ('http', 'https') or parsed.scheme == 'http' and not local:
            raise ProjectError('Use HTTPS or a loopback HTTP service URL without embedded credentials.')
    route = value.get('path', '/')
    if not isinstance(route, str) or len(route) > 300 or not route.startswith('/') or route.startswith('//') or '\\' in route or '?' in route or '#' in route or any(ord(char)<32 for char in route) or any(part == '..' for part in route.split('/')):
        raise ProjectError('Use a fixed service-relative probe path.')
    credential = value.get('credentialEnv')
    if credential is not None and (not isinstance(credential, str) or not re.fullmatch(r'JARVIS_[A-Z0-9_]{1,80}', credential)):
        raise ProjectError('Use a JARVIS environment-key reference, never a credential value.')
    expected = value.get('expected', {})
    if not isinstance(expected, dict) or len(expected) > 10 or any(not isinstance(k, str) or not isinstance(v, (str, int, float, bool)) for k, v in expected.items()):
        raise ProjectError('Expected contract fields must be a bounded scalar map.')
    if value['adapter'] == 'http-json' and not expected:
        raise ProjectError('A JSON adapter requires explicit expected contract fields.')
    ids = value.get('expectedModelIds', [])
    if not isinstance(ids, list) or len(ids) > 20 or any(not isinstance(item, str) or len(item) > 200 for item in ids):
        raise ProjectError('Expected model IDs must be bounded strings.')
    if not isinstance(value.get('description', ''), str) or len(value.get('description', '')) > 1000:
        raise ProjectError('Use a bounded connection description.')
    return dict(value)


def validate_catalog(value):
    if not isinstance(value, dict) or set(value) - {'version', 'locations', 'extras', 'runtimes'} or value.get('version') != 1:
        raise ProjectError('Unsupported connection registry version.')
    for field in ('locations', 'extras'):
        items = value.get(field, [])
        if not isinstance(items, list) or len(items) > 50:
            raise ProjectError('Use a bounded set of clone locations.')
        for item in items:
            if not isinstance(item, dict) or set(item) - {'id', 'path', 'name', 'category'} or not ID.fullmatch(str(item.get('id', ''))) or not isinstance(item.get('path'), str):
                raise ProjectError('Invalid clone-location metadata.')
    runtimes = value.get('runtimes', {})
    if not isinstance(runtimes, dict) or len(runtimes) > 100:
        raise ProjectError('Invalid runtime connection registry.')
    for project, items in runtimes.items():
        if not ID.fullmatch(project) or not isinstance(items, list) or len(items) > 8:
            raise ProjectError('Invalid per-project connections.')
        checked = [validate_runtime(item) for item in items]
        if len({item['id'] for item in checked}) != len(checked):
            raise ProjectError('Connection IDs must be unique within their project.')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


class Connections:
    def __init__(self, projects, config=None, workspace=None, environment=None, opener=None):
        self.projects = projects
        self.workspace = Path(workspace or Path(__file__).resolve().parents[1])
        self.config = validate_catalog(config or {'version': 1})
        self.environment = environment or {}
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.cache = {}
        self.lock = threading.Lock()

    def source(self, project_id, root_id):
        root = self.projects.root(project_id, root_id)
        repository = git_root(root)
        result = {'root': root_id, 'adapter': 'git-source' if repository else 'local-source', 'state': 'source_ready',
                  'sourceAccess': 'read-only', 'revision': None, 'upstream': None, 'sparse': False, 'manifests': [], 'licenseFiles': []}
        if repository:
            code, output, _ = git(root, 'rev-parse', 'HEAD')
            result['revision'] = output.decode().strip() if code == 0 else None
            code, output, _ = git(root, 'config', '--get', 'remote.origin.url')
            if code == 0:
                result['upstream'] = clean_remote(output.decode('utf-8', 'replace'))
            code, output, _ = git(root, 'config', '--bool', '--get', 'core.sparseCheckout')
            result['sparse'] = code == 0 and output.strip() == b'true'
            result['checkoutForm'] = 'sparse' if result['sparse'] else 'normal'
            if (root / '.git').is_file():
                code, gitdir, _ = git(root, 'rev-parse', '--absolute-git-dir')
                common_code, common, _ = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')
                result['checkoutForm'] = 'worktree' if code == 0 and common_code == 0 and gitdir.strip() != common.strip() else 'external-gitdir'
        candidates = []
        for index, entry in enumerate(sorted(root.iterdir(), key=lambda item: item.name.casefold())):
            if index >= 200:
                break
            if entry.is_file() and not is_link(entry) and allowed_name(entry.name):
                candidates.append(entry.name)
                if entry.name.lower().startswith(('license', 'copying', 'notice')):
                    result['licenseFiles'].append(entry.name)
        for name in MANIFESTS:
            if name not in candidates:
                continue
            item = {'path': name, 'state': 'readable', 'requirements': {}}
            try:
                text = read_text(root, name)
                if name in ('package.json', 'global.json', 'composer.json'):
                    manifest = json.loads(text)
                    if not isinstance(manifest, dict):
                        raise ValueError('Expected object')
                    if name == 'package.json':
                        engines = manifest.get('engines', {})
                        if isinstance(engines, dict):
                            item['requirements'] = {key: value[:200] for key, value in engines.items() if key in ('node', 'npm', 'pnpm', 'bun') and isinstance(value, str)}
                    elif name == 'global.json':
                        sdk = manifest.get('sdk', {})
                        if isinstance(sdk, dict) and isinstance(sdk.get('version'), str):
                            item['requirements'] = {'dotnetSdk': sdk['version'][:80]}
                    elif isinstance(manifest.get('require'), dict) and isinstance(manifest['require'].get('php'), str):
                        item['requirements'] = {'php': manifest['require']['php'][:200]}
                elif name in ('pyproject.toml', 'Cargo.toml'):
                    manifest = tomllib.loads(text)
                    section = manifest.get('project' if name == 'pyproject.toml' else 'package', {})
                    key = 'requires-python' if name == 'pyproject.toml' else 'rust-version'
                    if isinstance(section, dict) and isinstance(section.get(key), str):
                        item['requirements'] = {key: section[key][:200]}
                elif name == 'go.mod':
                    match = re.search(r'^go\s+([0-9.]+)\s*$', text, re.M)
                    if match:
                        item['requirements'] = {'go': match[1]}
            except (OSError, ProjectError, ValueError):
                item['state'] = 'unreadable_or_invalid'
            result['manifests'].append(item)
        preferred = sorted(candidates, key=lambda name: (not name.lower().startswith('readme'), name not in MANIFESTS, name.casefold()))
        for name in preferred:
            try:
                content = read_text(root, name)
                result['sample'] = {'path': name, 'sha256': hashlib.sha256(content.encode()).hexdigest(), 'lines': len(content.splitlines())}
                break
            except (OSError, ProjectError):
                continue
        if 'sample' not in result:
            result['state'] = 'source_partial'
        result['capabilities'] = ADAPTERS[result['adapter']]['capabilities']
        return result

    def discover(self):
        found, skipped = [], []
        for location in self.config.get('locations', []):
            base = (self.workspace / location['path']).resolve()
            if not base.is_dir():
                skipped.append({'location': location['id'], 'reason': 'Directory unavailable'})
                continue
            for entry in sorted(base.iterdir(), key=lambda item: item.name.casefold()):
                if not entry.is_dir() or is_link(entry) or not (entry / '.git').exists():
                    continue
                identifier = (location['id'] + '-' + slug(entry.name))[:64]
                found.append({'id': identifier, 'name': entry.name, 'path': str(entry.resolve()), 'category': location.get('category', 'reference'), 'collection': location['id']})
        for entry in self.config.get('extras', []):
            root = (self.workspace / entry['path']).resolve()
            if root.is_dir() and (root / '.git').exists() and not is_link(root):
                found.append({'id': entry['id'], 'name': entry.get('name', root.name), 'path': str(root), 'category': entry.get('category', 'reference'), 'collection': 'explicit-reference'})
            else:
                skipped.append({'location': entry['id'], 'reason': 'Checkout unavailable'})
        paths, ids, unique = set(), set(), []
        for item in found:
            if item['path'].casefold() in paths:
                continue
            if item['id'] in ids:
                raise ProjectError('Clone discovery produced conflicting project IDs.', 409)
            paths.add(item['path'].casefold()); ids.add(item['id']); unique.append(item)
        return {'candidates': unique, 'skipped': skipped}

    def import_clones(self):
        discovery = self.discover()
        connected, conflicts = [], []
        existing_by_path = {root['path'].casefold(): project for project in self.projects.list() for root in project['roots']}
        for item in discovery['candidates']:
            try:
                existing = existing_by_path.get(item['path'].casefold())
                if existing:
                    connected.append({'id': existing['id'], 'state': 'already_connected'})
                    continue
                project = self.projects.connect(item['name'], [{'label': 'source', 'path': item['path']}], item['id'])
                source = self.source(project['id'], 'source')
                self.projects.set_metadata(project['id'], {'kind': 'clone', 'category': item['category'], 'collection': item['collection'],
                    'adapter': source['adapter'], 'upstream': source['upstream'], 'revisionAtImport': source['revision'],
                    'sourceOnlyByDefault': True, 'importedAt': datetime.now(timezone.utc).isoformat()})
                existing_by_path[item['path'].casefold()] = project
                connected.append({'id': project['id'], 'state': source['state'], 'revision': source['revision']})
            except (ProjectError, OSError) as error:
                conflicts.append({'id': item['id'], 'reason': str(error)})
        return {'connected': connected, 'conflicts': conflicts, 'skipped': discovery['skipped']}

    def catalog(self, query='', start=1, limit=50):
        if not isinstance(query, str) or len(query) > 200 or type(start) is not int or start < 1 or type(limit) is not int or not 1 <= limit <= 100:
            raise ProjectError('Use a bounded connection query and page.')
        projects = [project for project in self.projects.list() if query.casefold() in (project['id'] + ' ' + project['name']).casefold()]
        entries = []
        for project in projects[start-1:start-1+limit]:
            specs = self.config.get('runtimes', {}).get(project['id'], [])
            entries.append({**project, 'sourceAvailable': all(Path(root['path']).is_dir() for root in project['roots']),
                'runtimeMode': 'configured-probe' if any(spec.get('baseUrl') for spec in specs) else 'needs-configuration' if specs else 'source-only',
                'connections': [{'id': spec['id'], 'adapter': spec['adapter'], 'configured': bool(spec.get('baseUrl')), 'description': spec.get('description', '')} for spec in specs]})
        return {'projects': entries, 'total': len(projects), 'start': start, 'truncated': start-1+limit < len(projects),
                'adapters': [{'id': name, **value} for name, value in ADAPTERS.items()], 'note': 'Source access is separate from a running service or an authenticated business account.'}

    def _get(self, spec, route, parse=True):
        url = spec['baseUrl'].rstrip('/') + '/' + route.lstrip('/')
        token = self.environment.get(spec.get('credentialEnv', ''))
        request = urllib.request.Request(url, headers={'Accept': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
        with self.opener.open(request, timeout=4) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise ValueError('Probe metadata exceeded its limit')
            return json.loads(body) if parse else response.status

    def probe(self, specification):
        spec = validate_runtime(specification)
        result = {'id': spec['id'], 'adapter': spec['adapter'], 'state': 'not_configured', 'compatible': False, 'reachable': None,
                  'scope': 'read-only runtime metadata probe', 'description': spec.get('description', ''), 'required': []}
        if not spec.get('baseUrl'):
            result['required'] = ['baseUrl'];return result
        result['baseUrl'] = spec['baseUrl']
        if spec.get('credentialEnv') and not self.environment.get(spec['credentialEnv']):
            result['state'] = 'credentials_required';result['required'] = [spec['credentialEnv']];return result
        started = time.monotonic()
        try:
            adapter = spec['adapter']
            if adapter == 'http-health':
                self._get(spec, spec.get('path', '/health'), parse=False);details = {'healthEndpoint': 'responding'}
            elif adapter == 'http-json':
                payload = self._get(spec, spec.get('path', '/health'))
                if not isinstance(payload, dict) or any(payload.get(key) != value or isinstance(value, bool) and type(payload.get(key)) is not bool for key, value in spec['expected'].items()):
                    raise ValueError('Declared JSON contract mismatch')
                details = {'matchedFields': list(spec['expected'])}
            elif adapter == 'ollama':
                version, models = self._get(spec, '/api/version'), self._get(spec, '/api/tags')
                if not isinstance(version, dict) or not isinstance(version.get('version'), str) or not isinstance(models, dict) or not isinstance(models.get('models'), list):
                    raise ValueError('Ollama contract mismatch')
                details = {'version': version['version'], 'modelCount': len(models['models'])}
            elif adapter == 'openai-models':
                payload = self._get(spec, '/v1/models')
                if not isinstance(payload, dict) or not isinstance(payload.get('data'), list) or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in payload['data']):
                    raise ValueError('Model-catalog contract mismatch')
                names = [item['id'] for item in payload['data']]
                if not set(spec.get('expectedModelIds', [])).issubset(names):
                    raise ValueError('Required models are missing')
                details = {'modelCount': len(names), 'requiredModelsAvailable': True}
            elif adapter == 'openapi':
                payload = self._get(spec, spec.get('path', '/openapi/v1.json'))
                if not isinstance(payload, dict) or not isinstance(payload.get('paths'), dict) or not str(payload.get('openapi', payload.get('swagger', ''))).startswith(('3.', '2.')):
                    raise ValueError('OpenAPI contract mismatch')
                details = {'version': payload.get('openapi', payload.get('swagger')), 'pathCount': len(payload['paths']),
                           'contractHash': hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
            elif adapter == 'fhir':
                payload = self._get(spec, '/metadata')
                if not isinstance(payload, dict) or payload.get('resourceType') != 'CapabilityStatement' or not isinstance(payload.get('fhirVersion'), str):
                    raise ValueError('FHIR capability contract mismatch')
                details = {'fhirVersion': payload['fhirVersion']}
            else:
                raise ProjectError('This runtime adapter has no implemented probe.')
            result.update(state='compatible', compatible=True, reachable=True, details=details)
        except urllib.error.HTTPError as error:
            state = {401: 'authentication_rejected' if spec.get('credentialEnv') else 'authentication_required', 403: 'permission_denied'}.get(error.code, 'endpoint_unavailable')
            result.update(state=state, reachable=True, httpStatus=error.code)
            if state == 'authentication_required':
                result['required'] = ['credentialEnv']
            error.close()
        except (ValueError, TypeError, KeyError, http.client.HTTPException):
            result.update(state='contract_mismatch', reachable=True)
        except OSError:
            result.update(state='unreachable', reachable=False)
        result.update(checkedAt=datetime.now(timezone.utc).isoformat(), elapsedMs=round((time.monotonic()-started)*1000))
        return result

    def compatibility(self, project_id, refresh=False):
        project = self.projects.get(project_id)
        with self.lock:
            cached = self.cache.get(project_id)
            if not refresh and cached and cached[0] > time.monotonic():
                return json.loads(json.dumps(cached[1]))
        roots = []
        for root in project['roots']:
            try:
                roots.append(self.source(project_id, root['id']))
            except (OSError, ProjectError):
                roots.append({'root': root['id'], 'state': 'source_unavailable', 'sourceAccess': 'read-only'})
        specs = self.config.get('runtimes', {}).get(project_id, [])
        with ThreadPoolExecutor(max_workers=4) as executor:
            runtimes = list(executor.map(self.probe, specs))
        result = {'project': project_id, 'name': project['name'], 'sourceReady': all(root['state'] == 'source_ready' for root in roots),
                  'roots': roots, 'runtimes': runtimes, 'mode': 'source-and-runtime-probes' if specs else 'source-only',
                  'checkedAt': datetime.now(timezone.utc).isoformat(),
                  'note': 'Source inspection does not install packages, start applications, grant accounts, or execute repository commands.'}
        with self.lock:
            self.cache[project_id] = (time.monotonic()+20, result)
        return json.loads(json.dumps(result))

    def tool(self, request):
        if request.get('action') == 'connections':
            return self.catalog(request.get('query', ''), request.get('start', 1), request.get('limit', 50))
        if request.get('action') == 'compatibility':
            return self.compatibility(request.get('project'))
        raise ProjectError('Unknown connection operation.')
