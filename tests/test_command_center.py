import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from email.message import Message as Headers

from project_hub.catalog import Catalog, parse_skill
from project_hub.chat import stream_events
from project_hub.conversations import Conversations, project_history, session_key
from project_hub.gateway import Gateway
from project_hub.preferences import Preferences
from project_hub.operations import Operations
from project_hub.projects import ProjectError, Projects
from project_hub.server import Hub


def skill(owner='author', slug='example', version='1.0.0', downloads=10):
    return {'ownerHandle': owner, 'slug': slug, 'displayName': 'Example ' + slug,
            'summary': 'A useful coding workflow', 'topics': ['coding'], 'stats': {'downloads': downloads},
            'latestVersion': {'version': version, 'license': 'MIT'}, 'metadata': None}


class StoreFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'source'
        self.root.mkdir()
        (self.root / 'AGENTS.md').write_text('Follow the synthetic project instruction.', encoding='utf-8')
        self.projects = Projects(self.base / 'hub.sqlite')
        self.projects.connect('Fixture', [{'label': 'app', 'path': str(self.root)}])


class CatalogTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.catalog = Catalog(self.projects, Mock())

    def test_identity_deduplicates_versions_but_not_publishers(self):
        self.catalog.ingest({'items': [skill(), skill('another')], 'nextCursor': 'cursor+one/='}, None)
        self.catalog.ingest({'items': [skill(version='2.0.0')], 'nextCursor': None}, 'cursor+one/=')
        self.assertEqual(self.catalog.stats()['available'], 2)
        self.assertEqual(self.catalog.get('clawhub:author/example')['version'], '2.0.0')
        self.assertTrue(self.catalog.stats()['feed_complete'])

    def test_malformed_page_does_not_advance_checkpoint(self):
        self.catalog.ingest({'items': [skill()], 'nextCursor': 'checkpoint'}, None)
        for page in ({'items': [], 'nextCursor': []}, {'items': 'wrong', 'nextCursor': None}, {'items': [None], 'nextCursor': 'next'}):
            with self.subTest(page=page), self.assertRaises(ProjectError):
                self.catalog.ingest(page, 'checkpoint')
        self.assertEqual(self.catalog.stats()['pages'], 1)
        self.catalog.ingest({'items': [], 'nextCursor': None}, 'checkpoint')
        self.assertEqual(self.catalog.stats()['available'], 1)

    def test_ten_thousand_entries_paginate_with_stable_ties(self):
        rows = [skill(slug=f'capability-{index:05d}', downloads=index % 3) for index in range(10201)]
        self.catalog.ingest({'items': rows, 'nextCursor': 'more'}, None)
        first = self.catalog.search(limit=100)
        self.assertEqual(first['total'], 10201)
        identifiers = []
        for page in range(103):
            identifiers.extend(item['id'] for item in self.catalog.search(page=page, limit=100, generation=first['generation'])['items'])
        self.assertEqual(len(identifiers), 10201)
        self.assertEqual(len(set(identifiers)), 10201)
        self.assertEqual(self.catalog.search(query='capability-00012')['total'], 1)
        self.assertEqual(self.catalog.search(query='%')['total'], 0)
        self.catalog.ingest({'items': [skill('new-owner')], 'nextCursor': None}, 'more')
        with self.assertRaises(ProjectError) as failure:
            self.catalog.search(page=1, generation=first['generation'])
        self.assertEqual(failure.exception.status, 409)

    def test_nullable_metadata_and_missing_identity(self):
        parsed = parse_skill({**skill(), 'latestVersion': None, 'metadata': None})
        self.assertEqual(parsed['version'], '')
        self.assertEqual(parsed['requirements'], [])
        self.assertIsNone(parse_skill({'slug': 'no-owner'}))

    def test_cursor_cycles_are_rejected_across_resumed_instances(self):
        self.catalog.ingest({'items': [skill()], 'nextCursor': 'A'}, None)
        resumed = Catalog(self.projects, Mock())
        resumed.ingest({'items': [skill('two')], 'nextCursor': 'B'}, 'A')
        before = resumed.stats()
        with self.assertRaises(ProjectError):
            Catalog(self.projects, Mock()).ingest({'items': [skill('three')], 'nextCursor': 'A'}, 'B')
        self.assertEqual(resumed.stats(), before)

    def test_install_uses_selected_version_without_force_and_does_not_invent_readiness(self):
        self.catalog.ingest({'items': [skill()], 'nextCursor': None}, None)
        gateway = self.catalog.gateway
        gateway.mutations = threading.Lock()
        gateway.command.return_value = 'Installed.'
        gateway.skills.return_value = []
        result = self.catalog.install('clawhub:author/example', lambda _: None)
        self.assertFalse(result['ready'])
        self.assertFalse(result['provenance_verified'])
        gateway.command.assert_called_once_with('skills', 'install', '@author/example', '--version', '1.0.0', timeout=180)


class ConversationTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.gateway = Mock()
        self.conversations = Conversations(self.projects, self.gateway)

    def test_metadata_survives_restart_and_new_threads_have_no_fabricated_history(self):
        item = self.conversations.ensure('fixture')
        self.assertFalse(item['started'])
        restored = Conversations(self.projects, self.gateway)
        self.assertEqual(restored.list('fixture')[0]['thread'], item['thread'])
        self.assertEqual(restored.history('fixture', item['thread'])['messages'], [])
        self.gateway.rpc.assert_not_called()

    def test_session_mapping_is_unambiguous(self):
        self.assertNotEqual(session_key('a-b', 'c'), session_key('a', 'b-c'))
        self.assertEqual(session_key('medical', '05629389-dc13-4879-95a2-c83933fee365'),
                         'agent:main:project-medical-05629389-dc13-4879-95a2-c83933fee365')

    def test_adopted_legacy_thread_queries_authoritative_history(self):
        thread = '05629389-dc13-4879-95a2-c83933fee365'
        self.gateway.rpc.return_value = {'messages': [{'role': 'user', 'content': 'Existing question'}], 'sessionInfo': {}}
        self.conversations.ensure('fixture', thread)
        self.assertEqual(self.conversations.history('fixture', thread)['messages'][0]['text'], 'Existing question')
        self.gateway.rpc.assert_called_once()

    def test_reconnected_project_cannot_reuse_another_root_context(self):
        item = self.conversations.ensure('fixture')
        self.projects.disconnect('fixture')
        replacement = self.base / 'different'
        replacement.mkdir()
        self.projects.connect('Fixture', [{'path': str(replacement)}])
        self.assertEqual(self.conversations.list('fixture'), [])
        with self.assertRaises(ProjectError):
            self.conversations.ensure('fixture', item['thread'])

    def test_history_projection_excludes_tools_thinking_and_legacy_context(self):
        data = {'messages': [
            {'role': 'user', 'content': 'Active project: Fixture.\nSystem context\n\nUser request:\nReal question'},
            {'role': 'toolResult', 'content': [{'type': 'text', 'text': 'internal result'}]},
            {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Working'}, {'type': 'toolCall', 'name': 'read'}]},
            {'role': 'assistant', 'content': [{'type': 'thinking', 'text': 'hidden'}, {'type': 'text', 'text': 'Final answer'}]},
            {'role': 'user', 'content': 'Keep the literal User request: phrase.'},
        ], 'sessionInfo': {'hasActiveRun': True}, 'hasMore': True, 'nextOffset': 5}
        result = project_history(data)
        self.assertEqual([entry['text'] for entry in result['messages']], ['Real question', 'Final answer', 'Keep the literal User request: phrase.'])
        self.assertTrue(result['active'])
        self.assertTrue(result['has_more'])


class ChatTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.hub = Hub(self.projects, 'test-project', 'test-gateway', reviews=False)
        self.addCleanup(self.hub.operations.pool.shutdown)

    def test_context_is_separate_and_does_not_scan_or_prefetch_git(self):
        with patch.object(self.projects, 'overview') as overview, patch.object(self.projects, 'index') as index, patch.object(self.projects, 'git_status') as git:
            request, _, _, _ = self.hub.chat_service.prepare({'project': 'fixture', 'thread': 'test-thread', 'message': 'Actual user message'})
        payload = json.loads(request.data)
        self.assertEqual(payload['messages'][0]['role'], 'system')
        self.assertIn('Follow the synthetic project instruction.', payload['messages'][0]['content'])
        self.assertEqual(payload['messages'][1], {'role': 'user', 'content': 'Actual user message'})
        overview.assert_not_called()
        index.assert_not_called()
        git.assert_not_called()

    def test_stream_parser_handles_crlf_comments_and_terminal_failure(self):
        raw = b': heartbeat\r\ndata: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
        self.assertEqual(list(stream_events(io.BytesIO(raw)))[0]['choices'][0]['delta']['content'], 'hello')
        with self.assertRaises(ProjectError):
            list(stream_events(io.BytesIO(b'data: {"choices":[]}\n\n')))
        with self.assertRaises(ProjectError):
            list(stream_events(io.BytesIO(b'data: invalid\n\ndata: [DONE]\n\n')))

    def test_voice_mode_rejects_non_booleans_before_turn_actions(self):
        chat = self.hub.chat_service
        for invalid in (None, 0, 1, '', 'false', [], {}):
            with self.subTest(invalid=invalid), patch.object(self.projects, 'get') as get:
                with self.assertRaisesRegex(ProjectError, 'voice_mode must be a boolean'):
                    chat.prepare({'project': 'fixture', 'message': 'Question', 'voice_mode': invalid})
                get.assert_not_called()

    def test_voice_mode_is_request_local_and_preserves_evidence(self):
        (self.root / 'package.json').write_text('{"dependencies":{"react":"19.0.2"}}', encoding='utf-8')
        request = {'project': 'fixture', 'thread': 'voice-contract', 'message': 'Read app package.json.'}
        chat = self.hub.chat_service
        default, _, _, _ = chat.prepare(request)
        spoken, _, _, _ = chat.prepare({**request, 'voice_mode': True}, True)
        after, _, _, _ = chat.prepare({**request, 'voice_mode': False})
        self.assertEqual(default.data, after.data)
        payload = json.loads(spoken.data)
        context = payload['messages'][0]['content']
        self.assertIn('Voice mode:', context)
        self.assertNotIn('Voice mode:', json.loads(after.data)['messages'][0]['content'])
        self.assertIn('19.0.2', context)
        self.assertIn('Follow the synthetic project instruction.', context)
        self.assertIn('Catalog entries are not active capabilities', context)
        self.assertEqual(payload['messages'][1], {'role': 'user', 'content': request['message']})
        self.assertTrue(payload['stream'])

    def test_named_file_evidence_is_fresh_and_qualified(self):
        file = self.root / 'package.json'
        file.write_text('{"dependencies":{"react":"19.0.1"}}', encoding='utf-8')
        request, conversation, _, _ = self.hub.chat_service.prepare({'project': 'fixture', 'thread': 'evidence', 'message': 'Read app package.json and give the React version.'})
        self.assertIn('19.0.1', json.loads(request.data)['messages'][0]['content'])
        self.assertEqual(conversation['evidence'][0]['source'], 'fixture/app/package.json')
        file.write_text('{"dependencies":{"react":"19.0.2"}}', encoding='utf-8')
        updated, _, _, _ = self.hub.chat_service.prepare({'project': 'fixture', 'thread': 'evidence', 'message': 'Read app package.json and give the React version.'})
        self.assertIn('19.0.2', json.loads(updated.data)['messages'][0]['content'])
        self.assertNotIn('19.0.1', json.loads(updated.data)['messages'][0]['content'])

    def test_stream_error_releases_capacity_and_closes_upstream(self):
        raw = b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"synthetic failure"}}\n\ndata: [DONE]\n\n'
        upstream = io.BytesIO(raw)
        upstream.headers = Headers()
        upstream.headers['Content-Type'] = 'text/event-stream'
        with patch('project_hub.chat.urllib.request.urlopen', return_value=upstream):
            events = self.hub.chat_service.events({'project': 'fixture', 'thread': 'stream-test', 'message': 'Question'})
            self.assertEqual(next(events)['type'], 'start')
            self.assertEqual(next(events)['type'], 'delta')
            with self.assertRaises(ProjectError):
                next(events)
        self.assertTrue(upstream.closed)
        self.assertEqual(self.hub.active_chats, 0)

    def test_duplicate_thread_is_rejected_and_generator_close_releases_slot(self):
        first = self.hub.chat_service.events({'project': 'fixture', 'thread': 'same', 'message': 'One'})
        self.assertEqual(next(first)['type'], 'start')
        second = self.hub.chat_service.events({'project': 'fixture', 'thread': 'same', 'message': 'Two'})
        with self.assertRaises(ProjectError) as failure:
            next(second)
        self.assertEqual(failure.exception.status, 409)
        first.close()
        self.assertEqual(self.hub.active_chats, 0)

    def test_heartbeat_only_stream_obeys_total_deadline(self):
        upstream = io.BytesIO(b': heartbeat\n: heartbeat\n')
        upstream.headers = Headers()
        upstream.headers['Content-Type'] = 'text/event-stream'
        with patch('project_hub.chat.urllib.request.urlopen', return_value=upstream), patch('project_hub.chat.time.monotonic', side_effect=[0, 1, 241]):
            events = self.hub.chat_service.events({'project': 'fixture', 'thread': 'deadline', 'message': 'Question'})
            next(events)
            with self.assertRaises(ProjectError) as failure:
                next(events)
        self.assertEqual(failure.exception.status, 504)
        self.assertTrue(upstream.closed)
        self.assertEqual(self.hub.active_chats, 0)


