import base64
import gzip
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from project_hub.remote_call import RelayServer, handler, mint_call_token, valid_call_token


class NotebookRelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'test.json'
        self.config = {'url': 'https://fixture.trycloudflare.com', 'username': 'fixture',
                       'password': 'synthetic-test-only', 'expires': time.time() + 600}
        self.path.write_text(json.dumps(self.config))
        self.client = Mock()
        self.client.request.return_value = (200, b'{"answer":"Synthetic answer"}', 'application/json')
        self.server = RelayServer(('127.0.0.1', 0), handler(self.path, self.client))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def request(self, method='GET', path='/', body=None, authenticated=True, headers=None):
        values = {'Host': 'fixture.trycloudflare.com'}
        if authenticated:
            values['Authorization'] = 'Basic ' + base64.b64encode(b'fixture:synthetic-test-only').decode()
        if body is not None:
            values.update({'Content-Type': 'application/json', 'Origin': self.config['url']})
            body = json.dumps(body).encode()
        values.update(headers or {})
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers=values)
        response = connection.getresponse()
        result = response.status, dict(response.headers), response.read()
        connection.close()
        return result

    def test_authentication_is_required_before_every_public_route(self):
        for path in ('/', '/health', '/api/session', '/assets/index-abc.js'):
            code, headers, _ = self.request(path=path, authenticated=False)
            self.assertEqual(code, 401)
            self.assertIn('WWW-Authenticate', headers)
        self.assertEqual(self.request(headers={'Authorization': 'Basic incorrect'})[0], 401)
        self.client.request.assert_not_called()

    def test_host_origin_and_cross_site_fail_closed(self):
        self.assertEqual(self.request(headers={'Host': 'elsewhere.invalid'})[0], 403)
        self.assertEqual(self.request('POST', '/api/chat', {}, headers={'Origin': 'https://elsewhere.invalid'})[0], 403)
        self.assertEqual(self.request('POST', '/api/chat', {}, headers={'Origin': ''})[0], 403)
        self.assertEqual(self.request(headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.client.request.assert_not_called()

    def test_call_routes_work_but_management_and_traversal_are_refused(self):
        for path in ('/api/shutdown', '/api/catalog/install', '/api/projects', '/api/preferences', '/api/coding/open'):
            self.assertEqual(self.request('POST', path, {})[0], 403)
        for path in ('/assets/../api/system', '/assets/%2e%2e/api/system', '/assets/subdir/../../config', '/assets/abc%2fdef.js'):
            self.assertEqual(self.request(path=path)[0], 403)
        self.client.request.assert_not_called()
        code, headers, _ = self.request(path='/assets/vad.worklet.bundle.min-abc.js')
        self.assertEqual(code, 200)
        self.assertEqual(headers['Cache-Control'], 'private, max-age=31536000, immutable')

    def test_speech_assets_are_compressed_before_the_tunnel_and_cached_by_content(self):
        data = b'\x00asm' + b'synthetic-speech-engine' * 10000
        self.client.request.return_value = (200, data, 'application/wasm')
        with patch('gzip.compress', wraps=gzip.compress) as compress:
            for _ in range(2):
                code, headers, body = self.request(path='/assets/engine-abc.wasm', headers={'Accept-Encoding': 'gzip, br'})
                self.assertEqual(code, 200)
                self.assertEqual(headers['Content-Encoding'], 'gzip')
                self.assertEqual(headers['Vary'], 'Accept-Encoding')
                self.assertEqual(int(headers['Content-Length']), len(body))
                self.assertLess(len(body), len(data) // 4)
                self.assertEqual(gzip.decompress(body), data)
            self.assertEqual(compress.call_count, 1)
            changed = data + b'new-build'
            self.client.request.return_value = (200, changed, 'application/wasm')
            self.assertEqual(gzip.decompress(self.request(path='/assets/engine-abc.wasm', headers={'Accept-Encoding': 'gzip'})[2]), changed)

    def test_asset_compression_respects_client_opt_out_and_never_compresses_private_responses(self):
        data = b'synthetic private response' * 1000
        self.client.request.return_value = (200, data, 'application/octet-stream')
        for encoding in ('', 'br', 'gzip;q=0, *;q=1', 'gzip;q=invalid'):
            _, headers, body = self.request(path='/assets/model-abc.onnx', headers={'Accept-Encoding': encoding})
            self.assertNotIn('Content-Encoding', headers)
            self.assertEqual(body, data)
        for path in ('/api/conversations/history', '/api/voice/status', '/'):
            _, headers, body = self.request(path=path, headers={'Accept-Encoding': 'gzip'})
            self.assertNotIn('Content-Encoding', headers)
            self.assertEqual(body, data)

    def test_denied_post_delivers_http_status_when_its_body_arrives_after_headers(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.putrequest('POST', '/api/shutdown', skip_host=True)
            connection.putheader('Host', 'fixture.trycloudflare.com')
            connection.putheader('Authorization', 'Basic ' + base64.b64encode(b'fixture:synthetic-test-only').decode())
            connection.putheader('Origin', self.config['url'])
            connection.putheader('Content-Length', '2')
            connection.endheaders()
            time.sleep(.02)
            connection.send(b'{}')
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            self.assertEqual(response.getheader('Connection'), 'close')
            response.read()
            self.client.request.assert_not_called()
        finally:
            connection.close()

    def test_chat_is_buffered_and_private_cookie_is_not_returned(self):
        code, headers, _ = self.request('POST', '/api/chat', {'project': 'fixture', 'message': 'Test', 'stream': True})
        self.assertEqual(code, 200)
        self.assertFalse(json.loads(self.client.request.call_args.args[2])['stream'])
        self.assertNotIn('Set-Cookie', headers)
        self.client.request.reset_mock()
        _, _, body = self.request(path='/api/session')
        self.assertEqual(json.loads(body), {'remote': True, 'operator': False, 'version': '0.4.0'})
        self.client.request.assert_not_called()

    def test_index_selects_remote_transport_and_expiry_revokes_access(self):
        self.client.request.return_value = (200, b'<html><head></head><body>Test</body></html>', 'text/html')
        self.assertIn(b'jarvis-remote-call', self.request()[2])
        self.assertEqual(self.request()[1]['Cache-Control'], 'no-store')
        self.config['expires'] = 0
        self.path.write_text(json.dumps(self.config))
        self.client.request.reset_mock()
        self.assertEqual(self.request()[0], 410)
        self.client.request.assert_not_called()

    def test_task_mode_is_explicit_scoped_and_preserves_artifact_download_headers(self):
        self.assertEqual(self.request(path='/api/operator/conversations')[0], 403)
        self.assertEqual(self.request(path='/api/operator/finance')[0], 403)
        self.config['operator_enabled'] = True
        self.path.write_text(json.dumps(self.config))
        self.assertEqual(self.request(path='/api/operator/conversations')[0], 200)
        self.assertEqual(self.request(path='/api/operator/runtime')[0], 200)
        self.assertEqual(self.request(path='/api/operator/finance')[0], 200)
        self.assertEqual(self.request(path='/api/operator/finance', authenticated=False)[0], 401)
        self.assertEqual(self.request('POST', '/api/operator/finance', {})[0], 403)
        self.assertEqual(self.request(path='/api/operator/finance/orders')[0], 403)
        self.assertEqual(self.request(path='/api/operator/social/contacts')[0], 200)
        self.assertEqual(self.request('POST', '/api/operator/social/connections/instagram/start', {})[0], 200)
        self.assertEqual(self.request('POST', '/api/operator/social/connections/other/start', {})[0], 403)
        self.assertEqual(self.request('POST', '/api/operator/chat', {'message': 'Synthetic task'})[0], 200)
        self.assertEqual(self.request('POST', '/api/operator/conversations/00000000-0000-4000-8000-000000000000/runs/11111111-1111-4111-8111-111111111111/cancel', {})[0], 200)
        self.assertEqual(self.request('POST', '/api/operator/admin/shutdown', {})[0], 403)
        self.assertEqual(self.request('POST', '/api/operator/admin/runtime', {'operation': 'standby'})[0], 403)
        self.assertEqual(self.request('POST', '/api/operator/auth/login', {})[0], 403)
        self.assertEqual(self.request(path='/api/operator/../admin/shutdown')[0], 403)
        self.client.request.return_value = (200, b'PK synthetic workbook', 'application/octet-stream', 'attachment; filename="synthetic.xlsx"')
        code, headers, _ = self.request(path='/api/operator/artifacts/12345678-1234-4234-8234-123456789012/download')
        self.assertEqual(code, 200)
        self.assertIn('synthetic.xlsx', headers['Content-Disposition'])
        self.client.request.return_value = (200, b'<head></head>', 'text/html')
        self.assertIn(b'jarvis-operator-enabled', self.request()[2])

    def test_one_click_call_tokens_are_signed_short_lived_and_cookie_bound(self):
        secret = 'synthetic-call-secret'
        good = mint_call_token(secret)
        self.assertTrue(valid_call_token(secret, good))
        self.assertFalse(valid_call_token(secret, good[:-2] + ('00' if good[-2:] != '00' else '11')))
        self.assertFalse(valid_call_token(secret, 'not-a-token'))
        self.assertFalse(valid_call_token('', good))
        expired = mint_call_token(secret, now=time.time() - 700)
        self.assertFalse(valid_call_token(secret, expired))

    def test_call_token_bypasses_password_once_then_cookie(self):
        import tempfile as _tempfile
        folder = _tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / 'call.json'
        config = {'url': 'https://fixture.trycloudflare.com', 'username': 'fixture',
                  'password': 'synthetic-test-only', 'expires': time.time() + 600,
                  'operator_enabled': False, 'call_secret': 'synthetic-call-secret'}
        path.write_text(json.dumps(config))
        server = RelayServer(('127.0.0.1', 0), handler(path, self.client))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            def get(route, headers=None):
                values = {'Host': 'fixture.trycloudflare.com'}
                values.update(headers or {})
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                connection.request('GET', route, headers=values)
                response = connection.getresponse()
                result = response.status, dict(response.headers), response.read()
                connection.close()
                return result
            token = mint_call_token('synthetic-call-secret')
            code, headers, _ = get('/?call=' + token)
            self.assertEqual(code, 200)
            cookie = headers.get('Set-Cookie', '')
            self.assertIn('jarvis_call=' + token, cookie)
            code, _, _ = get('/api/session', {'Cookie': 'jarvis_call=' + token})
            self.assertEqual(code, 200)
            self.assertEqual(get('/?call=forged.token')[0], 401)
            self.assertEqual(get('/')[0], 401)
            self.client.request.assert_called()
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
        self.assertEqual(self.request(path='/api/connections')[0], 403)
        self.assertEqual(self.request('POST', '/api/tool', {'action': 'list'})[0], 403)
        self.config['operator_enabled'] = True
        self.path.write_text(json.dumps(self.config))
        self.assertEqual(self.request(path='/api/connections?q=ollama')[0], 200)
        self.assertEqual(self.request(path='/api/connections/upstream-ollama')[0], 200)
        self.assertEqual(self.request('POST', '/api/tool', {'action': 'read', 'project': 'fixture', 'path': 'README.md'})[0], 200)
        self.client.request.reset_mock()
        for body in ({'action': 'connect', 'path': 'C:/secret'}, {'action': 'read', 'command': 'unexpected'}):
            self.assertEqual(self.request('POST', '/api/tool', body)[0], 403)
        self.assertEqual(self.request('POST', '/api/connections', {})[0], 403)
        self.assertEqual(self.request('POST', '/api/coding/open', {})[0], 403)
        self.client.request.assert_not_called()


@unittest.skipUnless(os.name == 'nt', 'Windows process identity test')
class NotebookProcessTests(unittest.TestCase):
    def test_mismatched_identity_is_preserved_and_owned_child_can_stop(self):
        from scripts.owned_process import creation_time, retire
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'])
        try:
            created = creation_time(int(process._handle))
            retire(process.pid, created + 1)
            self.assertIsNone(process.poll())
            retire(process.pid, created)
            process.wait(timeout=5)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
