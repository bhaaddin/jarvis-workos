import json
import threading
import unittest
from unittest.mock import patch

from test_command_center import StoreFixture
from project_hub.conversations import project_history
from project_hub.quick_replies import MARKER, QuickReplies, quick_match
from project_hub.server import Hub

FACTS = {'available': True, 'source': 'Open-Meteo', 'as_of': '2026-09-26T21:45', 'timezone': 'Europe/Prague',
         'location': {'name': 'Prague', 'country': 'Czechia'},
         'current': {'temperature_c': 16.1, 'condition': 'partly cloudy', 'wind_kmh': 1.6},
         'forecast': [{'date': '2026-09-26', 'condition': 'overcast', 'low_c': 8, 'high_c': 19, 'rain_probability_percent': 10},
                      {'date': '2026-09-27', 'condition': 'fog', 'low_c': 9, 'high_c': 20, 'rain_probability_percent': 20}]}


class QuickReplyTests(StoreFixture):
    def setUp(self):
        super().setUp()
        self.hub = Hub(self.projects, 'synthetic', 'synthetic', reviews=False)
        for pool in (self.hub.operations.pool, self.hub.chat_jobs.pool, self.hub.weather.pool):
            self.addCleanup(pool.shutdown)
        self.saved = []
        def rpc(method, params, **kwargs):
            if method == 'chat.inject':
                self.saved.append({'role': 'assistant', 'provider': 'openclaw', 'model': 'gateway-injected',
                    'content': [{'type': 'text', 'text': MARKER + params['message']}], 'timestamp': 123})
                return {'ok': True, 'messageId': 'native-test'}
            if method == 'chat.history': return {'messages': self.saved}
            return {'ok': True}
        self.rpc = patch.object(self.hub.gateway, 'rpc', side_effect=rpc).start()
        self.addCleanup(patch.stopall)

    def test_weather_is_formatted_from_current_data_without_any_model_call(self):
        conversation = self.hub.conversations.ensure('fixture')
        body = {'project': 'fixture', 'thread': conversation['thread'], 'message': "What's the weather in Prague?", 'voice_mode': True}
        with patch.object(self.hub.weather, 'lookup', return_value=FACTS) as weather, patch('project_hub.chat.urllib.request.urlopen') as model:
            events = list(self.hub.chat_service.events(body))
        model.assert_not_called()
        weather.assert_called_once_with('Prague')
        self.assertEqual(events[-1]['route'], 'direct-weather')
        self.assertIn('16.1°C', events[-1]['answer'])
        self.assertIn('21:45', events[-1]['answer'])
        self.assertNotIn('tomorrow', events[-1]['answer'].lower())
        self.assertEqual(self.hub.active_chats, 0)
        history = self.hub.conversations.history('fixture', conversation['thread'])
        self.assertEqual([row['role'] for row in history['messages']], ['user', 'assistant'])
        self.assertEqual(history['messages'][0]['text'], body['message'])
        self.assertEqual(history['messages'][1]['text'], events[-1]['answer'])

    def test_quick_context_recovers_from_native_history_after_host_cache_reset(self):
        conversation = self.hub.conversations.ensure('fixture')
        self.hub.chat_service.reply({'project': 'fixture', 'thread': conversation['thread'], 'message': 'What is 2+2?'})
        self.hub.quick_replies = QuickReplies(self.hub)
        call, _, _, _ = self.hub.chat_service.prepare({'project': 'fixture', 'thread': conversation['thread'], 'message': 'Explain that result.'})
        context = json.loads(call.data)['messages'][0]['content']
        self.assertIn('What is 2+2?', context)
        self.assertIn('The answer is 4.', context)

    def test_cancel_before_direct_work_produces_no_native_append(self):
        conversation = self.hub.conversations.ensure('fixture')
        cancelled = threading.Event()
        events = self.hub.chat_service.events({'project': 'fixture', 'thread': conversation['thread'], 'message': 'Hi Jarvis!'}, cancelled=cancelled)
        self.assertEqual(next(events)['type'], 'start')
        cancelled.set()
        with self.assertRaises(Exception): next(events)
        self.assertEqual(self.saved, [])
        self.assertEqual(self.hub.active_chats, 0)

    def test_verified_weather_is_available_before_history_save_but_completion_waits(self):
        conversation = self.hub.conversations.ensure('fixture')
        with patch.object(self.hub.weather, 'lookup', return_value=FACTS):
            events = self.hub.chat_service.events({'project': 'fixture', 'thread': conversation['thread'], 'message': 'Weather in Prague?'})
            self.assertEqual(next(events)['type'], 'start')
            early = next(events)
            self.assertEqual(early['type'], 'delta')
            self.assertIn('16.1°C', early['text'])
            self.assertEqual(self.saved, [])
            final = next(events)
            self.assertEqual(final['answer'], early['text'])
            self.assertEqual(len(self.saved), 1)
            events.close()
        self.assertEqual(self.hub.active_chats, 0)

    def test_only_attested_native_records_project_as_quick_question_answer_pairs(self):
        record = {'version': 1, 'id': 'a' * 32, 'kind': 'social', 'question': 'Hi', 'answer': 'Hello'}
        text = MARKER + json.dumps(record)
        data = {'messages': [{'role': 'assistant', 'provider': 'ollama', 'model': 'qwen3.5:9b', 'content': text}]}
        result = project_history(data)
        self.assertEqual(len(result['messages']), 1)
        self.assertEqual(result['messages'][0]['role'], 'assistant')
        data['messages'][0].update(provider='openclaw', model='gateway-injected')
        self.assertEqual([row['role'] for row in project_history(data)['messages']], ['user', 'assistant'])

    def test_periods_ambiguity_and_provider_failure_are_explicit(self):
        self.assertEqual(quick_match('Weather in Prague tomorrow?')['period'], 'tomorrow')
        self.assertEqual(quick_match('Can you please tell me the weather in Prague?')['location'], 'Prague')
        self.assertEqual(quick_match("What's the weather in Prague tomorrow please?")['period'], 'tomorrow')
        self.assertEqual(quick_match("What's the weather in Prague like?")['location'], 'Prague')
        self.assertIsNone(quick_match("What's the weather in Prague and Brno?"))
        self.assertIsNone(quick_match("What's the weather in Prague and edit weather.py?"))
        with patch.object(self.hub.weather, 'lookup', return_value=FACTS):
            answer, _ = self.hub.quick_replies.answer(quick_match('Weather in Prague tomorrow?'), 'Weather in Prague tomorrow?')
        self.assertIn('2026-09-27', answer)
        self.assertIn('fog', answer)
        with patch.object(self.hub.weather, 'lookup', return_value={'available': False, 'reason': 'timeout'}):
            answer, _ = self.hub.quick_replies.answer(quick_match('Weather in Prague?'), 'Weather in Prague?')
        self.assertIn('cannot retrieve live weather', answer)
