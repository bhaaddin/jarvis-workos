"""Create this project's local configuration without replacing existing files."""

import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_env():
    values = {}
    for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\'')
    return values


def initialize():
    env_path = ROOT / '.env'
    if not env_path.exists():
        template = (ROOT / '.env.example').read_text(encoding='utf-8')
        for marker in ('__GATEWAY_TOKEN__', '__WORKFLOW_TOKEN__', '__ENCRYPTION_KEY__', '__PROJECT_TOKEN__', '__VOICE_TOKEN__', '__SEARXNG_SECRET__'):
            template = template.replace(marker, secrets.token_hex(32))
        env_path.write_text(template, encoding='utf-8')
    env = read_env()
    for key in ('JARVIS_PROJECT_TOKEN', 'JARVIS_VOICE_TOKEN', 'SEARXNG_SECRET'):
        if key not in env:
            with env_path.open('a', encoding='utf-8') as stream:
                stream.write('\n' + key + '=' + secrets.token_hex(32) + '\n')
            env = read_env()
    for key in ('OPENCLAW_GATEWAY_TOKEN', 'JARVIS_WORKFLOW_TOKEN', 'N8N_ENCRYPTION_KEY', 'JARVIS_PROJECT_TOKEN', 'JARVIS_VOICE_TOKEN'):
        if not env.get(key) or env[key].startswith('__'):
            raise ValueError(f'{key} must have a generated value in .env.')

    bootstrap = ROOT / 'runtime' / 'n8n-bootstrap'
    bootstrap.mkdir(parents=True, exist_ok=True)
    credential_file = bootstrap / 'credentials.json'
    if not credential_file.exists():
        credentials = [{
            'id': 'jarvisWebhookKey',
            'name': 'JARVIS workflow key',
            'type': 'httpHeaderAuth',
            'data': {'name': 'X-Jarvis-Key', 'value': env['JARVIS_WORKFLOW_TOKEN']},
        }]
        credential_file.write_text(json.dumps(credentials, indent=2) + '\n', encoding='utf-8')
    return env


if __name__ == '__main__':
    initialize()
    print('Local configuration is ready. Existing configuration and workspaces were preserved.')
