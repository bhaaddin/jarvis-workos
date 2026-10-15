"""Report only credential/config presence for the operational build."""
from datetime import datetime, timezone
import json
import os

from init import ROOT, read_env

groups = {
    'microsoft_graph': ['JARVIS_GRAPH_TENANT_ID', 'JARVIS_GRAPH_CLIENT_ID', 'JARVIS_GRAPH_CLIENT_SECRET', 'JARVIS_GRAPH_USER_ID'],
    'google_office': ['JARVIS_GOOGLE_CLIENT_ID', 'JARVIS_GOOGLE_CLIENT_SECRET', 'JARVIS_GOOGLE_REFRESH_TOKEN'],
    'azure_speech': ['JARVIS_AZURE_SPEECH_KEY', 'JARVIS_AZURE_SPEECH_REGION'],
    'telegram': ['JARVIS_TELEGRAM_BOT_TOKEN', 'JARVIS_TELEGRAM_WEBHOOK_SECRET'],
    'twilio': ['JARVIS_TWILIO_ACCOUNT_SID', 'JARVIS_TWILIO_AUTH_TOKEN', 'JARVIS_TWILIO_WHATSAPP_FROM', 'JARVIS_TWILIO_VOICE_NUMBER'],
    'production_identity': ['JARVIS_OIDC_ISSUER', 'JARVIS_OIDC_AUDIENCE', 'JARVIS_PUBLIC_ORIGIN'],
    'sportmedical_booking': ['JARVIS_BOOKING_BASE_URL', 'JARVIS_BOOKING_API_TOKEN'],
    'sportmedical_billing': ['JARVIS_BILLING_BASE_URL', 'JARVIS_BILLING_API_TOKEN'],
    'sportmedical_diagnostics': ['JARVIS_DIAGNOSTICS_BASE_URL', 'JARVIS_DIAGNOSTICS_API_TOKEN'],
}
values = {**read_env(), **os.environ}
result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'scope': 'Jarvis project environment and current process only',
          'providers': {name: {key: bool(values.get(key) and not values[key].startswith('__')) for key in keys}
                        for name, keys in groups.items()}}
folder = ROOT / 'logs' / ('operator-credentials-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir()
(folder / 'presence.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({**result, 'artifacts': str(folder)}, indent=2))
