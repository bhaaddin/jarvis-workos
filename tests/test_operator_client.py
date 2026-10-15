import io
import json
import unittest
import urllib.error
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

from project_hub.operator_client import OperatorClient
from project_hub.projects import ProjectError


class OperatorClientTests(unittest.TestCase):
    def test_connector_unauthorized_does_not_replay_a_submitted_login(self):
        client = OperatorClient('synthetic-password')
        client.csrf = 'synthetic-csrf'
        client.login = Mock()
        error = urllib.error.HTTPError('http://local.test', 401, 'Unauthorized', {},
            io.BytesIO(json.dumps({'error': {'code': 'CLINIC_SIGNIN_REQUIRED', 'message': 'Clinic sign-in rejected.'}}).encode()))
        client.opener = Mock()
        client.opener.open.side_effect = error
        with self.assertRaises(ProjectError):
            client.request('POST', '/connections/clinic', {'email': 'synthetic@example.test', 'password': 'synthetic'})
        self.assertEqual(client.opener.open.call_count, 1)
        client.login.assert_not_called()

    def test_proxy_never_opens_unlisted_management_routes(self):
        client = OperatorClient('synthetic-password')
        client.opener = Mock()
        for route in ('/admin/shutdown', '/auth/login', '/artifacts/../auth/login', '//other.test/api', '/social/connections/unknown/start'):
            with self.assertRaises(ProjectError):
                client.request('POST', route, {})
        client.opener.open.assert_not_called()

    def test_a_waiting_chat_request_does_not_block_cancellation(self):
        client = OperatorClient('synthetic-password')
        client.csrf = 'synthetic-csrf'
        waiting, release = threading.Event(), threading.Event()

        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'application/json'}

        def opened(request, timeout):
            if request.full_url.endswith('/chat'):
                waiting.set()
                if not release.wait(3):
                    raise TimeoutError('Synthetic wait')
            return Response(b'{"ok":true}')

        client.opener = Mock()
        client.opener.open.side_effect = opened
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = executor.submit(client.request, 'POST', '/chat', {'waitMs': 20000})
            try:
                self.assertTrue(waiting.wait(1))
                cancel = executor.submit(client.request, 'POST', '/conversations/00000000-0000-4000-8000-000000000000/cancel', {})
                self.assertEqual(cancel.result(timeout=1)[0], 200)
                scoped = executor.submit(client.request, 'POST', '/conversations/00000000-0000-4000-8000-000000000000/runs/11111111-1111-4111-8111-111111111111/cancel', {})
                self.assertEqual(scoped.result(timeout=1)[0], 200)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=1)[0], 200)

    def test_finance_bridge_allows_only_the_fixed_snapshot(self):
        client = OperatorClient('synthetic-password')
        client.csrf = 'synthetic-csrf'
        client.opener = Mock()
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'application/json'}
        client.opener.open.return_value = Response(b'{"readOnly":true}')
        self.assertEqual(client.request('GET', '/finance')[0], 200)
        client.opener.reset_mock()
        for method, route in (('POST', '/finance'), ('GET', '/finance/orders'), ('GET', '/finance?url=http://elsewhere.invalid'),
                              ('GET', '/finance?path=state/paper/credentials.env'), ('GET', '/finance/../admin/shutdown')):
            with self.assertRaises(ProjectError):
                client.request(method, route)
        client.opener.open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
