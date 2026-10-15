import io
import json
import threading
import time
import unittest
import uuid
from email.message import Message
from unittest.mock import patch

from test_command_center import StoreFixture
from project_hub.projects import ProjectError
from project_hub.server import Hub


class PausedStream(io.BytesIO):
    def __init__(self, text, release):
        first = json.dumps({'choices': [{'delta': {'content': text}}]})
        last = json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})
        super().__init__(f'data: {first}\n\ndata: {last}\n\ndata: [DONE]\n\n'.encode())
        self.headers = Message()
        self.headers['Content-Type'] = 'text/event-stream'
        self.calls = 0
        self.release = release

    def readline(self, limit=-1):
        self.calls += 1
        if self.calls == 3:
            self.release.wait(5)
        return super().readline(limit)


class ChatJobTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.hub = Hub(self.projects, 'synthetic', 'synthetic', reviews=False)
        self.jobs = self.hub.chat_jobs
        self.release = threading.Event()
        self.hub.conversations.ensure('fixture', 'voice-job')
        self.body = {'request_id': uuid.uuid4().hex, 'project': 'fixture', 'thread': 'voice-job', 'message': 'Synthetic question', 'voice_mode': True}
        self.addCleanup(self.hub.operations.pool.shutdown)
        self.addCleanup(self.jobs.pool.shutdown)
        self.addCleanup(self.release.set)

    def get(self, offset=0):
        return self.jobs.get(self.body['request_id'], 'fixture', 'voice-job', offset)

    def wait(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.get()
            if predicate(result): return result
            time.sleep(.01)
        self.fail('Voice job did not reach the expected state.')

    def test_partial_text_is_replayable_and_completion_follows_capacity_release(self):
        text = 'First complete sentence. ' + 'Ž🧠' * 2300
        upstream = PausedStream(text, self.release)
        with patch('project_hub.chat.urllib.request.urlopen', return_value=upstream) as open_request:
            self.jobs.start(self.body)
            partial = self.wait(lambda value: bool(value['text']))
            self.assertEqual(partial['status'], 'running')
            self.assertTrue(partial['has_more'])
            self.assertEqual(self.get(), partial)
            self.assertEqual(self.jobs.start(self.body)['id'], self.body['request_id'])
            self.assertEqual(open_request.call_count, 1)
            with self.assertRaises(ProjectError): self.jobs.start({**self.body, 'message': 'Different'})
            with self.assertRaises(ProjectError): self.jobs.start({**self.body, 'request_id': uuid.uuid4().hex})
            self.release.set()
            terminal = self.wait(lambda value: value['status'] == 'completed')
            remainder = self.get(terminal['next_offset'])
            self.assertEqual(terminal['text'] + remainder['text'], text)
        self.assertEqual(self.hub.active_chats, 0)
        self.assertTrue(upstream.closed)

    def test_cancellation_before_start_prevents_upstream_work(self):
        self.jobs.cancel(self.body['request_id'], 'fixture', 'voice-job')
        with patch('project_hub.chat.urllib.request.urlopen') as upstream:
            self.assertEqual(self.jobs.start(self.body)['status'], 'cancelled')
            upstream.assert_not_called()
        self.assertEqual(self.hub.active_chats, 0)

    def test_cancelled_worker_releases_slot_and_never_publishes_done(self):
        upstream = PausedStream('Partial text.', self.release)
        with patch('project_hub.chat.urllib.request.urlopen', return_value=upstream):
            self.jobs.start(self.body)
            self.wait(lambda value: bool(value['text']))
            self.jobs.cancel_thread('fixture', 'voice-job')
            self.release.set()
            result = self.wait(lambda value: value['status'] == 'cancelled')
            self.assertEqual(result['text'], 'Partial text.')
        self.assertEqual(self.hub.active_chats, 0)

    def test_submission_failure_releases_the_reserved_native_turn(self):
        with patch.object(self.jobs.pool, 'submit', side_effect=RuntimeError('Synthetic submission failure')):
            with self.assertRaises(RuntimeError): self.jobs.start(self.body)
        self.assertEqual(self.hub.active_chats, 0)
        self.assertEqual(self.hub.chat_service.sessions, set())

    def test_ownership_cursor_and_retention_are_checked(self):
        self.jobs.cancel(self.body['request_id'], 'fixture', 'voice-job')
        self.hub.conversations.ensure('fixture', 'different')
        with self.assertRaises(ProjectError): self.jobs.get(self.body['request_id'], 'fixture', 'different')
        with self.assertRaises(ProjectError): self.get(1)
        with self.assertRaises(ProjectError): self.jobs.get('../bad', 'fixture', 'voice-job')
        self.jobs.jobs[self.body['request_id']]['updated'] -= 901
        with self.assertRaises(ProjectError): self.get()
