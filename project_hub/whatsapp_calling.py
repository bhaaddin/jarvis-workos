"""Meta WhatsApp Business Calling API adapter (scaffold, presence-gated).

Covers the official Cloud API surface Matko chose for real WhatsApp voice
calls: webhook verification handshake, signed inbound events (messages and
call signalling), outbound messaging, call-permission requests, and the
call lifecycle (connect / accept / reject / terminate).

What is NOT here yet: WebRTC media termination. Incoming call audio must be
bridged to the local speech stack (Whisper in, Kokoro out) and the operator
brain. That needs a reviewed WebRTC dependency (aiortc is not installed)
plus stable public ingress for Meta's webhooks and media. See
WHATSAPP-CALLING.md. Nothing below claims a live call.

Secrets (access token, app secret, verify token) come from the local
environment only and never appear in errors, logs, or stored payloads.
"""

import hashlib
import hmac
import json
import re
import secrets
import urllib.parse
import urllib.request

GRAPH_VERSION = 'v24.0'
PHONE_RE = re.compile(r'^\+?[0-9]{6,15}$')
CALL_ID_RE = re.compile(r'^[A-Za-z0-9_.-]{1,120}$')
MAX_TEXT = 4096


class WhatsAppError(Exception):
    pass


def configured(env):
    """Presence report: names and booleans only, never secret values."""
    return {'access_token': bool(env.get('WHATSAPP_ACCESS_TOKEN')),
            'phone_number_id': bool(env.get('WHATSAPP_PHONE_NUMBER_ID')),
            'verify_token': bool(env.get('WHATSAPP_VERIFY_TOKEN')),
            'app_secret': bool(env.get('WHATSAPP_APP_SECRET')),
            'ready': all(env.get(key) for key in ('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
                                                  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'))}


def require_configured(env):
    report = configured(env)
    if not report['ready']:
        missing = [key for key in ('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
                                   'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET') if not env.get(key)]
        raise WhatsAppError('WhatsApp calling is not configured (missing: %s). See WHATSAPP-CALLING.md.'
                            % ', '.join(missing))


def verify_handshake(query, verify_token):
    """Meta webhook verification: constant-time token check, challenge echo."""
    if not verify_token:
        raise WhatsAppError('Webhook verification is not configured.')
    if query.get('hub.mode') != ['subscribe']:
        raise WhatsAppError('Unsupported webhook verification request.')
    supplied = (query.get('hub.verify_token') or [''])[0]
    challenge = (query.get('hub.challenge') or [''])[0]
    if not secrets.compare_digest(supplied.encode('utf-8'), verify_token.encode('utf-8')) or not challenge:
        raise WhatsAppError('Webhook verification rejected.')
    if len(challenge) > 500 or not re.fullmatch(r'[A-Za-z0-9_.-]+', challenge):
        raise WhatsAppError('Invalid webhook challenge.')
    return challenge


def verify_signature(raw_body, signature_header, app_secret):
    """X-Hub-Signature-256 check over the exact raw bytes Meta sent."""
    if not app_secret or not signature_header or not signature_header.startswith('sha256='):
        raise WhatsAppError('Missing request signature.')
    expected = hmac.new(app_secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    if not secrets.compare_digest(signature_header[7:].encode('utf-8'), expected.encode('utf-8')):
        raise WhatsAppError('Request signature rejected.')


def parse_event(payload):
    """Project a Cloud API webhook onto inbound messages and call events."""
    messages, calls = [], []
    try:
        entries = payload['entry']
        assert isinstance(entries, list)
    except (KeyError, AssertionError, TypeError):
        raise WhatsAppError('Unsupported webhook payload.') from None
    for entry in entries:
        changes = (entry or {}).get('changes') or []
        for change in changes:
            value = (change or {}).get('value') or {}
            for item in value.get('messages') or []:
                kind = item.get('type')
                if kind == 'text':
                    messages.append({'from': str(item.get('from') or ''), 'id': str(item.get('id') or ''),
                                     'kind': 'text', 'text': str(((item.get('text') or {}).get('body') or ''))[:MAX_TEXT]})
                elif kind == 'audio':
                    messages.append({'from': str(item.get('from') or ''), 'id': str(item.get('id') or ''),
                                     'kind': 'audio', 'media_id': str((item.get('audio') or {}).get('id') or '')})
                elif kind in ('button', 'interactive'):
                    messages.append({'from': str(item.get('from') or ''), 'id': str(item.get('id') or ''),
                                     'kind': 'tap', 'payload': str(item.get('button', {}).get('payload')
                                                                   or (item.get('interactive') or {}))[:200]})
            for call in value.get('calls') or []:
                call_id = str(call.get('id') or '')
                if not CALL_ID_RE.fullmatch(call_id):
                    continue
                calls.append({'id': call_id, 'event': str(call.get('event') or ''),
                              'direction': str(call.get('direction') or ''),
                              'from': str(call.get('from') or ''), 'timestamp': str(call.get('timestamp') or '')})
    return {'messages': messages, 'calls': calls}


def graph_post(env, path, body):
    require_configured(env)
    request = urllib.request.Request('https://graph.facebook.com/%s/%s%s' % (GRAPH_VERSION, env['WHATSAPP_PHONE_NUMBER_ID'], path),
                                     data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json',
                                              'Authorization': 'Bearer ' + env['WHATSAPP_ACCESS_TOKEN']})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response.read(65536))
    except OSError as error:
        raise WhatsAppError('Cloud API request could not complete; token is not printed.') from error


def send_text(env, to, text):
    if not PHONE_RE.fullmatch(to):
        raise WhatsAppError('Use an international phone number.')
    if not text or len(text) > MAX_TEXT:
        raise WhatsAppError('Message text must be 1-4096 characters.')
    return graph_post(env, '/messages', {'messaging_product': 'whatsapp', 'to': to,
                                         'type': 'text', 'text': {'body': text}})


def call_permissions(env, user_phone):
    if not PHONE_RE.fullmatch(user_phone):
        raise WhatsAppError('Use an international phone number.')
    return graph_post(env, '/call_permissions', {'user_phone_number': user_phone})


def request_call_permission(env, user_phone):
    if not PHONE_RE.fullmatch(user_phone):
        raise WhatsAppError('Use an international phone number.')
    return graph_post(env, '/calls', {'action': 'send_call_permission_request', 'to': user_phone})


def manage_call(env, action, call_id, sdp_offer=None):
    if action not in ('connect', 'pre_accept', 'accept', 'reject', 'terminate', 'media_update'):
        raise WhatsAppError('Unsupported call action.')
    if not CALL_ID_RE.fullmatch(call_id):
        raise WhatsAppError('Invalid call identifier.')
    body = {'action': action, 'call_id': call_id}
    if sdp_offer is not None:
        if action != 'connect' or not isinstance(sdp_offer, str) or not 1 <= len(sdp_offer) <= 65536:
            raise WhatsAppError('SDP offers belong on connect only.')
        body['sdp_offer'] = sdp_offer
    return graph_post(env, '/calls', {'messaging_product': 'whatsapp', **body})
