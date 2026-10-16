"""Dedicated JARVIS Telegram bridge to the existing Tasks brain.

Text and voice notes in Telegram reach the same local operator used by
JARVIS Tasks; replies come back to the originating chat. A "Call JARVIS"
button opens the existing authenticated notebook call page, because the
Telegram Bot API has no phone-call primitive.

Power with safety: tools that need approval (mail sending, reservations,
any external action) arrive as Approve/Denied buttons. Nothing consequential
runs from Telegram without your tap. Reads answer directly.

This never touches the Claude supervisor's Telegram bot: separate token,
separate state directory (runtime/telegram), separate allowlist.

Setup (token stays on this PC, never in chat/logs):
  1. In Telegram open @BotFather, /newbot, pick a name ending in bot.
  2. python -B scripts/telegram_bridge.py configure   (hidden prompt)
  3. python -B scripts/telegram_bridge.py watch       (DM the bot, read chat id)
  4. python -B scripts/telegram_bridge.py allow <chat_id>
  5. python -B scripts/telegram_bridge.py run
"""

from __future__ import annotations

import argparse
from http.cookiejar import CookieJar
import csv
import getpass
import io
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from init import ROOT, read_env

STATE = ROOT / 'runtime' / 'telegram'
OUTBOX_FILE = STATE / 'outbox.json'
OUTBOX_MAX = 20
TOKEN_FILE = STATE / '.env'
ALLOW_FILE = STATE / 'allowed_chats.json'
CONV_FILE = STATE / 'conversations.json'
OFFSET_FILE = STATE / 'offset.txt'
PID_FILE = STATE / 'bot.pid'
LOG_FILE = STATE / 'bridge.log'
OPERATOR = 'http://127.0.0.1:18801'
HUB = 'http://127.0.0.1:18791'
ORIGIN = 'http://127.0.0.1:18801'
TOKEN_RE = re.compile(r'^[0-9]{5,20}:[A-Za-z0-9_-]{20,200}$')
CALLBACK_RE = re.compile(r'^(ap|dn):([0-9a-fA-F-]{36})$')
APP_PASSWORD_RE = re.compile(r'^[a-z]{16}$')
MAIL_LOCKOUTS: dict = {}
GMAIL_USER = 'bhaaddinalkhewani@gmail.com'
SYSTEM32 = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32'
MAX_TELEGRAM = 4096
MAX_VOICE_BYTES = 10 * 1024 * 1024
MAX_TEXT = 12000  # operator /api/chat limit
RUN_TIMEOUT = 180
ACTION_TIMEOUT = 150
SAFE_SUFFIX = (' Reply concisely for Telegram (under 2500 characters, no markdown tables).'
               ' Never include passwords, tokens, credentials, or medical details;'
               ' if the request needs protected data, say it needs the secure Tasks app.'
               ' In small talk be warm and affectionate like a loving girlfriend, briefly playful;'
               ' for work stay sharp and professional. If sincerely asked whether you are human,'
               ' say plainly you are JARVIS, an AI.')
ACK_TEXT = 'Working on it…'
TERMINAL_ACTIONS = {'succeeded', 'failed', 'denied', 'expired', 'cancelled', 'uncertain'}
SECRET_KEYS = ('password', 'token', 'secret', 'api_key', 'apikey', 'private_key', 'csrf')

_logger: logging.Logger | None = None
_token_cache: str | None = None