class OperationTests(StoreFixture):
    def test_submission_failure_produces_a_terminal_receipt(self):
        operations = Operations(self.projects)
        self.addCleanup(operations.pool.shutdown)
        action = Mock()
        with patch.object(operations.pool, 'submit', side_effect=RuntimeError('Synthetic scheduler failure')):
            with self.assertRaises(RuntimeError):
                operations.start('test', 'Test operation', action)
        self.assertEqual(operations.count(), 0)
        self.assertEqual(operations.list()[0]['status'], 'failed')
        self.assertIn('Synthetic scheduler failure', operations.list()[0]['result']['error'])
        action.assert_not_called()

    def test_readiness_requires_complete_inventory_evidence(self):
        gateway = Gateway()
        good = {'name':'good','eligible':True,'modelVisible':True,'disabled':False,
                'blockedByAgentFilter':False,'blockedByAllowlist':False,
                'missing':{key:[] for key in ('bins','anyBins','env','config','os')}}
        with patch.object(gateway, 'command', return_value={'skills':[good, {**good,'name':'unknown','missing':None}, {**good,'name':'blocked','blockedByAgentFilter':True}]}):
            values = gateway.skills()
        self.assertEqual([item['ready'] for item in values], [True, False, False])


class PreferenceTests(StoreFixture):
    def test_preferences_persist_and_validate(self):
        preferences = Preferences(self.projects)
        preferences.save({'theme': 'light', 'auto_speak': True})
        self.assertEqual(Preferences(self.projects).get()['theme'], 'light')
        self.assertTrue(preferences.get()['auto_speak'])
        for invalid in ({'theme': 'unknown'}, {'auto_speak': 'yes'}, {'voice': 'missing'}, {'api_key': 'not-accepted'}):
            with self.subTest(invalid=invalid), self.assertRaises(ProjectError):
                preferences.save(invalid)


if __name__ == '__main__':
    unittest.main()
