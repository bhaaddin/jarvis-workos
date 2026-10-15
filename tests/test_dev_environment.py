import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import setup_table_engine
import dev


class DevelopmentEnvironmentTests(unittest.TestCase):
    def test_table_source_identity_changes_when_worker_changes(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'runtime') as folder:
            root = Path(folder)
            source = root / 'operator/table-sandbox'
            source.mkdir(parents=True)
            for name in setup_table_engine.SOURCES:
                (source / name).write_text('synthetic', encoding='utf-8')
            first = setup_table_engine.source_digest(root)
            (source / 'worker.py').write_text('changed', encoding='utf-8')
            self.assertNotEqual(first, setup_table_engine.source_digest(root))
            self.assertEqual(setup_table_engine.inspect_engine(root)['code'], 'TABLE_ENGINE_NOT_INSTALLED')

    def test_unowned_table_record_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'runtime') as folder:
            root = Path(folder)
            (root / 'runtime').mkdir()
            record = root / 'runtime/table-engine.json'
            record.write_text(json.dumps({'owner': 'somebody-else'}), encoding='utf-8')
            with patch.object(setup_table_engine, 'inspect_engine', return_value={'ready': False}):
                with self.assertRaisesRegex(RuntimeError, 'not owned'):
                    setup_table_engine.install_engine(root)
            self.assertEqual(json.loads(record.read_text())['owner'], 'somebody-else')

    def test_diagnostics_refuse_nonlocal_or_credential_bearing_endpoints(self):
        for url in ('https://external.example/api/ps', 'http://user:secret@127.0.0.1:11436/api/ps', 'file:///private'):
            with self.assertRaises(RuntimeError):
                dev.request_json(url)

    def test_private_configuration_reports_names_not_secret_values(self):
        result = dev.private_config_status({'JARVIS_OPERATOR_DATA_KEY': 'SYNTHETIC_PRIVATE_INVALID_VALUE'})
        self.assertIn('JARVIS_OPERATOR_DATA_KEY', result['invalidNames'])
        self.assertIn('JARVIS_OPERATOR_ADMIN_PASSWORD', result['missingNames'])
        self.assertNotIn('SYNTHETIC_PRIVATE', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