def log(message: str) -> None:
    logger = logging.getLogger('jarvis-telegram')
    if not logger.handlers:
        STATE.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(LOG_FILE, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        logger.addHandler(handler)
        logger.addHandler(logging.StreamHandler(sys.stdout))
        logger.setLevel(logging.INFO)
    logger.info(redact(message, [_token_cache or '']))


# -- pure helpers (unit-tested, no network) -----------------------------------

def chunk_text(text: str, limit: int = MAX_TELEGRAM) -> list[str]:
    if not text.strip():
        return ['(Empty reply — nothing to send.)']
    chunks, current = [], ''
    for paragraph in text.split('\n'):
        candidate = (current + '\n' + paragraph).strip()
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ''
        while len(paragraph) > limit:
            chunks.append(paragraph[:limit])
            paragraph = paragraph[limit:]
        current = paragraph
    if current:
        chunks.append(current)
    return chunks or ['(Empty reply — nothing to send.)']


def is_allowed(chat_id: str, allowed: set[str]) -> bool:
    return bool(chat_id) and chat_id in allowed


def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret and len(secret) >= 8 and secret in text:
            text = text.replace(secret, '[redacted]')
    return text


def extract_message(update: dict) -> dict | None:
    """Project a Telegram message update onto {chat_id, message_id, text, voice_file_id}."""
    message = update.get('message') or update.get('edited_message') or {}
    chat = message.get('chat') or {}
    chat_id = str(chat.get('id') or '')
    if not chat_id or not isinstance(message.get('message_id'), int):
        return None
    text = message.get('text') or message.get('caption') or ''
    voice = message.get('voice') or {}
    audio = message.get('audio') or {}
    file_id = str(voice.get('file_id') or audio.get('file_id') or '')
    if isinstance(text, str) and text.strip():
        return {'chat_id': chat_id, 'message_id': message.get('message_id'),
                'text': text.strip()[:MAX_TEXT], 'voice_file_id': ''}
    if file_id:
        return {'chat_id': chat_id, 'message_id': message.get('message_id'),
                'text': '', 'voice_file_id': file_id}
    return None


def extract_callback(update: dict) -> dict | None:
    """Project a callback_query update onto {callback_id, chat_id, message_id, decision, action_id}."""
    callback = update.get('callback_query') or {}
    match = CALLBACK_RE.fullmatch(str(callback.get('data') or ''))
    message = callback.get('message') or {}
    chat = message.get('chat') or {}
    if not match or not str(callback.get('id') or '') or not str(chat.get('id') or ''):
        return None
    return {'callback_id': str(callback.get('id')), 'chat_id': str(chat.get('id')),
            'message_id': message.get('message_id') if isinstance(message.get('message_id'), int) else None,
            'decision': 'approve' if match.group(1) == 'ap' else 'deny', 'action_id': match.group(2)}


def pending_approvals(run: dict) -> list[dict]:
    """Find approval-required actions in a completed run result."""
    found = []
    result = run.get('result') or {}
    for entry in result.get('toolResults') or []:
        observation = entry.get('observation') or {}
        action = observation.get('action') or {}
        if observation.get('status') == 'approval_required' and isinstance(action.get('id'), str):
            found.append({'tool': str(entry.get('tool') or 'unknown tool'), 'action': action})
    return found


def summarize_input(action: dict, limit: int = 500) -> str:
    """Bounded, secret-scrubbed rendering of a proposed action's input for the owner."""
    try:
        raw = json.dumps(action.get('input') if isinstance(action.get('input'), dict) else {}, ensure_ascii=False)
    except (TypeError, ValueError):
        return '(unreadable input)'
    try:
        scrubbed = json.loads(raw)
        if isinstance(scrubbed, dict):
            for key in list(scrubbed):
                if any(secret in key.lower() for secret in SECRET_KEYS):
                    scrubbed[key] = '[redacted]'
        raw = json.dumps(scrubbed, ensure_ascii=False)
    except (TypeError, ValueError):
        pass
    return raw[:limit] + ('…' if len(raw) > limit else '')


def approval_text(tool: str, action: dict) -> str:
    return ('Needs your approval\nTool: %s\nReason: %s\nInput: %s\n\nApprove to run it, Deny to cancel.'
            % (tool, action.get('reason') or 'confirmation required', summarize_input(action)))


def approval_markup(action_id: str) -> dict:
    return {'inline_keyboard': [[{'text': '✅ Approve', 'callback_data': 'ap:' + action_id},
                                {'text': '❌ Deny', 'callback_data': 'dn:' + action_id}]]}


GREETING_RE = re.compile(r'^(ahoj|cau|čau|zdar|zdravim|zdravím|dobry den|dobrý den|dobre rano|dobré ráno|'
                         r'dobry vecer|dobrý večer|hi|hey|hello|yo|dik|dík|diky|díky|thanks|thank you|ok|fajn|super|'
                         r'čus|čaves|jasně|jasne)\W*$', re.IGNORECASE)
CS_DIACRITICS = re.compile(r'[áčďéěíňóřšťúůýž]')
CS_WORDS = re.compile(r'\b(ahoj|diky|díky|prosim|prosím|dekuji|děkuji|ano|ne|co|jak|kde|kolik|proc|proč|kdy|'
                      r'muzes|můžeš|udelej|udělej|napis|napiš|zkontroluj|zkus|hele|jo|jasně|jasne|super|'
                      r'skvely|skvělý|dobre|dobře|spatne|špatně|cau|čau|zdar|zdravim|zdravím)\b', re.IGNORECASE)


def detect_czech(text: str) -> bool:
    return bool(CS_DIACRITICS.search(text) or CS_WORDS.search(text))


def greeting_reply(text: str) -> str | None:
    """Instant greeting without a model turn. Pure hellos carry no facts."""
    normalized = text.strip().lower()
    if not GREETING_RE.fullmatch(normalized):
        return None
    cs = bool(CS_DIACRITICS.search(normalized)) or normalized.rstrip('!?. ') in (
        'ahoj', 'cau', 'čau', 'zdar', 'zdravim', 'zdravím', 'dik', 'dík', 'prosim', 'prosím',
        'dobry den', 'dobrý den', 'dobre rano', 'dobré ráno', 'dobry vecer', 'dobrý večer',
        'čus', 'čaves', 'jasně', 'jasne', 'super', 'fajn')
    return 'Ahoj! S čím ti dneska pomůžu?' if cs else "Hey! What can I do for you?"


FAST_AREAS = (('Mail', ('mail', 'send_email')), ('Code & projects', ('code', 'projects', 'github', 'document')),
              ('Finance', ('finance',)), ('Czech & travel', ('ares', 'cnb', 'czech', 'transit', 'weather')),
              ('Memory & tasks', ('memory', 'task', 'remind')), ('System', ('computer', 'calculate', 'clock')))


def fast_reply(session: OperatorSession, chat_id: str, text: str) -> str | None:
    """Deterministic fast lane: direct read tools, no model turn. None = use the brain."""
    normalized = text.strip().lower()
    try:
        conversation_id = session.conversation_for(chat_id)
        if re.fullmatch(r'what can you do\??', normalized):
            skills = [s for s in session.skills_list()
                      if isinstance(s, dict) and s.get('state') == 'ready' and str(s.get('id', '')).startswith('jarvis_')]
            buckets: dict = {}
            for skill in skills:
                name = str(skill['id'])[len('jarvis_'):]
                area = next((label for label, keys in FAST_AREAS
                             if any(key in name for key in keys)), 'Other')
                buckets.setdefault(area, []).append(name.replace('_', ' '))
            lines = ['I can do this right now:']
            for area in sorted(buckets):
                lines.append('• %s: %s' % (area, ', '.join(sorted(buckets[area])[:12])))
            return '\n'.join(lines) + '\n\nAsk for anything by name. (fast lane, 0 model turns)'
        running = re.fullmatch(r'is ([a-z0-9 ._-]{1,40}) running\??', normalized)
        if running:
            result = session.invoke_tool(conversation_id, 'jarvis_computer',
                                         {'action': 'processes', 'names': [running.group(1).strip()]})
            if result.get('ok') is True:
                data = ((result.get('result') or {}).get('data') or {})
                programs = data.get('programs') or data.get('processes') or []
                if programs:
                    first = programs[0] if isinstance(programs, list) else programs
                    detail = ' (PID %s)' % first.get('pid') if isinstance(first, dict) and first.get('pid') else ''
                    return 'Yes — %s is running%s. (fast lane)' % (running.group(1).strip(), detail)
                return 'No — %s is not running right now. (fast lane)' % running.group(1).strip()
            return None
        if re.fullmatch(r'(what time is it|what is the time|kolik je hodin)\??', normalized):
            result = session.invoke_tool(conversation_id, 'jarvis_clock', {})
            if result.get('ok') is True:
                data = (result.get('result') or {}).get('data') or {}
                if data.get('localTime') and data.get('localDate'):
                    return 'It is %s on %s (%s). (fast lane)' % (data['localTime'], data['localDate'], data.get('timezone', ''))
            return None
    except Exception as error:
        log('fast lane failed, using the brain: %s' % type(error).__name__)
    return None


def concise(text: str, limit: int = 2200) -> str:
    """Hard cap for chat readability: cut at a sentence boundary, never mid-word."""
    if len(text) <= limit:
        return text
    cut = text.rfind('. ', 0, limit)
    if cut < limit // 2:
        cut = text.rfind('\n', 0, limit)
    head = text[:cut + 1].rstrip() if cut > 0 else text[:limit].rstrip()
    return head + '\n\n(Shortened for Telegram — the full answer is in Tasks.)'


COMMANDS = [{'command': 'start', 'description': 'Greeting, call button and phone keyboard'},
            {'command': 'call', 'description': 'Get the live call link for your phone'},
            {'command': 'new', 'description': 'Start a fresh chat'},
            {'command': 'status', 'description': 'Health, approvals, tasks and call readiness'},
            {'command': 'tasks', 'description': 'List open tasks'},
            {'command': 'auto', 'description': 'List scheduled automations'},
            {'command': 'projects', 'description': 'Code projects and access'},
            {'command': 'army', 'description': 'Specialist sub-agents roster'},
            {'command': 'paswerd', 'description': 'Connect Gmail with an app password'},
            {'command': 'code', 'description': 'List code projects and switch access off/ask'},
            {'command': 'help', 'description': 'What I can do from here'}]


def short_time(value) -> str:
    """Unix seconds to a short local timestamp; never raises on bad input."""
    try:
        stamp = float(value)
        if stamp <= 0:
            return '—'
        return time.strftime('%d.%m %H:%M', time.localtime(stamp))
    except (TypeError, ValueError, OverflowError, OSError):
        return '—'


def progress_note(elapsed: float) -> str | None:
    """Interim edit text for long runs; None means stay silent."""
    if elapsed >= 120:
        return 'Still working on it… (%ds — big job, I will deliver or time out safely)' % int(elapsed)
    if elapsed >= 60:
        return 'Still working on it… (%ds)' % int(elapsed)
    if elapsed >= 30:
        return 'Working on it… (%ds)' % int(elapsed)
    return None


def format_status(health: dict, pending: int, open_tasks: int, model: str, call_ready: bool,
                  call_left: str) -> str:
    rows = ['🏠 JARVIS status',
            '• Operator: %s  • Hub: %s  • Bridge: %s' % (
                '✅' if health.get('operator') else '❌',
                '✅' if health.get('hub') else '❌',
                '✅' if health.get('bridge') else '❌'),
            '• Model: %s' % (model or 'unknown'),
            '• Approvals waiting: %d  • Open tasks: %d' % (pending, open_tasks)]
    rows.append('• Call: %s%s' % ('ready ✅' if call_ready else 'not active 📵',
                                  ' (%s left)' % call_left if call_ready and call_left else ''))
    rows.append('Full detail lives in Tasks. /tasks /auto /projects /army for more.')
    return '\n'.join(rows)


def format_tasks_list(tasks: list) -> str:
    open_tasks = [t for t in tasks if isinstance(t, dict)
                  and str(((t.get('data') or {}) if isinstance(t.get('data'), dict) else {}).get('state', '')) not in (
                      'done', 'completed', 'cancelled')][:10]
    if not open_tasks:
        return 'No open tasks. Send me work and it lands here.'
    lines = ['🗂 Open tasks:']
    for task in open_tasks:
        data = task.get('data') if isinstance(task.get('data'), dict) else {}
        title = str(data.get('title') or task.get('id') or '?')[:120]
        due = data.get('dueAt')
        lines.append('• %s [%s]%s' % (title, data.get('state', '?'),
                                      ' — due %s' % short_time(due) if due else ''))
    if len(open_tasks) == 10:
        lines.append('(first 10 — the rest is in Tasks.)')
    return '\n'.join(lines)


def format_schedules(schedules: list) -> str:
    items = [s for s in schedules if isinstance(s, dict)][:10]
    if not items:
        return 'No automations scheduled. Morning briefings and watchers appear here once configured.'
    lines = ['⏰ Automations:']
    for item in items:
        name = str(item.get('name') or item.get('id') or '?')[:80]
        state = 'ON ✅' if item.get('enabled') else 'OFF'
        nxt = item.get('nextRun') or item.get('next_run')
        lines.append('• %s — %s%s' % (name, state, ', next %s' % short_time(nxt) if nxt else ''))
    return '\n'.join(lines)


def format_army(roster: list) -> str:
    if not roster:
        return ('The specialist roster is not installed yet — the coordinator still handles everything directly. '
                'Ask for it and I will wire the army skill.')
    lines = ['🤖 Specialist army (loaded only when a task needs them):']
    for agent in roster[:20]:
        lines.append('• %s — %s' % (agent.get('name', '?'), agent.get('role', '')))
    lines.append('The coordinator plans, delegates, verifies and reports. Nothing idles in memory.')
    return '\n'.join(lines)


def help_text(call_ready: bool) -> str:
    return ('What I can do from here:\n'
            '• Just talk — tasks, mail, code, research, reminders, calculations.\n'
            '• /status — health, approvals waiting, open tasks, call readiness.\n'
            '• /tasks — open work list.  • /auto — scheduled automations.\n'
            '• /projects — code projects + access. Say "create project X" and I scaffold it for your tap.\n'
            '• /army — specialist sub-agents roster.\n'
            '• /call — one-click call link%s.  • /new — fresh chat.\n'
            '• Voice notes work like text. Approvals arrive as ✅/❌ buttons.\n'
            'Files, medical records and passwords stay in the secure Tasks app.'
            % (' (ready now ✅)' if call_ready else ' (needs the notebook link 📵)'))


ARMY_DIR = ROOT / 'operator' / 'skills' / 'jarvis-army' / 'specialists'


def army_roster() -> list:
    """Parse specialist one-liners from `# Name — role` first lines. Empty when not installed."""
    roster = []
    try:
        files = sorted(ARMY_DIR.glob('*.md'))
    except OSError:
        return []
    for path in files[:30]:
        try:
            first = path.read_text(encoding='utf-8').splitlines()[0].strip()
        except (OSError, IndexError):
            continue
        if first.startswith('#'):
            first = first[1:].strip()
        name, _, role = first.partition('—')
        name, _, role = name.strip(), _, role.strip()
        if not role:
            name, _, role = first.partition('-')
            name, role = name.strip(), role.strip()
        if name:
            roster.append({'name': name[:60], 'role': role[:160]})
    return roster


def call_countdown(call_url_known: bool) -> str:
    try:
        config = json.loads((ROOT / 'runtime' / 'notebook-call.json').read_text(encoding='utf-8'))
        left = float(config.get('expires') or 0) - time.time()
        if left <= 0:
            return ''
        minutes = int(left // 60)
        return '%dh %02dm' % (minutes // 60, minutes % 60) if minutes >= 60 else '%dm' % minutes
    except (OSError, ValueError, TypeError):
        return ''


def code_projects() -> list:
    try:
        projects = json.loads((ROOT / 'operator' / 'config' / 'code.json').read_text(encoding='utf-8'))['projects']
        return projects if isinstance(projects, list) else []
    except (OSError, ValueError, KeyError):
        return []


def set_code_access(project_id: str, access: str) -> bool:
    path = ROOT / 'operator' / 'config' / 'code.json'
    try:
        config = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    for entry in config.get('projects', []):
        if isinstance(entry, dict) and entry.get('id') == project_id:
            entry['access'] = access
            path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
            return True
    return False


def handle_code(chat_id: str, text: str) -> str:
    parts = text.strip().split()
    projects = code_projects()
    if len(parts) == 1:
        if not projects:
            return 'No code projects are connected.'
        return 'Code projects (tap-approve unless off):\n' + '\n'.join(
            '• %s — %s' % (entry.get('id'), entry.get('access', 'ask')) for entry in projects
            if isinstance(entry, dict)) + '\n\n/code <name> off|ask to change one.'
    if len(parts) == 3 and parts[2] in ('off', 'ask'):
        if set_code_access(parts[1], parts[2]):
            return 'Project %s is now %s.' % (parts[1], 'OFF — I will refuse it' if parts[2] == 'off' else 'tap-approve')
        return 'Unknown project. /code lists the connected ones.'
    return 'Usage: /code — list, or /code <name> off|ask.'

PHONE_KEYBOARD = {'keyboard': [[{'text': '📞 Call JARVIS'}],
                               [{'text': '📧 Check mail'}, {'text': '🆕 New chat'}],
                               [{'text': '📊 Status'}, {'text': '🗂 Tasks'}]],
                  'resize_keyboard': True, 'is_persistent': True}

BUTTON_COMMANDS = {'📞 call jarvis': '/call', '📧 check mail': 'check my mail', '🆕 new chat': '/new',
                   '📊 status': '/status', '🗂 tasks': '/tasks'}


def build_welcome(call_url: str | None) -> tuple[str, dict | None]:
    text = ('Hi, I\'m JARVIS. Send a task as text or a voice note and I\'ll work'
            ' on it here. Anything consequential (mail, reservations, external'
            ' actions) asks for your tap first. Approvals, files and protected'
            ' records stay in the secure Tasks app. Commands: /new for a fresh'
            ' chat, /call for the call link.')
    markup = {'inline_keyboard': [[{'text': '📞 Call JARVIS', 'url': call_url}]]} if call_url else None
    return text, markup


def call_url_from_config(config: dict | None) -> str | None:
    if not config:
        return None
    url = str(config.get('url') or '')
    if not url or config.get('operator_enabled') is not True:
        return None
    if float(config.get('expires') or 0) <= time.time():
        return None
    return url.rstrip('/') + '/#operator'


# -- local state ---------------------------------------------------------------

def read_token() -> str | None:
    global _token_cache
    if _token_cache:
        return _token_cache
    try:
        for line in TOKEN_FILE.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('TELEGRAM_BOT_TOKEN='):
                value = line.split('=', 1)[1].strip()
                _token_cache = value or None
                return _token_cache
    except FileNotFoundError:
        return None
    return None


def read_allowed() -> set[str]:
    try:
        return {str(item) for item in json.loads(ALLOW_FILE.read_text(encoding='utf-8'))}
    except (FileNotFoundError, ValueError):
        return set()


def write_allowed(allowed: set[str]) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    ALLOW_FILE.write_text(json.dumps(sorted(allowed), indent=2) + '\n', encoding='utf-8')


def read_conversations() -> dict:
    try:
        return json.loads(CONV_FILE.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        return {}


def write_conversations(value: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    CONV_FILE.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def read_offset() -> int:
    try:
        return int(OFFSET_FILE.read_text(encoding='utf-8').strip())
    except (OSError, ValueError):
        return 0


def write_offset(value: int) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    OFFSET_FILE.write_text(str(int(value)), encoding='utf-8')


def private_write(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.jarvis-tg-', dir=target.parent)
    os.close(handle)
    temporary = Path(temporary)
    try:
        if os.name == 'nt':
            who = subprocess.run([str(SYSTEM32 / 'whoami.exe'), '/user', '/fo', 'csv', '/nh'],
                                 capture_output=True, text=True, errors='replace', timeout=10, check=True)
            sid = next((row[1] for row in csv.reader(io.StringIO(who.stdout))
                        if len(row) > 1 and re.fullmatch(r'S-[0-9-]+', row[1])), None)
            if sid is None:
                raise RuntimeError('Could not resolve the current account for credential-file permissions')
            acl = subprocess.run([str(SYSTEM32 / 'icacls.exe'), str(temporary),
                                  '/inheritance:r', '/grant:r', f'*{sid}:F', '*S-1-5-18:F'],
                                 capture_output=True, timeout=10)
            if acl.returncode:
                raise RuntimeError('Could not protect the token file; token was not saved')
        else:
            temporary.chmod(0o600)
        temporary.write_text(text, encoding='utf-8')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def live_pollers() -> bool:
    try:
        pid = int(PID_FILE.read_text(encoding='utf-8').strip())
    except (OSError, ValueError):
        return False
    if pid <= 1:
        return False
    result = subprocess.run([str(SYSTEM32 / 'tasklist.exe'), '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'],
                            capture_output=True, text=True, errors='replace', timeout=10)
    if result.returncode:
        raise RuntimeError('Could not verify whether a bridge process is already active')
    return any(len(row) > 1 and row[1].strip() == str(pid) for row in csv.reader(io.StringIO(result.stdout)))


# -- Telegram HTTP (token never logged) ----------------------------------------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect; request stopped')


def telegram_call(token: str, method: str, payload: dict | None = None, timeout: int = 30) -> dict:
    if method not in ('getMe', 'getWebhookInfo', 'getUpdates', 'sendMessage', 'editMessageText',
                      'answerCallbackQuery', 'deleteMessage', 'getFile', 'setMyCommands',
                      'getMyCommands') or not TOKEN_RE.fullmatch(token):
        raise ValueError('Unsupported Telegram request')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/' + method, data=data,
                                     headers={'Content-Type': 'application/json'})
    try:
        with opener.open(request, timeout=timeout) as response:
            result = json.loads(response.read(4 * 1024 * 1024))
    except urllib.error.HTTPError as error:
        if error.code == 409:
            raise RuntimeError('Telegram reports 409 Conflict: another poller owns this bot. Stop it first.') from None
        raise RuntimeError('Telegram request failed (HTTP %s); token is not printed' % error.code) from None
    except (OSError, ValueError, urllib.error.URLError):
        raise RuntimeError('Telegram request could not complete; check the connection locally') from None
    if result.get('ok') is not True:
        raise RuntimeError('Telegram returned an unsuccessful response')
    return result['result']


def send_text(token: str, chat_id: str, text: str, markup: dict | None = None) -> int | None:
    """Send chunked text; return the first message id for later edits."""
    first_id: int | None = None
    for chunk in chunk_text(text):
        payload: dict = {'chat_id': chat_id, 'text': chunk}
        if markup is not None:
            payload['reply_markup'] = markup
            markup = None  # buttons on the first chunk only
        message = telegram_call(token, 'sendMessage', payload)
        if first_id is None and isinstance(message.get('message_id'), int):
            first_id = message['message_id']
    return first_id


def edit_text(token: str, chat_id: str, message_id: int, text: str) -> None:
    chunks = chunk_text(text)
    telegram_call(token, 'editMessageText', {'chat_id': chat_id, 'message_id': message_id, 'text': chunks[0]})
    for extra in chunks[1:]:
        send_text(token, chat_id, extra)


def read_outbox() -> list:
    try:
        items = json.loads(OUTBOX_FILE.read_text(encoding='utf-8'))
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    except (OSError, ValueError):
        return []


def write_outbox(items: list) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    OUTBOX_FILE.write_text(json.dumps(items[-OUTBOX_MAX:], ensure_ascii=False) + '\n', encoding='utf-8')


def queue_reply(chat_id: str, text: str) -> None:
    """ Park a reply Telegram swallowed; the next healthy poll delivers it. """
    items = read_outbox()
    items.append({'chat_id': chat_id, 'text': text[:MAX_TELEGRAM], 'tries': 0, 'at': time.time()})
    write_outbox(items)


def flush_outbox(token: str) -> None:
    items = read_outbox()
    if not items:
        return
    kept = []
    for item in items:
        if time.time() - float(item.get('at', 0)) > 3600 or int(item.get('tries', 0)) >= 10:
            continue
        try:
            send_text(token, str(item.get('chat_id', '')), str(item.get('text', '')))
        except Exception:
            item['tries'] = int(item.get('tries', 0)) + 1
            kept.append(item)
    write_outbox(kept)
    if len(kept) < len(items):
        log('outbox flushed %d/%d' % (len(items) - len(kept), len(items)))


def human_error(error: Exception) -> str:
    """No raw exception text ever reaches the owner: cause + next step."""
    text = str(error)
    if 'could not complete' in text or isinstance(error, urllib.error.URLError):
        return ('The Telegram connection dropped mid-task (network outage). Nothing was sent'
                ' or changed — just send your message again.')
    if 'timed out' in text or 'Timeout' in type(error).__name__:
        return ('That took too long, so I stopped it before anything half-done could happen.'
                ' Nothing was sent or changed — try a shorter request.')
    if '401' in text or '403' in text:
        return ('The local service refused the request. Nothing was sent or changed —'
                ' the PC side needs a check, tell Matko.')
    return 'That message failed safely (%s). Nothing was sent or changed.' % type(error).__name__


def delete_message(token: str, chat_id: str, message_id: int) -> None:
    try:
        telegram_call(token, 'deleteMessage', {'chat_id': chat_id, 'message_id': message_id})
    except OSError:
        pass  # deletion is best-effort hygiene, never a failure


def answer_callback(token: str, callback_id: str, text: str = '') -> None:
    payload: dict = {'callback_query_id': callback_id}
    if text:
        payload['text'] = text[:200]
    telegram_call(token, 'answerCallbackQuery', payload)


def send_voice_note(token: str, chat_id: str, wav: bytes) -> None:
    if len(wav) > 8 * 1024 * 1024:
        return  # Telegram voice notes stay small; the text reply already went out
    boundary = 'jarvis-voice-%d' % time.time_ns()
    body = (b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n'
            + chat_id.encode() + b'\r\n--' + boundary.encode()
            + b'\r\nContent-Disposition: form-data; name="voice"; filename="reply.ogg"\r\n'
            + b'Content-Type: audio/ogg\r\n\r\n' + wav + b'\r\n--' + boundary.encode() + b'--\r\n')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendVoice', data=body,
                                     headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    try:
        with opener.open(request, timeout=60) as response:
            json.loads(response.read(65536))
    except OSError:
        pass  # text reply is authoritative; voice is a courtesy


def download_voice(token: str, file_id: str) -> bytes:
    info = telegram_call(token, 'getFile', {'file_id': file_id})
    file_path = str(info.get('file_path') or '')
    if not file_path or '..' in file_path:
        raise RuntimeError('Telegram voice file is unavailable')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open('https://api.telegram.org/file/bot' + token + '/' + file_path, timeout=60) as response:
        return response.read(MAX_VOICE_BYTES + 1)


# -- local operator/hub access ---------------------------------------------------

class OperatorSession:
    def __init__(self) -> None:
        env = read_env()
        password = env.get('JARVIS_OPERATOR_ADMIN_PASSWORD') or ''
        if len(password) < 16:
            raise RuntimeError('Operator admin password is missing in .env; run setup first')
        self._password = password
        self._browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        self._csrf: str | None = None

    def _open(self, url: str, payload: dict | None, csrf: bool = False) -> dict:
        headers = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        if csrf:
            if self._csrf is None:
                self.login()
            headers['X-CSRF-Token'] = self._csrf
        request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(),
                                         headers=headers)
        with self._browser.open(request, timeout=30) as response:
            raw = response.read(8 * 1024 * 1024)
        try:
            return json.loads(raw)
        except ValueError:
            raise RuntimeError('Local service returned an unreadable response') from None

    def login(self) -> None:
        request = urllib.request.Request(OPERATOR + '/api/auth/login',
                                         data=json.dumps({'login': 'matko', 'password': self._password}).encode(),
                                         headers={'Content-Type': 'application/json', 'Origin': ORIGIN})
        with self._browser.open(request, timeout=10) as response:
            self._csrf = json.loads(response.read(65536))['csrf']

    def get(self, path: str) -> dict:
        return self._open(OPERATOR + path, None, csrf=False)

    def post(self, path: str, payload: dict) -> dict:
        try:
            return self._open(OPERATOR + path, payload, csrf=True)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                self.login()
                return self._open(OPERATOR + path, payload, csrf=True)
            raise

    def connect_mail(self, user: str, password: str) -> dict:
        return self.post('/api/connections/mail', {'imapHost': 'imap.gmail.com', 'user': user,
                                                   'password': password, 'smtpHost': 'smtp.gmail.com',
                                                   'smtpPort': 587, 'from': user})

    def invoke_tool(self, conversation_id: str, tool: str, tool_input: dict) -> dict:
        import uuid as _uuid
        return self.post('/api/tools/invoke', {'conversationId': conversation_id,
                                               'requestId': str(_uuid.uuid4()),
                                               'tool': tool, 'input': tool_input})

    def skills_list(self) -> list:
        return self.get('/api/skills').get('skills', [])

    def conversation_for(self, chat_id: str) -> str:
        mapping = read_conversations()
        if mapping.get(chat_id):
            return str(mapping[chat_id])
        created = self.post('/api/conversations', {})
        mapping[chat_id] = str(created['id'])
        write_conversations(mapping)
        return str(created['id'])

    def ask_run(self, conversation_id: str, text: str, delivery: str, on_wait=None) -> dict:
        submitted = self.post('/api/chat', {'conversationId': conversation_id, 'requestId': str(uuid.uuid4()),
                                            'message': text[:MAX_TEXT], 'delivery': delivery, 'waitMs': 20000})
        run_id = str(submitted.get('id') or '')
        deadline = time.monotonic() + RUN_TIMEOUT
        started = time.monotonic()
        run = submitted
        last_note = ''
        while time.monotonic() < deadline and str(run.get('state')) in ('queued', 'running'):
            time.sleep(1)
            run = self.get('/api/runs/' + run_id)
            if on_wait is not None:
                note = progress_note(time.monotonic() - started) or ''
                if note and note != last_note:
                    last_note = note
                    try:
                        on_wait(note)
                    except Exception:
                        pass
        return run

    def ask(self, conversation_id: str, text: str, delivery: str) -> str:
        run = self.ask_run(conversation_id, text, delivery)
        if str(run.get('state')) == 'completed':
            return str((run.get('result') or {}).get('text') or '(The task finished without text.)')
        if str(run.get('state')) in ('queued', 'running'):
            return ('Still working on it — I\'ll keep the recorded task; ask me for its status'
                    ' or check Tasks > Recent executed actions.')
        return 'That task did not complete (%s). Check its recorded state in Tasks before retrying.' % run.get('state')

    def decide(self, action_id: str, decision: str) -> dict:
        current = self.get('/api/actions/' + action_id)
        if str(current.get('state')) != 'awaiting_approval':
            return current
        return self.post('/api/actions/' + action_id + '/decision',
                         {'decision': decision, 'inputHash': current.get('inputHash'),
                          'fingerprint': current.get('fingerprint'), 'eventKey': str(uuid.uuid4())})

    def poll_action(self, action_id: str) -> dict:
        deadline = time.monotonic() + ACTION_TIMEOUT
        current = self.get('/api/actions/' + action_id)
        while time.monotonic() < deadline and str(current.get('state')) not in TERMINAL_ACTIONS:
            time.sleep(2)
            current = self.get('/api/actions/' + action_id)
        return current

    def transcribe(self, audio: bytes) -> str:
        if len(audio) > MAX_VOICE_BYTES + 1 or not audio:
            raise RuntimeError('Voice note is too large; send it as text')
        request = urllib.request.Request(HUB + '/api/voice/transcribe', data=audio,
                                         headers={'Content-Type': 'audio/ogg'})
        with urllib.request.urlopen(request, timeout=120) as response:
            return str(json.loads(response.read(65536)).get('text') or '')

    def speak(self, text: str, voice: str = 'bm_george') -> bytes | None:
        excerpt = text.strip()[:700]
        if not excerpt:
            return None
        request = urllib.request.Request(HUB + '/api/voice/speak',
                                         data=json.dumps({'text': excerpt, 'voice': voice}).encode(),
                                         headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read(8 * 1024 * 1024)
        except OSError:
            return None


def notebook_call_url() -> str | None:
    try:
        config = json.loads((ROOT / 'runtime' / 'notebook-call.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    base = str(config.get('url') or '').rstrip('/')
    if not base or config.get('operator_enabled') is not True:
        return None
    if float(config.get('expires') or 0) <= time.time():
        return None
    secret = config.get('call_secret')
    if not secret:
        return base + '/#operator'
    sys.path.insert(0, str(ROOT))
    from project_hub.remote_call import mint_call_token
    return base + '/?call=' + mint_call_token(secret) + '#operator'


def send_approvals(token: str, chat_id: str, approvals: list[dict]) -> None:
    for item in approvals[:3]:  # bounded: no approval floods
        action = item['action']
        send_text(token, chat_id, approval_text(item['tool'], action), approval_markup(str(action['id'])))


NUDGE_TEXT_AFTER = 5 * 60
NUDGE_VOICE_AFTER = 15 * 60
NUDGE_STATE: dict = {}
NUDGE_CHECK_EVERY = 60
_last_nudge_check = 0.0


def summarize_approval(tool: str, action: dict, limit: int = 160) -> str:
    """One-line approval reminder without secrets or JSON."""
    reason = str(action.get('reason') or 'confirmation required')
    text = '%s — %s' % (tool.replace('jarvis_', '').replace('_', ' '), reason)
    return text[:limit] + ('…' if len(text) > limit else '')


def nudge_due(seen_ago: float, nudged: str) -> str | None:
    """Escalation ladder for an unanswered approval. Pure and unit-tested."""
    if seen_ago >= NUDGE_VOICE_AFTER and nudged != 'voice':
        return 'voice'
    if seen_ago >= NUDGE_TEXT_AFTER and nudged not in ('text', 'voice'):
        return 'text'
    return None


def check_approval_nudges(session: OperatorSession, token: str) -> None:
    """Re-ping unanswered approvals: text after 5 min, voice note after 15 min. Never twice each."""
    global _last_nudge_check
    now = time.monotonic()
    if now - _last_nudge_check < NUDGE_CHECK_EVERY:
        return
    _last_nudge_check = now
    try:
        actions = session.get('/api/actions').get('actions', [])
        allowed = read_allowed()
    except Exception as error:
        log('nudge check failed: %s' % type(error).__name__)
        return
    if not isinstance(actions, list):
        return
    for item in actions:
        if not isinstance(item, dict) or item.get('state') != 'awaiting_approval':
            continue
        action_id = str(item.get('id') or '')
        if not action_id:
            continue
        try:
            expires = float(item.get('expiresAt') or 0) / 1000
        except (TypeError, ValueError):
            expires = 0.0
        if expires and expires - time.time() < 300:
            continue  # dying on its own; no noise
        state = NUDGE_STATE.get(action_id)
        if state is None:
            state = {'seen': now, 'nudged': '', 'chats': sorted(read_allowed())}
            NUDGE_STATE[action_id] = state
            continue
        kind = nudge_due(now - state['seen'], state['nudged'])
        if kind is None:
            continue
        summary = summarize_approval(str(item.get('tool') or 'task'), item)
        delivered = False
        for chat_id in state['chats']:
            if chat_id not in allowed:
                continue
            try:
                if kind == 'voice':
                    wav = session.speak('Matko, still waiting for your tap: %s' % summary[:200])
                    if wav:
                        send_voice_note(token, chat_id, wav)
                send_text(token, chat_id, '⏰ Still waiting for your tap:\n%s\nTap ✅ / ❌ on the proposal above.' % summary)
                delivered = True
            except Exception as error:
                log('nudge failed: %s' % type(error).__name__)
        if delivered:
            state['nudged'] = kind
    for action_id in [key for key in NUDGE_STATE if key not in
                      {str(item.get('id')) for item in actions if isinstance(item, dict)}]:
        NUDGE_STATE.pop(action_id, None)


# -- commands --------------------------------------------------------------------

def cmd_configure(replace: bool) -> int:
    existing = read_token()
    if existing and not replace:
        print('A JARVIS Telegram token is already saved. Re-run with --replace to change it.')
        return 0
    token = getpass.getpass('Paste the BotFather token (hidden, never shown): ').strip()
    if not TOKEN_RE.fullmatch(token):
        print('That does not look like a BotFather token; nothing was saved.')
        return 1
    me = telegram_call(token, 'getMe')
    webhook = telegram_call(token, 'getWebhookInfo')
    if str(webhook.get('url') or ''):
        print('This bot has a webhook set; this bridge uses long polling. Remove the webhook first; nothing was saved.')
        return 1
    private_write(TOKEN_FILE, 'TELEGRAM_BOT_TOKEN=' + token + '\n')
    print('Saved for bot @%s. Now DM it, then run watch / allow.' % me.get('username'))
    return 0


def cmd_status(network: bool) -> int:
    token = read_token()
    report = {'token_saved': token is not None, 'allowed_chats': len(read_allowed()),
              'bridge_running': live_pollers()}
    try:
        report['operator'] = urllib.request.urlopen(OPERATOR + '/health', timeout=3).status == 200
    except OSError:
        report['operator'] = False
    try:
        report['hub'] = urllib.request.urlopen(HUB + '/health', timeout=3).status == 200
    except OSError:
        report['hub'] = False
    url = notebook_call_url()
    report['call_link'] = 'ready' if url else 'missing-or-expired'
    if network:
        if not token:
            print('No token saved.')
            return 1
        try:
            me = telegram_call(token, 'getMe')
            report['bot'] = '@' + str(me.get('username'))
        except RuntimeError as error:
            print(str(error))
            return 1
    print(json.dumps(report, indent=2))
    return 0


def cmd_watch() -> int:
    token = read_token()
    if not token:
        print('No token saved. Run configure first.')
        return 1
    print('Listening for 60s — DM your bot now; chat ids print here only (never stored).')
    seen: set[str] = set()
    deadline = time.monotonic() + 60
    offset = read_offset()
    while time.monotonic() < deadline:
        try:
            result = telegram_call(token, 'getUpdates', {'offset': offset, 'timeout': 20, 'allowed_updates': ['message']},
                                   timeout=30)
        except RuntimeError as error:
            print(str(error))
            return 1
        for update in result if isinstance(result, list) else []:
            offset = max(offset, int(update.get('update_id', 0)) + 1)
            parsed = extract_message(update)
            if parsed and parsed['chat_id'] not in seen:
                seen.add(parsed['chat_id'])
                print('Incoming chat id: %s (kind=%s)' % (parsed['chat_id'], 'voice' if parsed['voice_file_id'] else 'text'))
    write_offset(offset)
    if not seen:
        print('No messages seen. DM the bot and retry.')
        return 1
    print('Pair with: python -B scripts/telegram_bridge.py allow <chat_id>')
    return 0


def cmd_commands() -> int:
    token = read_token()
    if not token:
        print('No token saved. Run configure first.')
        return 1
    telegram_call(token, 'setMyCommands', {'commands': COMMANDS})
    shown = telegram_call(token, 'getMyCommands', {})
    print(json.dumps([item.get('command') for item in shown if isinstance(item, dict)]))
    return 0


def cmd_allow(chat_id: str, remove: bool = False) -> int:
    if not re.fullmatch(r'-?[0-9]{1,20}', chat_id):
        print('Use the numeric chat id shown by watch.')
        return 1
    allowed = read_allowed()
    if remove:
        allowed.discard(chat_id)
    else:
        allowed.add(chat_id)
    write_allowed(allowed)
    print(json.dumps({'allowed_chats': len(allowed)}))
    return 0


def looks_like_app_password(text: str) -> bool:
    """A bare 16-letter code (grouped or not) is a password attempt, not chat."""
    squashed = text.strip().replace(' ', '').lower()
    return bool(APP_PASSWORD_RE.fullmatch(squashed))


def quick_health() -> dict:
    """Best-effort presence check; never raises, never blocks long."""
    health = {'operator': False, 'hub': False, 'bridge': True}
    for name, url in (('operator', OPERATOR + '/health'), ('hub', HUB + '/health')):
        try:
            health[name] = urllib.request.urlopen(url, timeout=3).status == 200
        except OSError:
            health[name] = False
    return health


def handle_status(session: OperatorSession, call_ready: bool) -> str:
    health, pending, open_tasks, model = quick_health(), 0, 0, ''
    try:
        actions = session.get('/api/actions').get('actions', [])
        pending = sum(1 for item in actions if isinstance(item, dict) and item.get('state') == 'awaiting_approval')
    except Exception:
        pass
    try:
        tasks = session.get('/api/tasks').get('tasks', [])
        open_tasks = sum(1 for item in tasks if isinstance(item, dict)
                         and str(((item.get('data') or {}) if isinstance(item.get('data'), dict) else {}).get(
                             'state', '')) not in ('done', 'completed', 'cancelled'))
    except Exception:
        pass
    try:
        skills = session.get('/api/skills')
        model = str((skills.get('model') or {}).get('name', '')) if isinstance(skills, dict) else ''
    except Exception:
        pass
    if not health['operator']:
        return ('⚠️ The task engine is unreachable from Telegram right now. Your chats, files and schedules are '
                'safe on the PC — restart the operator and try again. Full detail in Tasks.')
    return format_status(health, pending, open_tasks, model, call_ready,
                         call_countdown(call_ready) if call_ready else '')


def handle_tasks(session: OperatorSession) -> str:
    try:
        return format_tasks_list(session.get('/api/tasks').get('tasks', []))
    except Exception:
        return 'Could not reach the task list — the operator may be restarting. Try /status.'


def handle_auto(session: OperatorSession) -> str:
    try:
        return format_schedules(session.get('/api/schedules').get('schedules', []))
    except Exception:
        return 'Could not reach the automations — the operator may be restarting. Try /status.'


def handle_text(session: OperatorSession, token: str, chat_id: str, text: str, call_url: str | None,
                message_id: int | None = None) -> None:
    lowered = BUTTON_COMMANDS.get(text.strip().lower(), text.strip().lower())
    if looks_like_app_password(text) and message_id is not None:
        handle_password(session, token, chat_id, message_id, '/paswerd ' + text.strip())
        return
    if lowered in ('/start', '/help'):
        reply, _markup = build_welcome(call_url)
        send_text(token, chat_id, reply, PHONE_KEYBOARD)
        if call_url:
            send_text(token, chat_id, 'Tap 📞 Call JARVIS on your keyboard any time, or open now: ' + call_url)
        return
    if lowered == '/call':
        if call_url:
            stamp = time.strftime('%H:%M', time.localtime())
            send_text(token, chat_id, 'Tap to call — signed in, no password typing (fresh link %s, valid ~8h): %s\n\nIf it ever shows a login or dead page, the tunnel rotated — just send /call again for a new link.' % (stamp, call_url))
        else:
            send_text(token, chat_id, 'No active call link right now — the PC refreshes it automatically every few hours. Wait a few minutes and send /call again. If it stays down, tell me and I will check the PC.')
        return
    if lowered == '/paswerd' or lowered.startswith('/paswerd ') or lowered == '/password' or lowered.startswith('/password '):
        if message_id is None:
            send_text(token, chat_id, 'Usage: /paswerd xxxx xxxx xxxx xxxx (the 16-letter Google app password).')
            return
        handle_password(session, token, chat_id, message_id, text)
        return
    if lowered == '/code' or lowered.startswith('/code '):
        send_text(token, chat_id, handle_code(chat_id, text))
        return
    if lowered == '/new':
        mapping = read_conversations()
        mapping.pop(chat_id, None)
        write_conversations(mapping)
        session.conversation_for(chat_id)
        send_text(token, chat_id, 'Fresh chat started. Earlier context is closed.')
        return
    if lowered in ('/help', '/start help'):
        send_text(token, chat_id, help_text(bool(call_url)))
        return
    if lowered == '/status':
        send_text(token, chat_id, handle_status(session, bool(call_url)))
        return
    if lowered == '/tasks':
        send_text(token, chat_id, handle_tasks(session))
        return
    if lowered == '/auto':
        send_text(token, chat_id, handle_auto(session))
        return
    if lowered == '/projects':
        send_text(token, chat_id, handle_code(chat_id, '/code'))
        return
    if lowered == '/army':
        send_text(token, chat_id, format_army(army_roster()))
        return
    instant = greeting_reply(text)
    if instant is not None:
        log('instant greeting, no model turn')
        send_text(token, chat_id, instant + '\n\n(0s)')
        return
    started_fast = time.monotonic()
    fast = fast_reply(session, chat_id, text)
    if fast is not None:
        log('fast lane reply in %ds' % round(time.monotonic() - started_fast))
        send_text(token, chat_id, concise(fast) + '\n\n(%ds)' % round(time.monotonic() - started_fast))
        return
    try:
        ack_id = send_text(token, chat_id, ACK_TEXT)
    except Exception as error:
        log('ack failed, continuing offline: %s' % type(error).__name__)
        ack_id = None
    started = time.monotonic()
    suffix = SAFE_SUFFIX + (' Odpověz česky.' if detect_czech(text) else '')

    def progress(edit: str) -> None:
        if ack_id is not None:
            try:
                edit_text(token, chat_id, ack_id, edit)
            except Exception:
                pass

    try:
        run = session.ask_run(session.conversation_for(chat_id), text + suffix, 'text', on_wait=progress)
        elapsed = time.monotonic() - started
        log('text reply in %ds' % round(elapsed))
        if str(run.get('state')) == 'completed':
            final = '%s\n\n(took %ds)' % (concise(str((run.get('result') or {}).get('text') or '(empty)')), round(elapsed))
        elif str(run.get('state')) in ('queued', 'running'):
            final = 'Still working on it — check Tasks > Recent executed actions. (took %ds so far)' % round(elapsed)
        else:
            final = 'That task did not complete (%s). Check its recorded state in Tasks.' % run.get('state')
        try:
            if ack_id is not None:
                edit_text(token, chat_id, ack_id, final)
            else:
                send_text(token, chat_id, final)
        except Exception as nested:
            log('final reply failed, queued: %s' % type(nested).__name__)
            queue_reply(chat_id, final)
        try:
            send_approvals(token, chat_id, pending_approvals(run))
        except Exception as nested:
            log('approval buttons failed: %s' % type(nested).__name__)
    except Exception as error:
        log('text task failed: %s: %s' % (type(error).__name__, error))
        final = human_error(error)
        delivered = False
        try:
            if ack_id is not None:
                edit_text(token, chat_id, ack_id, final)
            else:
                send_text(token, chat_id, final)
            delivered = True
        except Exception as nested:
            log('fallback reply failed: %s' % type(nested).__name__)
        if not delivered:
            queue_reply(chat_id, final)
        return


def handle_password(session: OperatorSession, token: str, chat_id: str, message_id: int, text: str) -> None:
    """Connect Gmail from a Google app password sent in chat. The secret is
    never logged, never echoed, and the incoming message is deleted."""
    parts = text.strip().split(None, 1)
    code = parts[1].replace(' ', '').lower() if len(parts) > 1 else ''
    locked_until = MAIL_LOCKOUTS.get(chat_id, (0, 0))[1]
    if time.monotonic() < locked_until:
        delete_message(token, chat_id, message_id)
        send_text(token, chat_id, 'Too many failed attempts — wait 10 minutes, then send a fresh code.')
        return
    if not APP_PASSWORD_RE.fullmatch(code):
        delete_message(token, chat_id, message_id)
        log('mail connect rejected: bad format')
        send_text(token, chat_id, 'Usage: /paswerd xxxx xxxx xxxx xxxx (the 16-letter Google app password).')
        return
    try:
        result = session.connect_mail(GMAIL_USER, code)
    except Exception as error:
        fails, _ = MAIL_LOCKOUTS.get(chat_id, (0, 0))
        fails += 1
        if fails >= 3:
            MAIL_LOCKOUTS[chat_id] = (0, time.monotonic() + 600)
        else:
            MAIL_LOCKOUTS[chat_id] = (fails, 0)
        log('mail connect failed: %s' % type(error).__name__)
        delete_message(token, chat_id, message_id)
        send_text(token, chat_id, 'That code did not connect. Generate a fresh app password and try again.')
        return
    MAIL_LOCKOUTS.pop(chat_id, None)
    log('mail connected for configured Gmail user')
    delete_message(token, chat_id, message_id)
    user = result.get('user') if isinstance(result, dict) else None
    send_text(token, chat_id, 'Mail connected%s. Your code message was deleted.%s'
              % (' as ' + user if user else '',
                 ' Sending is on.' if isinstance(result, dict) and result.get('sendingConfigured')
                 else ' Sending is off — SMTP was not configured.'))


def handle_voice(session: OperatorSession, token: str, chat_id: str, file_id: str) -> None:
    try:
        ack_id = send_text(token, chat_id, ACK_TEXT)
    except Exception as error:
        log('voice ack failed, skipping message: %s' % type(error).__name__)
        return
    started = time.monotonic()

    def finish(text: str) -> None:
        try:
            if ack_id is not None:
                edit_text(token, chat_id, ack_id, text)
            else:
                send_text(token, chat_id, text)
        except Exception as error:
            log('voice reply failed, queued: %s' % type(error).__name__)
            queue_reply(chat_id, text)

    try:
        transcript = session.transcribe(download_voice(token, file_id)).strip()
    except RuntimeError as error:
        finish(str(error))
        return
    if not transcript:
        finish('I heard silence — try again or type it.')
        return
    instant = greeting_reply(transcript)
    if instant is not None:
        log('instant voice greeting, synthesis only')
        finish(instant + '\n\n(0s)')
        wav = session.speak(instant, 'jirka' if detect_czech(transcript) else 'bm_george')
        if wav:
            send_voice_note(token, chat_id, wav)
        return
    try:
        suffix = SAFE_SUFFIX + (' Odpověz česky.' if detect_czech(transcript) else '')

        def voice_progress(edit: str) -> None:
            if ack_id is not None:
                try:
                    edit_text(token, chat_id, ack_id, 'Heard: "%s"\n\n%s' % (transcript[:200], edit))
                except Exception:
                    pass

        run = session.ask_run(session.conversation_for(chat_id), transcript + suffix, 'voice',
                              on_wait=voice_progress)
        elapsed = time.monotonic() - started
        log('voice reply in %ds' % round(elapsed))
        if str(run.get('state')) == 'completed':
            reply = str((run.get('result') or {}).get('text') or '(empty)')
        else:
            reply = 'That voice task did not complete (%s).' % run.get('state')
        finish('Heard: "%s"\n\n%s\n\n(took %ds)' % (transcript[:500], concise(reply), round(elapsed)))
        if str(run.get('state')) == 'completed':
            wav = session.speak(reply, 'jirka' if detect_czech(transcript) else 'bm_george')
            if wav:
                send_voice_note(token, chat_id, wav)
        send_approvals(token, chat_id, pending_approvals(run))
    except Exception as error:
        log('voice task failed: %s: %s' % (type(error).__name__, error))
        finish(human_error(error))


def handle_callback(session: OperatorSession, token: str, callback: dict) -> None:
    answer_callback(token, callback['callback_id'])
    try:
        decided = session.decide(callback['action_id'], callback['decision'])
    except (OSError, ValueError, urllib.error.URLError, KeyError) as error:
        log('approval decision failed: %s: %s' % (type(error).__name__, error))
        answer_callback(token, callback['callback_id'], 'Decision failed safely; check Tasks.')
        return
    state = str(decided.get('state'))
    if state != 'awaiting_approval' and callback['decision'] == 'approve' and state in ('approved', 'queued', 'running'):
        final = session.poll_action(callback['action_id'])
        state = str(final.get('state'))
        decided = final
    outcome = {'succeeded': 'Done ✅', 'failed': 'It failed — check Tasks for the recorded error.',
               'denied': 'Denied — nothing ran.', 'expired': 'Approval expired — send the request again.',
               'cancelled': 'Cancelled.', 'uncertain': 'Uncertain outcome — check Tasks before retrying.'}.get(state, state)
    text = '%s\nTool: %s' % (outcome, decided.get('tool') or 'unknown')
    if callback['message_id'] is not None:
        try:
            edit_text(token, callback['chat_id'], callback['message_id'], text)
            return
        except OSError:
            pass
    send_text(token, callback['chat_id'], text)


def cmd_say(text: str) -> int:
    """Proactive owner ping (Flow B lite): scheduler/watchers can message the owner.
    Text only, chunked, allowed chats only. Voice-call equivalent until telephony exists."""
    message = text.strip()[:3000]
    if not message:
        print('Usage: telegram_bridge.py say "text for the owner".')
        return 1
    token, allowed = read_token(), read_allowed()
    if not token:
        print('No token saved. Run configure first.')
        return 1
    if not allowed:
        print('No allowed chats. Run watch, then allow <chat_id>.')
        return 1
    delivered = 0
    for chat_id in sorted(allowed):
        try:
            send_text(token, chat_id, message)
            delivered += 1
        except Exception as error:
            log('proactive send failed: %s' % type(error).__name__)
    print(json.dumps({'chats': len(allowed), 'delivered': delivered}))
    return 0 if delivered else 1


def cmd_stop() -> int:
    """Stop bridge pollers by command line, never by a possibly stale PID file."""
    found = subprocess.run(['wmic', 'process', 'where', "name='python.exe'", 'get',
                            'ProcessId,CommandLine', '/format:csv'],
                           capture_output=True, text=True, errors='replace', timeout=30)
    stopped = 0
    for row in csv.reader(io.StringIO(found.stdout)):
        pids = [field.strip() for field in row if field.strip().isdigit()]
        if not any('telegram_bridge.py run' in field for field in row):
            continue
        for pid in pids:
            if int(pid) == os.getpid():
                continue
            halted = subprocess.run(['taskkill', '/PID', pid, '/F'],
                                    capture_output=True, text=True, errors='replace', timeout=30)
            if halted.returncode == 0:
                stopped += 1
    PID_FILE.unlink(missing_ok=True)
    print(json.dumps({'stopped': stopped}))
    return 0


def cmd_run() -> int:
    token = read_token()
    if not token:
        print('No token saved. Run configure first.')
        return 1
    allowed = read_allowed()
    if not allowed:
        print('No allowed chats. Run watch, then allow <chat_id>.')
        return 1
    if live_pollers():
        print('A bridge poller is already running for this bot; not starting another.')
        return 1
    session = OperatorSession()
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()), encoding='utf-8')
    offset = read_offset()
    log('bridge started for %d chat(s)' % len(allowed))
    print('JARVIS Telegram bridge running for %d chat(s). Ctrl+C stops it.' % len(allowed))
    try:
        while True:
            try:
                updates = telegram_call(token, 'getUpdates', {'offset': offset, 'timeout': 5,
                                                              'allowed_updates': ['message', 'callback_query']},
                                        timeout=20)
            except RuntimeError as error:
                log('poll: %s' % error)
                time.sleep(5)
                continue
            if not isinstance(updates, list):
                continue
            try:
                flush_outbox(token)
            except Exception as error:
                log('outbox flush failed: %s' % type(error).__name__)
            try:
                check_approval_nudges(session, token)
            except Exception as error:
                log('nudge check failed: %s' % type(error).__name__)
            call_url = notebook_call_url()
            allowed = read_allowed()
            for update in updates:
                offset = max(offset, int(update.get('update_id', 0)) + 1)
                write_offset(offset)
                callback = extract_callback(update)
                if callback:
                    if not is_allowed(callback['chat_id'], allowed):
                        continue
                    log('callback %s for action %s' % (callback['decision'], callback['action_id']))
                    try:
                        handle_callback(session, token, callback)
                    except Exception as error:
                        log('callback failed: %s: %s' % (type(error).__name__, error))
                    continue
                parsed = extract_message(update)
                if not parsed:
                    continue
                if not is_allowed(parsed['chat_id'], allowed):
                    continue
                log('message from %s chars=%d voice=%s' % ('paired chat', len(parsed['text']),
                                                           bool(parsed['voice_file_id'])))
                try:
                    if parsed['voice_file_id']:
                        handle_voice(session, token, parsed['chat_id'], parsed['voice_file_id'])
                    else:
                        handle_text(session, token, parsed['chat_id'], parsed['text'], call_url,
                                    parsed['message_id'])
                except Exception as error:  # one bad message never kills the poller
                    log('message failed: %s: %s' % (type(error).__name__, error))
                    try:
                        chat = parsed.get('chat_id') if isinstance(parsed, dict) else None
                        if chat:
                            send_text(token, chat, human_error(error))
                    except Exception as nested:
                        log('fallback reply failed: %s' % type(nested).__name__)
    except KeyboardInterrupt:
        pass
    finally:
        PID_FILE.unlink(missing_ok=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    configure = commands.add_parser('configure')
    configure.add_argument('--replace', action='store_true')
    status = commands.add_parser('status')
    status.add_argument('--network', action='store_true')
    commands.add_parser('watch')
    commands.add_parser('commands')
    commands.add_parser('stop')
    allow = commands.add_parser('allow')
    allow.add_argument('chat_id')
    allow.add_argument('--remove', action='store_true')
    commands.add_parser('run')
    say = commands.add_parser('say')
    say.add_argument('text')
    args = parser.parse_args()
    try:
        if args.command == 'configure':
            return cmd_configure(args.replace)
        if args.command == 'status':
            return cmd_status(args.network)
        if args.command == 'watch':
            return cmd_watch()
        if args.command == 'commands':
            return cmd_commands()
        if args.command == 'stop':
            return cmd_stop()
        if args.command == 'allow':
            return cmd_allow(args.chat_id, args.remove)
        if args.command == 'say':
            return cmd_say(args.text)
        return cmd_run()
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        log('command failed: %s' % error)
        print(redact(str(error), [read_token() or '']))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
