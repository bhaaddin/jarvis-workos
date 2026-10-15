import hashlib
import hmac
import json
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

from project_hub import whatsapp_calling as wa

ENV = {'WHATSAPP_ACCESS_TOKEN': 'synthetic-access-token', 'WHATSAPP_PHONE_NUMBER_ID': '123456789012345',
       'WHATSAPP_VERIFY_TOKEN': 'synthetic-verify', 'WHATSAPP_APP_SECRET': 'synthetic-secret'}


class WhatsAppCallingTests(unittest.TestCase):
    def test_presence_report_never_contains_secrets(self):
        report = wa.configured(ENV)
        self.assertTrue(report['ready'])
        self.assertNotIn('synthetic', json.dumps(report))

    def test_missing_config_lists_names_not_values(self):
        with self.assertRaisesRegex(wa.WhatsAppError, 'WHATSAPP_ACCESS_TOKEN'):
            wa.require_configured({})
        with self.assertRaisesRegex(wa.WhatsAppError, 'WHATSAPP_APP_SECRET'):
            wa.require_configured({k: v for k, v in ENV.items() if k != 'WHATSAPP_APP_SECRET'})

    def test_handshake_accepts_subscribe_and_rejects_forgery(self):
        query = urllib.parse.parse_qs('hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=abcDEF123')
        self.assertEqual(wa.verify_handshake(query, 'synthetic-verify'), 'abcDEF123')
        forged = urllib.parse.parse_qs('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abcDEF123')
        with self.assertRaises(wa.WhatsAppError):
            wa.verify_handshake(forged, 'synthetic-verify')
        with self.assertRaises(wa.WhatsAppError):
            wa.verify_handshake({'hub.mode': ['publish']}, 'synthetic-verify')

    def test_signature_vector_matches_hmac_sha256(self):
        raw = b'{"object":"whatsapp_business_account"}'
        digest = hmac.new(b'synthetic-secret', raw, hashlib.sha256).hexdigest()
        wa.verify_signature(raw, 'sha256=' + digest, 'synthetic-secret')
        with self.assertRaises(wa.WhatsAppError):
            wa.verify_signature(raw, 'sha256=' + '0' * 64, 'synthetic-secret')
        with self.assertRaises(wa.WhatsAppError):
            wa.verify_signature(raw, '', 'synthetic-secret')

    def test_event_parsing_projects_messages_and_calls(self):
        payload = {'entry': [{'changes': [{'value': {
            'messages': [{'from': '+420111222333', 'id': 'wamid.1', 'type': 'text', 'text': {'body': 'hello'}},
                         {'from': '+420111222333', 'id': 'wamid.2', 'type': 'audio', 'audio': {'id': 'media-9'}},
                         {'from': '+420111222333', 'id': 'wamid.3', 'type': 'sticker'}],
            'calls': [{'id': 'call-1', 'event': 'RINGING', 'direction': 'inbound', 'from': '+420111222333'}]}}]}]}
        parsed = wa.parse_event(payload)
        self.assertEqual(len(parsed['messages']), 2)
        self.assertEqual(parsed['messages'][0]['text'], 'hello')
        self.assertEqual(parsed['messages'][1]['media_id'], 'media-9')
        self.assertEqual(parsed['calls'][0]['event'], 'RINGING')
        with self.assertRaises(wa.WhatsAppError):
            wa.parse_event({'unexpected': True})

    def test_outbound_calls_validate_before_network(self):
        with patch.object(wa, 'graph_post', return_value={'messages': [{'id': 'wamid.9'}]}) as post:
            wa.send_text(ENV, '+420111222333', 'hello')
            post.assert_called_once()
        with self.assertRaises(wa.WhatsAppError):
            wa.send_text(ENV, 'not-a-number', 'hello')
        with self.assertRaises(wa.WhatsAppError):
            wa.manage_call(ENV, 'launch', 'call-1')
        with self.assertRaises(wa.WhatsAppError):
            wa.request_call_permission(ENV, 'not-a-number')

    def test_network_failures_never_echo_credentials(self):
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
            with self.assertRaisesRegex(wa.WhatsAppError, 'could not complete'):
                wa.send_text(ENV, '+420111222333', 'hello')
        try:
            wa.send_text(ENV, '+420111222333', 'hello')
        except wa.WhatsAppError as error:
            self.assertNotIn('synthetic-access-token', str(error))


if __name__ == '__main__':
    unittest.main()
