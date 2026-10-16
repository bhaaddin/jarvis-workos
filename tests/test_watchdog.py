import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import jarvis_watchdog as watchdog


class WatchdogTests(unittest.TestCase):
    def test_check_reports_all_services(self):
        with patch.object(watchdog, 'check_url', return_value=True), \
             patch.object(watchdog, 'process_running', return_value=True), \
             patch.object(watchdog, 'call_expires_in', return_value=3600.0):
            report = watchdog.check()
        self.assertEqual(report, {'operator': True, 'hub': True, 'bridge': True,
                                  'call_seconds_left': 3600.0})

    def test_check_never_raises_on_dead_services(self):
        with patch.object(watchdog, 'check_url', return_value=False), \
             patch.object(watchdog, 'process_running', return_value=False), \
             patch.object(watchdog, 'call_expires_in', return_value=None):
            report = watchdog.check()
        self.assertFalse(report['operator'])
        self.assertIsNone(report['call_seconds_left'])

    def test_repair_starts_only_what_is_missing(self):
        started = []
        report = {'operator': True, 'hub': False, 'bridge': True, 'call_seconds_left': 30000.0}
        with patch.object(watchdog, 'check_url', return_value=True), \
             patch.object(watchdog, 'process_running', return_value=True), \
             patch.object(watchdog, 'call_link_works', return_value=True), \
             patch.object(watchdog, 'run_once', return_value=(True, '')) as run, \
             patch.object(watchdog, 'launch_detached') as launch:
            out = watchdog.repair(report)
        run.assert_called_once()
        self.assertIn('scripts/projects.py', run.call_args[0][0])
        launch.assert_not_called()
        self.assertIn('hub started', out['fixed'])
        self.assertNotIn('operator restarted', out.get('fixed', []))
        self.assertTrue(all(started.count(x) == 0 for x in started))

    def test_repair_refreshes_expiring_call_link(self):
        report = {'operator': True, 'hub': True, 'bridge': True, 'call_seconds_left': 100.0}
        with patch.object(watchdog, 'check_url', return_value=True), \
             patch.object(watchdog, 'process_running', return_value=True), \
             patch.object(watchdog, 'run_once', return_value=(True, '')), \
             patch.object(watchdog, 'call_link_works', return_value=True), \
             patch.object(watchdog, 'call_expires_in', side_effect=[100.0, 28700.0]):
            out = watchdog.repair(report)
        self.assertIn('call link refreshed', out['fixed'])
        self.assertAlmostEqual(out['call_seconds_left'], 28700.0)


class ProactiveSayTests(unittest.TestCase):
    def test_say_needs_text_token_and_chats(self):
        import telegram_bridge as bridge
        self.assertEqual(bridge.cmd_say('   '), 1)
        with patch.object(bridge, 'read_token', return_value=None):
            self.assertEqual(bridge.cmd_say('hello'), 1)
        with patch.object(bridge, 'read_token', return_value='t'), \
             patch.object(bridge, 'read_allowed', return_value=set()):
            self.assertEqual(bridge.cmd_say('hello'), 1)

    def test_say_delivers_to_every_allowed_chat(self):
        import telegram_bridge as bridge
        sent = []
        with patch.object(bridge, 'read_token', return_value='t'), \
             patch.object(bridge, 'read_allowed', return_value={'1', '2'}), \
             patch.object(bridge, 'send_text', side_effect=lambda tok, chat, msg: sent.append(chat)):
            with patch('builtins.print'):
                self.assertEqual(bridge.cmd_say('ping'), 0)
        self.assertEqual(sorted(sent), ['1', '2'])


if __name__ == '__main__':
    unittest.main()
