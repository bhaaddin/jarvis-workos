import http.cookiejar
import http.client
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from project_hub.projects import ProjectError, Projects, read_text, relative_name
from project_hub.jobs import Reviews
from project_hub.server import Hub, handler_for


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'source folder'
        self.root.mkdir()
        (self.root / 'README.md').write_text('A synthetic project.\n', encoding='utf-8')
        (self.root / 'main.py').write_text('def synthetic_feature():\n    return 42\n', encoding='utf-8')
        self.projects = Projects(self.base / 'connections.sqlite')
        self.projects.connect('Fixture', [{'label': 'app', 'path': str(self.root)}])

    def test_connection_is_idempotent_and_invalid_multi_root_is_atomic(self):
        project = self.projects.connect('Fixture', [{'label': 'app', 'path': str(self.root)}])
        self.assertEqual(project['id'], 'fixture')
        self.assertEqual(len(self.projects.list()), 1)
        with self.assertRaises((ProjectError, FileNotFoundError)):
            self.projects.connect('Another', [{'path': str(self.root)}, {'path': str(self.base / 'missing')}])
        self.assertEqual(len(self.projects.list()), 1)
        with self.assertRaises(ProjectError):
            self.projects.connect('Overlap', [{'path': str(self.root)}, {'path': str(self.base)}])

    def test_second_root_is_explicit_and_cannot_fall_back(self):
        sibling = self.base / 'frontend'
        sibling.mkdir()
        (sibling / 'package.json').write_text('{"name":"synthetic-ui"}', encoding='utf-8')
        self.projects.connect('Multi', [{'label': 'api', 'path': str(self.root)}, {'label': 'web', 'path': str(sibling)}])
        with self.assertRaises(ProjectError):
            self.projects.tool({'action': 'read', 'project': 'multi', 'path': 'package.json'})
        result = self.projects.tool({'action': 'read', 'project': 'multi', 'root': 'web', 'path': 'package.json'})
        self.assertIn('synthetic-ui', result['content'])

    def test_windows_path_forms_are_rejected(self):
        for invalid in ('../sibling/a.py', 'a/../../b.py', 'C:relative.py', 'C:/absolute.py',
                        '\\rooted.py', '\\\\server\\share\\file.py', 'file.py:stream',
                        'folder./file.py', 'folder /file.py', 'NUL.txt', 'a//b.py', 'a\x00.py'):
            with self.subTest(path=invalid), self.assertRaises(ProjectError):
                relative_name(invalid)
        self.assertEqual(relative_name('src\\normal.py'), 'src/normal.py')

    def test_denied_source_is_excluded_from_tree_read_and_search(self):
        for name in ('.env', 'appsettings.Production.json', 'credentials.json', 'patients.csv'):
            (self.root / name).write_text('SYNTHETIC_SECRET_MARKER', encoding='utf-8')
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules' / 'hidden.py').write_text('SYNTHETIC_SECRET_MARKER', encoding='utf-8')
        for name in ('.env', 'appsettings.Production.json', 'credentials.json', 'patients.csv', 'node_modules/hidden.py'):
            with self.subTest(path=name), self.assertRaises(ProjectError):
                read_text(self.root, name)
        index = self.projects.index(self.root)
        self.assertNotIn('.env', index['files'])
        result = self.projects.tool({'action': 'search', 'project': 'fixture', 'root': 'app', 'query': 'SYNTHETIC_SECRET_MARKER'})
        self.assertEqual(result['hits'], [])

    def test_blocked_ancestor_cannot_be_read_directly(self):
        for folder in ('credentials', '.env.local'):
            path = self.root / folder
            path.mkdir()
            (path / 'example.py').write_text('SYNTHETIC_SECRET_MARKER', encoding='utf-8')
            with self.subTest(folder=folder), self.assertRaises(ProjectError):
                read_text(self.root, f'{folder}/example.py')

    def test_ignored_directory_does_not_consume_source_budget(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('heavy-cache/\n', encoding='utf-8')
        (self.root / 'src').mkdir()
        (self.root / 'src/real.py').write_text('real source', encoding='utf-8')
        (self.root / 'heavy-cache').mkdir()
        for index in range(12):
            (self.root / f'heavy-cache/ignored{index}.py').write_text('ignored source', encoding='utf-8')
        with patch('project_hub.projects.MAX_INDEX', 4):
            self.assertIn('src/real.py', self.projects.index(self.root)['files'])
        changes = self.projects.git_status(self.root)['changes']
        self.assertIn('src/', [change['path'] for change in changes])

    def test_instruction_budget_reports_omissions(self):
        for name in ('AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'koordinator.local.md'):
            (self.root / name).write_text('x' * 10000, encoding='utf-8')
        (self.root / 'src').mkdir()
        (self.root / 'src/AGENTS.md').write_text('A nested instruction', encoding='utf-8')
        result = self.projects.tool({'action': 'instructions', 'project': 'fixture', 'root': 'app', 'path': 'src/example.py'})
        self.assertTrue(result['truncated'])
        self.assertTrue(result['instructions'][-1]['budget_exhausted'])

    def test_review_update_failure_releases_capacity(self):
        reviews = Reviews(self.projects)
        self.addCleanup(reviews.pool.shutdown)
        with self.projects.connection() as db:
            db.execute('INSERT INTO reviews VALUES (?,?,?,?)', ('test-job', 'fixture', 'queued', '{}'))
        reviews.slots.acquire()
        original = reviews.update
        def update(job, state, result):
            if state == 'running':
                raise RuntimeError('Synthetic database failure')
            return original(job, state, result)
        with patch.object(reviews, 'update', side_effect=update):
            reviews.execute('test-job', self.base / 'unused.json', [], 'review')
        self.assertEqual(reviews.get('test-job')['status'], 'failed')
        acquired = [reviews.slots.acquire(blocking=False) for _ in range(4)]
        self.assertEqual(acquired, [True] * 4)
        for _ in acquired:
            reviews.slots.release()

    def test_malformed_worker_report_is_terminal(self):
        reviews = Reviews(self.projects)
        self.addCleanup(reviews.pool.shutdown)
        for index, payload in enumerate(('[]', '{"results":[null]}', '{"results":{}}', '{"results":[{"answer":42}]}')):
            job_id = f'malformed-{index}'
            with self.projects.connection() as db:
                db.execute('INSERT INTO reviews VALUES (?,?,?,?)', (job_id, 'fixture', 'queued', '{}'))
            reviews.slots.acquire()
            with patch('project_hub.jobs.subprocess.Popen') as factory:
                process = factory.return_value.__enter__.return_value
                process.communicate.return_value = (payload, '')
                process.returncode = 0
                reviews.execute(job_id, self.base / 'unused.json', [], 'review')
            self.assertEqual(reviews.get(job_id)['status'], 'failed')
        self.assertEqual(reviews.active_count(), 0)

    def test_git_ignores_and_local_instructions(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('ignored.py\nCLAUDE.local.md\ntracked.py\n', encoding='utf-8')
        (self.root / 'ignored.py').write_text('private synthetic value', encoding='utf-8')
        (self.root / 'tracked.py').write_text('tracked source', encoding='utf-8')
        (self.root / 'CLAUDE.local.md').write_text('Synthetic project instruction.', encoding='utf-8')
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', 'tracked.py'], check=True)
        index = self.projects.index(self.root)
        self.assertNotIn('ignored.py', index['files'])
        self.assertIn('tracked.py', index['files'])
        with self.assertRaises(ProjectError):
            read_text(self.root, 'ignored.py')
        self.assertIn('Synthetic project instruction', self.projects.instructions(self.root)[0]['content'])
        with patch.dict(os.environ, {'GIT_DIR': str(self.base / 'wrong')}):
            self.assertTrue(self.projects.git_status(self.root)['repository'])
        (self.root / '.gitignore').write_text('main.py\n', encoding='utf-8')
        with self.assertRaises(ProjectError):
            read_text(self.root, 'main.py')

    def test_open_handle_path_mismatch_is_refused(self):
        with patch('project_hub.projects.opened_path', return_value=self.base / 'outside.py'):
            with self.assertRaises(ProjectError):
                read_text(self.root, 'main.py')

    def test_junction_escape_is_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'outside.py').write_text('OUTSIDE_MARKER', encoding='utf-8')
        link = self.root / 'linked'
        if os.name == 'nt':
            result = subprocess.run(['cmd', '/d', '/c', 'mklink', '/J', str(link), str(outside)], capture_output=True)
            if result.returncode:
                self.fail(f'The synthetic junction fixture could not be created: {result.stderr!r}')
            self.addCleanup(lambda: link.rmdir() if link.exists() else None)
        else:
            link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ProjectError):
            read_text(self.root, 'linked/outside.py')
        self.assertNotIn('linked/outside.py', self.projects.index(self.root)['files'])

    def test_paged_read_and_literal_search_report_actual_lines(self):
        result = self.projects.tool({'action': 'read', 'project': 'fixture', 'root': 'app', 'path': 'main.py', 'start': 2, 'limit': 1})
        self.assertEqual(result['content'], '2:     return 42')
        result = self.projects.tool({'action': 'search', 'project': 'fixture', 'root': 'app', 'query': 'return 42'})
        self.assertEqual(result['hits'][0]['line'], 2)
        with self.assertRaises(ProjectError):
            self.projects.tool({'action': 'read', 'project': 'fixture', 'root': 'app', 'path': 'main.py', 'start': 'bad'})


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name).resolve()
        root = base / 'project'
        root.mkdir()
        (root / 'README.md').write_text('Synthetic HTTP fixture', encoding='utf-8')
        projects = Projects(base / 'hub.sqlite')
        projects.connect('Fixture', [{'label': 'app', 'path': str(root)}])
        cls.hub = Hub(projects, 'synthetic-project-key', 'synthetic-gateway-key', reviews=False)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(cls.hub))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, payload=None, headers=None, opener=None, method=None):
        call = urllib.request.Request(self.url + path, data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Content-Type': 'application/json', **(headers or {})}, method=method)
        return (opener or urllib.request.build_opener()).open(call, timeout=10)

    def test_bearer_read_succeeds_and_management_is_denied(self):
        headers = {'Authorization': 'Bearer synthetic-project-key'}
        with self.request('/api/tool', {'action': 'list'}, headers) as response:
            self.assertEqual(json.load(response)['projects'][0]['id'], 'fixture')
        for path in ('/api/projects', '/api/coding/open', '/api/chat', '/api/reviews', '/api/voice/transcribe', '/api/voice/speak',
                     '/api/catalog/install', '/api/catalog/sync', '/api/skills/enable', '/api/conversations', '/api/conversations/abort', '/api/preferences'):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as failure:
                self.request(path, {}, headers)
            self.assertEqual(failure.exception.code, 403)

    def test_connection_catalogue_and_compatibility_are_read_only_authenticated_tools(self):
        headers = {'Authorization': 'Bearer synthetic-project-key'}
        with self.request('/api/connections?q=fixture&limit=10', headers=headers) as response:
            data = json.load(response)
            self.assertEqual(data['total'], 1)
            self.assertEqual(data['projects'][0]['runtimeMode'], 'source-only')
        with self.request('/api/tool', {'action': 'compatibility', 'project': 'fixture'}, headers) as response:
            data = json.load(response)
            self.assertTrue(data['sourceReady'])
            self.assertEqual(data['runtimes'], [])
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.request('/api/connections', headers={})
        self.assertEqual(failure.exception.code, 401)

    def test_missing_or_wrong_credentials_fail(self):
        for headers in ({}, {'Authorization': 'Bearer wrong'}):
            with self.subTest(headers=headers), self.assertRaises(urllib.error.HTTPError) as failure:
                self.request('/api/projects', headers=headers)
            self.assertEqual(failure.exception.code, 401)

    def test_non_ascii_credential_is_unauthorized(self):
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.request('/api/projects', headers={'Authorization': 'Bearer caf\u00e9'})
        self.assertEqual(failure.exception.code, 401)

    def test_ambiguous_body_framing_is_rejected(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)
        self.addCleanup(connection.close)
        connection.putrequest('POST', '/api/tool')
        connection.putheader('Authorization', 'Bearer synthetic-project-key')
        connection.putheader('Content-Type', 'application/json')
        connection.putheader('Content-Length', '2')
        connection.putheader('Content-Length', '2')
        connection.endheaders(b'{}')
        self.assertEqual(connection.getresponse().status, 400)

    def test_malformed_gateway_response_is_a_gateway_error(self):
        for payload in (b'[]', b'{"choices":[{"message":null}]}', b'{broken'):
            with self.subTest(payload=payload), patch('project_hub.server.urllib.request.urlopen') as opener:
                opener.return_value.__enter__.return_value.read.return_value = payload
                with self.assertRaises(ProjectError) as failure:
                    self.hub.chat({'project': 'fixture', 'thread': 'fixture-thread', 'message': 'Read the fixture.'})
                self.assertEqual(failure.exception.status, 502)
        self.assertEqual(self.hub.active_chats, 0)

    def test_cross_origin_host_and_bootstrap_rejected(self):
        for headers in ({'Origin': 'https://example.invalid'}, {'Host': 'untrusted.example'}, {'Sec-Fetch-Site': 'cross-site'}):
            with self.subTest(headers=headers), self.assertRaises(urllib.error.HTTPError) as failure:
                self.request('/', headers=headers)
            self.assertEqual(failure.exception.code, 403)

    def test_local_browser_session_and_validation(self):
        jar = http.cookiejar.CookieJar()
        browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        with self.request('/', opener=browser) as response:
            self.assertIn('HttpOnly', response.headers['Set-Cookie'])
            self.assertIn('SameSite=Strict', response.headers['Set-Cookie'])
        with self.request('/api/projects', opener=browser) as response:
            self.assertEqual(json.load(response)['projects'][0]['id'], 'fixture')
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.request('/api/projects', {}, opener=browser)
        self.assertEqual(failure.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.request('/api/projects', [], {'Origin': self.url}, opener=browser)
        self.assertEqual(failure.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
