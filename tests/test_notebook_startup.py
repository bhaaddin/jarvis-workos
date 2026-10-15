import importlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPTS = str(Path(__file__).resolve().parents[1] / 'scripts')
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
notebook = importlib.import_module('remote_call')


class NotebookStartupTests(unittest.TestCase):
    def test_task_access_is_not_published_when_native_readiness_fails(self):
        with patch('dev.up', side_effect=RuntimeError('Synthetic model unavailable')) as ready, \
             patch.object(notebook, 'save_config') as save, patch.object(notebook, 'stop') as stop:
            with self.assertRaisesRegex(RuntimeError, 'model unavailable'):
                notebook.start(False, tasks=True)
            ready.assert_called_once_with(voice=True)
            save.assert_not_called()
            stop.assert_not_called()

    def test_reusing_access_still_prepares_model_and_speech_without_rotating_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'access.json'
            value = {'expires': time.time() + 600, 'url': 'https://fixture.trycloudflare.com',
                     'operator_enabled': True, 'username': 'fixture', 'password': 'synthetic-only'}
            config.write_text(json.dumps(value))
            with patch.object(notebook, 'CONFIG', config), patch('dev.up') as ready, \
                 patch.object(notebook, 'request', return_value=io.BytesIO(b'{"service":"jarvis-notebook-relay"}')), \
                 patch.object(notebook, 'access_page') as card, patch.object(notebook, 'stop') as stop:
                notebook.start(False, tasks=True)
                ready.assert_called_once_with(voice=True)
                card.assert_called_once_with(value)
                stop.assert_not_called()
                self.assertEqual(json.loads(config.read_text()), value)
