"""Conversation metadata and a projection of OpenClaw's authoritative history."""

import hashlib
import json
import re
import time
import uuid

from .projects import ProjectError
from .quick_replies import quick_record


def session_key(project, thread):
    # Earlier browser clients always used canonical UUIDs. Preserve those sessions.
    try:
        if str(uuid.UUID(thread)) == thread:
            return f'agent:main:project-{project}-{thread}'
    except ValueError:
        pass
    digest = hashlib.sha256(json.dumps([project, thread]).encode()).hexdigest()[:40]
    return 'agent:main:hub-' + digest


def project_signature(project):
    return hashlib.sha256(json.dumps(project['roots'], sort_keys=True).encode()).hexdigest()


def text_parts(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(part['text'] for part in content if isinstance(part, dict)
                         and part.get('type') == 'text' and isinstance(part.get('text'), str))
    return ''


def project_history(data):
    if not isinstance(data, dict) or not isinstance(data.get('messages'), list):
        raise ProjectError('The assistant returned an invalid conversation history.', 502)
    messages = []
    for index, item in enumerate(data['messages']):
        if not isinstance(item, dict) or item.get('role') not in ('user', 'assistant'):
            continue
        record = quick_record(item)
        if record:
            for role, field in (('user', 'question'), ('assistant', 'answer')):
                messages.append({'id': 'quick-' + record['id'] + '-' + role, 'role': role,
                                 'text': record[field], 'timestamp': item.get('timestamp'), 'error': False})
            continue
        content = item.get('content')
        has_tools = isinstance(content, list) and any(isinstance(part, dict) and part.get('type') == 'toolCall' for part in content)
        if item['role'] == 'assistant' and (has_tools or item.get('stopReason') == 'toolUse'):
            continue
        text = text_parts(content)
        if item['role'] == 'user' and text.startswith('Active project: ') and '\n\nUser request:\n' in text:
            text = text.partition('\n\nUser request:\n')[2]
        if not text.strip():
            continue
        internal = item.get('__openclaw') if isinstance(item.get('__openclaw'), dict) else {}
        messages.append({'id': internal.get('id') or f'history-{index}', 'role': item['role'],
                         'text': text, 'timestamp': item.get('timestamp'), 'error': item.get('stopReason') == 'error'})
    info = data.get('sessionInfo') if isinstance(data.get('sessionInfo'), dict) else {}
    return {'messages': messages, 'active': info.get('hasActiveRun') is True,
            'has_more': data.get('hasMore') is True, 'next_offset': data.get('nextOffset'),
            'total_messages': data.get('totalMessages', len(messages))}


class Conversations:
    def __init__(self, projects, gateway):
        self.projects, self.gateway = projects, gateway
        with projects.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS conversations (project TEXT, thread TEXT, session TEXT UNIQUE, signature TEXT, title TEXT, created REAL, updated REAL, started INTEGER NOT NULL DEFAULT 0, quick_context INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project,thread))')
            if 'started' not in {row[1] for row in db.execute('PRAGMA table_info(conversations)')}:
                db.execute('ALTER TABLE conversations ADD COLUMN started INTEGER NOT NULL DEFAULT 1')
            if 'quick_context' not in {row[1] for row in db.execute('PRAGMA table_info(conversations)')}:
                db.execute('ALTER TABLE conversations ADD COLUMN quick_context INTEGER NOT NULL DEFAULT 0')

    def ensure(self, project_id, thread=None, title='New conversation'):
        project = self.projects.get(project_id)
        adopted = thread is not None
        thread = thread or str(uuid.uuid4())
        if not isinstance(thread, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,64}', thread):
            raise ProjectError('A valid conversation thread is required.')
        signature = project_signature(project)
        with self.projects.connection() as db:
            row = db.execute('SELECT signature FROM conversations WHERE project=? AND thread=?', (project_id, thread)).fetchone()
            if row and row[0] != signature:
                raise ProjectError('This conversation belongs to an earlier project connection. Start a new conversation.', 409)
            now = time.time()
            db.execute('INSERT OR IGNORE INTO conversations (project,thread,session,signature,title,created,updated,started) VALUES (?,?,?,?,?,?,?,?)',
                       (project_id, thread, session_key(project_id, thread), signature, title[:120], now, now, int(adopted)))
        return self.get(project_id, thread)

    def get(self, project_id, thread):
        project = self.projects.get(project_id)
        with self.projects.connection() as db:
            row = db.execute('SELECT project,thread,session,title,created,updated,signature,started,quick_context FROM conversations WHERE project=? AND thread=?', (project_id, thread)).fetchone()
        if not row or row[6] != project_signature(project):
            raise ProjectError('Conversation not found for this project.', 404)
        return dict(zip(('project', 'thread', 'session', 'title', 'created', 'updated'), row[:6]), started=bool(row[7]), quick_context=bool(row[8]))

    def list(self, project_id):
        project = self.projects.get(project_id)
        with self.projects.connection() as db:
            rows = db.execute('SELECT project,thread,session,title,created,updated FROM conversations WHERE project=? AND signature=? ORDER BY updated DESC LIMIT 100', (project_id, project_signature(project))).fetchall()
        return [dict(zip(('project', 'thread', 'session', 'title', 'created', 'updated'), row)) for row in rows]

    def touch(self, project_id, thread, message, quick=False):
        self.ensure(project_id, thread, message.replace('\n', ' ')[:100])
        with self.projects.connection() as db:
            db.execute("UPDATE conversations SET title=CASE WHEN title='New conversation' THEN ? ELSE title END,updated=?,started=1,quick_context=MAX(quick_context,?) WHERE project=? AND thread=?",
                       (message.replace('\n', ' ')[:100], time.time(), int(quick), project_id, thread))

    def history(self, project_id, thread, offset=0):
        conversation = self.get(project_id, thread)
        try:
            offset = int(offset)
        except (TypeError, ValueError) as error:
            raise ProjectError('History offset must be an integer.') from error
        if offset < 0 or offset > 100000:
            raise ProjectError('Invalid history offset.')
        if not conversation['started']:
            return {'messages': [], 'active': False, 'has_more': False, 'conversation': conversation, 'total_messages': 0}
        data = self.gateway.rpc('chat.history', {'sessionKey': conversation['session'], 'limit': 80, 'offset': offset})
        return {**project_history(data), 'conversation': conversation}

    def abort(self, project_id, thread):
        conversation = self.get(project_id, thread)
        result = self.gateway.rpc('chat.abort', {'sessionKey': conversation['session']})
        return {'requested': True, 'result': result}
