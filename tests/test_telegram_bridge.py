import sys
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import telegram_bridge as bridge


class TelegramBridgeTests(unittest.TestCase):
    def test_long_replies_chunk_at_telegram_limit(self):
        text = 'x' * 9000
        chunks = bridge.chunk_text(text)
        self.assertEqual(len(chunks), 3)
        self.assertTrue(all(len(chunk) <= 4096 for chunk in chunks))
        self.assertEqual(''.join(chunks), text)

    def test_empty_reply_never_sends_empty_message(self):
        self.assertEqual(bridge.chunk_text('   '), ['(Empty reply — nothing to send.)'])

    def test_allowlist_is_fail_closed(self):
        self.assertTrue(bridge.is_allowed('123', {'123'}))
        self.assertFalse(bridge.is_allowed('123', set()))
        self.assertFalse(bridge.is_allowed('', {'123'}))
        self.assertFalse(bridge.is_allowed('999', {'123'}))

    def test_text_message_extraction_bounds_length(self):
        update = {'update_id': 1, 'message': {'message_id': 5, 'chat': {'id': 42}, 'text': '  hello  '}}
        self.assertEqual(bridge.extract_message(update),
                         {'chat_id': '42', 'message_id': 5, 'text': 'hello', 'voice_file_id': ''})

    def test_voice_message_extraction_prefers_text(self):
        update = {'update_id': 2, 'message': {'message_id': 6, 'chat': {'id': 7},
                                             'text': 'caption', 'voice': {'file_id': 'abc'}}}
        self.assertEqual(bridge.extract_message(update)['text'], 'caption')

    def test_voice_only_message_extracts_file(self):
        update = {'update_id': 3, 'message': {'message_id': 8, 'chat': {'id': 9},
                                             'voice': {'file_id': 'voice-1'}}}
        self.assertEqual(bridge.extract_message(update)['voice_file_id'], 'voice-1')

    def test_stickers_and_missing_chat_are_ignored(self):
        self.assertIsNone(bridge.extract_message({'update_id': 4, 'message': {'message_id': 1, 'chat': {'id': 1},
                                                                             'sticker': {'file_id': 'x'}}}))
        self.assertIsNone(bridge.extract_message({'update_id': 5}))

    def test_call_button_only_with_active_operator_link(self):
        good = {'url': 'https://example.trycloudflare.com', 'expires': time.time() + 600, 'operator_enabled': True}
        self.assertEqual(bridge.call_url_from_config(good), 'https://example.trycloudflare.com/#operator')
        self.assertIsNone(bridge.call_url_from_config(None))
        self.assertIsNone(bridge.call_url_from_config({**good, 'operator_enabled': False}))
        self.assertIsNone(bridge.call_url_from_config({**good, 'expires': time.time() - 1}))
        text, markup = bridge.build_welcome('https://example.trycloudflare.com/#operator')
        self.assertIn('Call JARVIS', str(markup))
        _, no_markup = bridge.build_welcome(None)
        self.assertIsNone(no_markup)

    def test_token_never_appears_in_error_text(self):
        token = '123456:ABCdefGHIjklMNOpqrSTUvwxYZ123456789'
        message = bridge.redact('failed for %s now' % token, [token])
        self.assertNotIn(token, message)
        self.assertIn('[redacted]', message)

    def test_unsupported_telegram_method_rejected_before_network(self):
        with self.assertRaises(ValueError):
            bridge.telegram_call('123456:synthetic-token-abcdefghij123456', 'deleteWebhook')
        with self.assertRaises(ValueError):
            bridge.telegram_call('not-a-token', 'getMe')

    def test_webhook_set_refuses_long_polling_save(self):
        with patch.object(bridge, 'telegram_call') as call, \
             patch('getpass.getpass', return_value='123456:synthetic-token-abcdefghij123456'), \
             patch.object(bridge, 'private_write') as saved:
            call.side_effect = [{'username': 'synthetic_bot'}, {'url': 'https://elsewhere.invalid/hook'}]
            self.assertEqual(bridge.cmd_configure(replace=True), 1)
            saved.assert_not_called()

    def test_callback_queries_project_to_safe_decisions(self):
        update = {'update_id': 9, 'callback_query': {'id': 'cb-1', 'data': 'ap:12345678-1234-4234-8234-123456789012',
                                                    'message': {'message_id': 3, 'chat': {'id': 42}}}}
        self.assertEqual(bridge.extract_callback(update),
                         {'callback_id': 'cb-1', 'chat_id': '42', 'message_id': 3,
                          'decision': 'approve', 'action_id': '12345678-1234-4234-8234-123456789012'})
        forged = {'update_id': 10, 'callback_query': {'id': 'cb-2', 'data': 'ap:not-a-uuid',
                                                     'message': {'message_id': 3, 'chat': {'id': 42}}}}
        self.assertIsNone(bridge.extract_callback(forged))
        self.assertIsNone(bridge.extract_callback({'update_id': 11}))

    def test_approval_extraction_only_flags_approval_required(self):
        run = {'state': 'completed', 'result': {'text': 'needs approval', 'toolResults': [
            {'tool': 'jarvis_send_email', 'observation': {'ok': True, 'status': 'approval_required',
             'action': {'id': '12345678-1234-4234-8234-123456789012', 'reason': 'confirmation required'}}},
            {'tool': 'jarvis_clock', 'observation': {'ok': True, 'status': 'completed'}}]}}
        approvals = bridge.pending_approvals(run)
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]['tool'], 'jarvis_send_email')
        self.assertEqual(bridge.pending_approvals({'state': 'completed', 'result': {}}), [])

    def test_approval_summary_scrubs_credential_fields(self):
        action = {'input': {'to': 'boss@example.test', 'password': 'hunter2', 'subject': 'Report'}}
        summary = bridge.summarize_input(action)
        self.assertIn('boss@example.test', summary)
        self.assertNotIn('hunter2', summary)
        markup = bridge.approval_markup('12345678-1234-4234-8234-123456789012')
        buttons = markup['inline_keyboard'][0]
        self.assertTrue(buttons[0]['callback_data'].startswith('ap:'))
        self.assertTrue(buttons[1]['callback_data'].startswith('dn:'))

    def test_send_text_returns_first_message_id_for_edits(self):
        with patch.object(bridge, 'telegram_call', return_value={'message_id': 77}) as call:
            self.assertEqual(bridge.send_text('123456:synthetic-token-abcdefghij123456', '42', 'hello'), 77)
            call.assert_called_once()

    def test_concise_keeps_short_and_cuts_at_sentences(self):
        self.assertEqual(bridge.concise('short answer'), 'short answer')
        long = 'First sentence. ' + 'x' * 3000
        cut = bridge.concise(long)
        self.assertTrue(cut.endswith('(Shortened for Telegram — the full answer is in Tasks.)'))
        self.assertLessEqual(len(cut), 2600)
        wall = 'z' * 3000
        self.assertIn('(Shortened for Telegram', bridge.concise(wall))

    def test_password_command_never_echoes_or_logs_the_code(self):
        session = Mock()
        session.connect_mail.return_value = {'connected': True, 'user': bridge.GMAIL_USER, 'sendingConfigured': True}
        code = 'abcdefghijklmnop'
        with patch.object(bridge, 'send_text') as sent, patch.object(bridge, 'delete_message') as deleted:
            bridge.handle_password(session, '123456:synthetic-token-abcdefghij123456', '42', 7, '/paswerd ' + code)
        session.connect_mail.assert_called_once_with(bridge.GMAIL_USER, code)
        deleted.assert_called_once_with('123456:synthetic-token-abcdefghij123456', '42', 7)
        reply = sent.call_args[0][2]
        self.assertNotIn(code, reply)
        self.assertIn('Mail connected', reply)

    def test_password_command_normalizes_spacing_and_case(self):
        session = Mock()
        session.connect_mail.return_value = {'connected': True}
        with patch.object(bridge, 'send_text'), patch.object(bridge, 'delete_message'):
            bridge.handle_password(session, 't', '42', 7, '/paswerd ABCD EFGH IJKL MNOP')
        session.connect_mail.assert_called_once_with(bridge.GMAIL_USER, 'abcdefghijklmnop')

    def test_password_command_rejects_bad_format_and_locks_out(self):
        session = Mock()
        session.connect_mail.side_effect = RuntimeError('rejected')
        bridge.MAIL_LOCKOUTS.clear()
        with patch.object(bridge, 'send_text') as sent, patch.object(bridge, 'delete_message'):
            bridge.handle_password(session, 't', '42', 7, '/paswerd wrong')
            self.assertIn('Usage', sent.call_args[0][2])
            session.connect_mail.assert_not_called()
            for _ in range(3):
                bridge.handle_password(session, 't', '42', 7, '/paswerd abcdefghijklmnop')
            bridge.handle_password(session, 't', '42', 7, '/paswerd abcdefghijklmnop')
            self.assertIn('wait 10 minutes', sent.call_args[0][2])
        self.assertEqual(session.connect_mail.call_count, 3)
        bridge.MAIL_LOCKOUTS.clear()

    def test_command_menu_and_phone_keyboard_shapes(self):
        self.assertEqual(len(bridge.COMMANDS), 6)
        self.assertTrue(all('command' in item and 'description' in item for item in bridge.COMMANDS))
        self.assertIn('paswerd', [item['command'] for item in bridge.COMMANDS])
        self.assertIn('code', [item['command'] for item in bridge.COMMANDS])
        labels = [button['text'] for row in bridge.PHONE_KEYBOARD['keyboard'] for button in row]
        self.assertEqual(len(labels), 3)
        for label in labels:
            self.assertIn(label.strip().lower(), bridge.BUTTON_COMMANDS)

    def test_keyboard_buttons_route_to_commands(self):
        seen = {}

        class FakeSession:
            def conversation_for(self, chat_id):
                return 'conv-1'

        import json as _json

        class FakeRun:
            pass

        session = FakeSession()
        with patch.object(bridge, 'send_text') as sent, \
             patch.object(bridge, 'read_conversations', return_value={}), \
             patch.object(bridge, 'write_conversations'):
            bridge.handle_text(session, 't', '42', '📞 Call JARVIS', None)
            self.assertIn('No active call link', sent.call_args[0][2])
            bridge.handle_text(session, 't', '42', '🆕 New chat', None)
            self.assertIn('Fresh chat', sent.call_args[0][2])

    def test_greetings_answer_instantly_in_the_right_language(self):
        self.assertEqual(bridge.greeting_reply('ahoj'), 'Ahoj! S čím ti dneska pomůžu?')
        self.assertEqual(bridge.greeting_reply('Díky!'), 'Ahoj! S čím ti dneska pomůžu?')
        self.assertEqual(bridge.greeting_reply('hello'), 'Hey! What can I do for you?')
        self.assertIsNone(bridge.greeting_reply('ahoj, check my mail'))
        self.assertIsNone(bridge.greeting_reply('read the report'))
        self.assertTrue(bridge.detect_czech('Můžeš zkontrolovat maily?'))
        self.assertFalse(bridge.detect_czech('Check my mail please'))

    def test_instant_greeting_never_touches_the_model(self):
        session = Mock()
        with patch.object(bridge, 'send_text') as sent:
            bridge.handle_text(session, 't', '42', 'ahoj', None)
        session.ask_run.assert_not_called()
        session.conversation_for.assert_not_called()
        self.assertIn('Ahoj', sent.call_args[0][2])

    def test_password_command_without_code_does_not_crash(self):
        session = Mock()
        with patch.object(bridge, 'send_text') as sent, patch.object(bridge, 'delete_message'):
            bridge.handle_text(session, 't', '42', '/paswerd', None, 9)
        session.connect_mail.assert_not_called()
        self.assertIn('Usage', sent.call_args[0][2])

    def test_bare_code_is_treated_as_password_attempt(self):
        session = Mock()
        session.connect_mail.return_value = {'connected': True, 'user': bridge.GMAIL_USER, 'sendingConfigured': True}
        with patch.object(bridge, 'send_text'), patch.object(bridge, 'delete_message'):
            bridge.handle_text(session, 't', '42', 'abcd efgh ijkl mnop', None, 11)
        session.connect_mail.assert_called_once_with(bridge.GMAIL_USER, 'abcdefghijklmnop')
        session.reset_mock()
        session.ask_run.return_value = {'state': 'failed'}
        with patch.object(bridge, 'send_text'), patch.object(bridge, 'edit_text'):
            bridge.handle_text(session, 't', '42', 'this message has more words', None, 11)
        session.connect_mail.assert_not_called()

    def test_czech_voice_notes_answer_with_czech_voice(self):
        session = Mock()
        session.transcribe.return_value = 'Můžeš zkontrolovat maily?'
        session.ask_run.return_value = {'state': 'completed', 'result': {'text': 'Jistě, hned se podívám.'}}
        session.speak.return_value = b'RIFFfake'
        session.conversation_for.return_value = 'conv-1'
        with patch.object(bridge, 'send_text'), patch.object(bridge, 'edit_text'), \
             patch.object(bridge, 'send_voice_note') as voice_note, \
             patch.object(bridge, 'download_voice', return_value=b'audio'):
            bridge.handle_voice(session, 't', '42', 'file-1')
        session.speak.assert_called_once()
        self.assertEqual(session.speak.call_args[0][1], 'jirka')
        voice_note.assert_called_once()

    def test_send_failures_never_kill_the_poller(self):
        session = Mock()
        session.ask_run.return_value = {'state': 'completed', 'result': {'text': 'done offline'}}
        session.conversation_for.return_value = 'conv-1'
        with patch.object(bridge, 'send_text', side_effect=RuntimeError('down')), \
             patch.object(bridge, 'queue_reply') as queued:
            bridge.handle_text(session, 't', '42', 'do some real work please', None, 9)
        session.ask_run.assert_called_once()
        queued.assert_called_once()
        self.assertIn('done offline', queued.call_args[0][1])
        dead_session = Mock()
        dead_session.ask_run.return_value = {'state': 'failed'}
        with patch.object(bridge, 'send_text', side_effect=[1, RuntimeError('down')]), \
             patch.object(bridge, 'edit_text', side_effect=RuntimeError('down')):
            bridge.handle_text(dead_session, 't', '42', 'do some real work please', None, 9)

    def test_outbox_queues_and_flushes_unsent_replies(self):
        bridge.write_outbox([])
        bridge.queue_reply('42', 'hello delayed')
        self.assertEqual(len(bridge.read_outbox()), 1)
        with patch.object(bridge, 'send_text', side_effect=RuntimeError('down')):
            bridge.flush_outbox('t')
            self.assertEqual(len(bridge.read_outbox()), 1)
            self.assertEqual(bridge.read_outbox()[0]['tries'], 1)
        with patch.object(bridge, 'send_text') as sent:
            bridge.flush_outbox('t')
            self.assertEqual(bridge.read_outbox(), [])
            sent.assert_called_once()
            self.assertNotIn('secret', sent.call_args[0][2])
        bridge.write_outbox([])

    def test_failed_final_answer_is_queued_not_lost(self):
        session = Mock()
        session.ask_run.return_value = {'state': 'completed', 'result': {'text': 'real answer here'}}
        session.conversation_for.return_value = 'conv-1'
        with patch.object(bridge, 'send_text', return_value=1), \
             patch.object(bridge, 'edit_text', side_effect=RuntimeError('down')), \
             patch.object(bridge, 'queue_reply') as queued:
            bridge.handle_text(session, 't', '42', 'do some real work please', None, 9)
        queued.assert_called_once()
        self.assertIn('real answer here', queued.call_args[0][1])

    def test_fast_lane_answers_without_model_turns(self):
        session = Mock()
        session.conversation_for.return_value = 'conv-1'
        session.skills_list.return_value = [
            {'id': 'jarvis_mail', 'state': 'ready'},
            {'id': 'jarvis_code', 'state': 'ready'},
            {'id': 'jarvis_broken', 'state': 'invalid'}]
        answer = bridge.fast_reply(session, '42', 'what can you do?')
        self.assertIn('Mail', answer)
        self.assertNotIn('broken', answer)
        session.ask_run.assert_not_called()
        session.invoke_tool.return_value = {'ok': True, 'result': {'data': {'programs': [{'name': 'opencode', 'pid': 1234}]}}}
        self.assertIn('PID 1234', bridge.fast_reply(session, '42', 'is opencode running'))
        session.invoke_tool.return_value = {'ok': True, 'result': {'data': {'programs': []}}}
        self.assertIn('not running', bridge.fast_reply(session, '42', 'is clippy running'))
        session.invoke_tool.return_value = {'ok': True, 'result': {'data': {'localTime': '21:03:05', 'localDate': '2026-10-14', 'timezone': 'Europe/Prague'}}}
        self.assertIn('21:03:05', bridge.fast_reply(session, '42', 'kolik je hodin'))
        self.assertIsNone(bridge.fast_reply(session, '42', 'write me an essay about dogs'))
        failing = Mock()
        failing.conversation_for.side_effect = RuntimeError('down')
        self.assertIsNone(bridge.fast_reply(failing, '42', 'what can you do?'))

    def test_code_command_lists_and_switches_access(self):
        projects = [{'id': 'demo', 'path': 'C:/demo'}, {'id': 'site', 'path': 'C:/site', 'access': 'off'}]
        with patch.object(bridge, 'code_projects', return_value=projects):
            listed = bridge.handle_code('42', '/code')
            self.assertIn('demo — ask', listed)
            self.assertIn('site — off', listed)
        with patch.object(bridge, 'set_code_access', return_value=True) as setter:
            self.assertIn('now OFF', bridge.handle_code('42', '/code demo off'))
            setter.assert_called_once_with('demo', 'off')
        with patch.object(bridge, 'set_code_access', return_value=False):
            self.assertIn('Unknown project', bridge.handle_code('42', '/code nope off'))
        self.assertIn('Usage', bridge.handle_code('42', '/code demo maybe'))

    def test_status_reports_names_never_secrets(self):
        with patch.object(bridge, 'read_token', return_value='123456:synthetic-token-abcdefghij123456'), \
             patch.object(bridge, 'telegram_call', return_value={'username': 'synthetic_bot'}) as call, \
             patch('urllib.request.urlopen', side_effect=OSError()):
            with patch('builtins.print') as printed:
                self.assertEqual(bridge.cmd_status(network=True), 0)
            call.assert_called_once()
            self.assertNotIn('123456:synthetic', str(printed.call_args))


if __name__ == '__main__':
    unittest.main()
