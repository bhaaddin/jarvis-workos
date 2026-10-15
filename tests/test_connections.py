import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

from project_hub.connections import Connections, clean_remote, validate_catalog, validate_runtime
from project_hub.projects import Projects, ProjectError


class SourceConnectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.library = self.root / 'clones'
        self.library.mkdir()
        self.clone = self.library / 'sample-go'
        self.clone.mkdir()
        (self.clone / 'README.md').write_text('Synthetic source connection\n', encoding='utf-8')
        (self.clone / 'go.mod').write_text('module example.test/fixture\n\ngo 1.24.0\n', encoding='utf-8')
        (self.clone / 'kernel.cu').write_text('// SYNTHETIC_CUDA_SOURCE\n', encoding='utf-8')
        subprocess.run(['git', 'init', '--quiet', str(self.clone)], check=True)
        self.projects = Projects(self.root / 'hub.sqlite')
        self.registry = Connections(self.projects, {'version': 1, 'locations': [{'id': 'reference', 'path': 'clones', 'category': 'reference'}]}, self.root)

    def test_clone_import_is_idempotent_and_go_cuda_are_readable(self):
        result = self.registry.import_clones()
        self.assertFalse(result['conflicts'])
        self.assertEqual(len(self.projects.list()), 1)
        self.assertEqual(self.registry.import_clones()['connected'][0]['state'], 'already_connected')
        status = self.registry.compatibility('reference-sample-go')
        self.assertTrue(status['sourceReady'])
        self.assertEqual(status['mode'], 'source-only')
        self.assertEqual(status['roots'][0]['adapter'], 'git-source')
        self.assertIn({'go': '1.24.0'}, [item['requirements'] for item in status['roots'][0]['manifests']])
        source = self.projects.tool({'action': 'read', 'project': 'reference-sample-go', 'root': 'source', 'path': 'kernel.cu'})
        self.assertIn('SYNTHETIC_CUDA_SOURCE', source['content'])
        overview = self.projects.overview('reference-sample-go')
        self.assertIn('Go', overview['roots'][0]['stack'])
        self.assertIn('C / C++ / CUDA', overview['roots'][0]['stack'])
        (self.clone / '.env').write_text('PRIVATE_SYNTHETIC_VALUE', encoding='utf-8')
        with self.assertRaises(ProjectError):
            self.projects.tool({'action': 'read', 'project': 'reference-sample-go', 'path': '.env'})

    def test_existing_connection_identity_and_metadata_are_preserved(self):
        self.projects.connect('My existing connection', [{'label': 'app', 'path': str(self.clone)}], 'existing')
        self.projects.set_metadata('existing', {'kind': 'user-owned'})
        result = self.registry.import_clones()
        self.assertEqual(result['connected'], [{'id': 'existing', 'state': 'already_connected'}])
        self.assertEqual(self.projects.get('existing')['metadata'], {'kind': 'user-owned'})
        self.assertEqual(self.projects.get('existing')['roots'][0]['id'], 'app')

    def test_connection_conflict_does_not_replace_existing_roots(self):
        other = self.root / 'other'
        other.mkdir()
        self.projects.connect('Existing name', [{'label': 'source', 'path': str(other)}], 'reference-sample-go')
        result = self.registry.import_clones()
        self.assertEqual(len(result['conflicts']), 1)
        self.assertEqual(self.projects.get('reference-sample-go')['roots'][0]['path'], str(other))

    def test_catalog_search_paging_and_disconnection_metadata(self):
        self.registry.import_clones()
        self.assertEqual(self.registry.catalog('sample')['total'], 1)
        self.assertEqual(self.projects.tool({'action': 'list', 'query': 'sample', 'limit': 1})['total'], 1)
        self.assertEqual(self.registry.catalog('absent')['projects'], [])
        self.projects.disconnect('reference-sample-go')
        with self.projects.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM project_metadata').fetchone()[0], 0)

    def test_remote_metadata_strips_credentials_and_local_transports(self):
        self.assertEqual(clean_remote('https://user:SYNTHETIC_SECRET@github.com/org/repo.git?token=secret'), 'https://github.com/org/repo')
        self.assertEqual(clean_remote('git@github.com:org/repo.git'), 'https://github.com/org/repo')
        self.assertIsNone(clean_remote('C:/private/local/repo'))

    def test_gitdir_file_checkout_uses_the_same_bounded_source_adapter(self):
        source = self.root / 'separate-source'
        source.mkdir()
        (source / 'README.md').write_text('Synthetic external Git directory.', encoding='utf-8')
        subprocess.run(['git', 'init', '--quiet', '--separate-git-dir', str(self.root / 'external-git'), str(source)], check=True)
        self.projects.connect('Separate', [{'label': 'source', 'path': str(source)}])
        result = self.registry.compatibility('separate')
        self.assertTrue(result['sourceReady'])
        self.assertEqual(result['roots'][0]['checkoutForm'], 'external-gitdir')


class RuntimeAdapterTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        requests = self.requests
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                requests.append((self.path, self.headers.get('Authorization')))
                code, value = 200, {}
                if self.path == '/api/version': value = {'version': 'synthetic-version'}
                elif self.path == '/api/tags': value = {'models': [{'name': 'synthetic'}]}
                elif self.path == '/v1/models': value = {'data': [{'id': 'speech-model'}]}
                elif self.path == '/openapi/v1.json': value = {'openapi': '3.1.0', 'paths': {'/api/example': {'get': {}}}}
                elif self.path == '/fhir/R4/metadata': value = {'resourceType': 'CapabilityStatement', 'fhirVersion': '4.0.1'}
                elif self.path == '/ready': value = {'ready': True}
                elif self.path == '/wrong-ready': value = {'ready': 1}
                elif self.path == '/private': code = 401
                elif self.path == '/forbidden': code = 403
                elif self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/private')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                else: value = {'unexpected': 'contract'}
                body = json.dumps(value).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close)
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.registry = Connections(None, environment={'JARVIS_TEST_TOKEN': 'SYNTHETIC_PRIVATE_TOKEN'})

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def test_declared_protocols_validate_real_response_shapes(self):
        for adapter in ('ollama', 'openapi', 'openai-models', 'http-health'):
            with self.subTest(adapter=adapter):
                result = self.registry.probe({'id': 'test', 'adapter': adapter, 'baseUrl': self.url})
                self.assertTrue(result['compatible'])
        result = self.registry.probe({'id': 'fhir', 'adapter': 'fhir', 'baseUrl': self.url + '/fhir/R4'})
        self.assertEqual(result['details']['fhirVersion'], '4.0.1')
        result = self.registry.probe({'id': 'json', 'adapter': 'http-json', 'baseUrl': self.url, 'path': '/ready', 'expected': {'ready': True}})
        self.assertTrue(result['compatible'])
        wrong = self.registry.probe({'id': 'json', 'adapter': 'http-json', 'baseUrl': self.url, 'path': '/wrong-ready', 'expected': {'ready': True}})
        self.assertEqual(wrong['state'], 'contract_mismatch')

    def test_missing_configuration_credentials_and_denials_are_distinct(self):
        absent = self.registry.probe({'id': 'test', 'adapter': 'openapi', 'baseUrl': None})
        self.assertEqual(absent['state'], 'not_configured')
        missing = self.registry.probe({'id': 'test', 'adapter': 'openai-models', 'baseUrl': self.url, 'credentialEnv': 'JARVIS_MISSING'})
        self.assertEqual(missing['state'], 'credentials_required')
        self.assertEqual(self.requests, [])
        for route, state in (('/private', 'authentication_required'), ('/forbidden', 'permission_denied')):
            result = self.registry.probe({'id': 'test', 'adapter': 'http-health', 'baseUrl': self.url, 'path': route})
            self.assertEqual(result['state'], state)
            self.assertFalse(result['compatible'])
            self.assertTrue(result['reachable'])
        rejected = self.registry.probe({'id': 'test', 'adapter': 'http-health', 'baseUrl': self.url, 'path': '/private', 'credentialEnv': 'JARVIS_TEST_TOKEN'})
        self.assertEqual(rejected['state'], 'authentication_rejected')

    def test_tokens_stay_in_headers_and_redirects_are_not_followed(self):
        result = self.registry.probe({'id': 'speech', 'adapter': 'openai-models', 'baseUrl': self.url,
            'credentialEnv': 'JARVIS_TEST_TOKEN', 'expectedModelIds': ['speech-model']})
        self.assertTrue(result['compatible'])
        self.assertEqual(self.requests[-1][1], 'Bearer SYNTHETIC_PRIVATE_TOKEN')
        self.assertNotIn('SYNTHETIC_PRIVATE', json.dumps(result))
        count = len(self.requests)
        result = self.registry.probe({'id': 'test', 'adapter': 'http-health', 'baseUrl': self.url, 'path': '/redirect', 'credentialEnv': 'JARVIS_TEST_TOKEN'})
        self.assertEqual(result['httpStatus'], 302)
        self.assertEqual(len(self.requests), count + 1)

    def test_registry_rejects_unknown_adapters_and_unsafe_url_forms(self):
        for spec in ({'id': 'x', 'adapter': 'invented'}, {'id': 'x', 'adapter': 'http-health', 'baseUrl': 'http://remote.example'},
                     {'id': 'x', 'adapter': 'http-health', 'baseUrl': 'https://user:secret@example.test'},
                     {'id': 'x', 'adapter': 'http-health', 'baseUrl': self.url, 'path': '//elsewhere.test'},
                     {'id': 'x', 'adapter': 'http-health', 'baseUrl': self.url, 'path': '/health?token=secret'}):
            with self.subTest(spec=spec), self.assertRaises(ProjectError):
                validate_runtime(spec)
        with self.assertRaises(ProjectError):
            validate_catalog({'version': 42})


if __name__ == '__main__':
    unittest.main()
