"""Bounded incremental chat delivery over ordinary JSON (including Quick Tunnels)."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import socket
import threading
import time

from .projects import ProjectError


class ChatJobs:
    def __init__(self, chat):
        self.chat = chat
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='voice-chat')
        self.lock = threading.RLock()
        self.jobs = {}

    def cleanup(self):
        now = time.monotonic()
        for key, job in list(self.jobs.items()):
            if job['status'] in ('completed', 'failed', 'cancelled') and now - job['updated'] > 900:
                del self.jobs[key]

    def identity(self, identifier, project, thread):
        if not isinstance(identifier, str) or not re.fullmatch(r'[0-9a-f]{32}', identifier):
            raise ProjectError('Invalid chat request identifier.')
        self.chat.conversations.get(project, thread)

    def start(self, request):
        identifier = request.get('request_id')
        project, thread = request.get('project'), request.get('thread')
        self.identity(identifier, project, thread)
        payload = {key: request.get(key) for key in ('project', 'thread', 'message', 'voice_mode')}
        payload['voice_mode'] = request.get('voice_mode', False)
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self.lock:
            self.cleanup()
            old = self.jobs.get(identifier)
            if old:
                if (old['project'], old['thread']) != (project, thread) or old.get('fingerprint') not in (None, fingerprint):
                    raise ProjectError('Chat request identifier belongs to a different turn.', 409)
                return {'id': identifier, 'project': project, 'thread': thread, 'status': old['status']}
            if len(self.jobs) >= 64:
                raise ProjectError('Too many recent voice turns. Try again later.', 429)
            job = {'id': identifier, 'project': project, 'thread': thread, 'status': 'running',
                   'text': '', 'error': None, 'fingerprint': fingerprint, 'updated': time.monotonic(),
                   'cancel': threading.Event(), 'response': None}
            events = self.chat.events(payload, cancelled=job['cancel'], response_ready=lambda response: self.response_ready(job, response))
            # The first event validates the turn and reserves Chat's capacity before 202.
            first = next(events)
            job['route'] = first.get('route', 'agent')
            self.jobs[identifier] = job
            try:
                self.pool.submit(self.run, job, events, first)
            except BaseException:
                events.close()
                del self.jobs[identifier]
                raise
            return {'id': identifier, 'project': project, 'thread': thread, 'status': 'running'}

    def response_ready(self, job, response):
        with self.lock:
            job['response'] = response
            cancelled = job['cancel'].is_set()
        if cancelled:
            self.interrupt(response)

    @staticmethod
    def interrupt(response):
        transport = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
        if transport is not None:
            try:
                transport.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def run(self, job, events, first):
        terminal, error = None, None
        try:
            for event in events:
                if job['cancel'].is_set():
                    break
                with self.lock:
                    if event['type'] == 'delta':
                        job['text'] += event.get('text', '')
                    elif event['type'] == 'done':
                        terminal = event
                    job['updated'] = time.monotonic()
        except Exception as failure:
            error = str(failure)
        finally:
            events.close()  # Chat releases its slot before a terminal state is visible.
            with self.lock:
                job['response'] = None
                job['status'] = 'cancelled' if job['cancel'].is_set() else 'completed' if terminal and not error else 'failed'
                if job['status'] == 'completed': job['text'] = terminal['answer']
                job['error'] = error if job['status'] == 'failed' else None
                if job['status'] == 'failed' and not job['error']:
                    job['error'] = 'The assistant did not complete this turn.'
                job['updated'] = time.monotonic()
                if terminal:
                    job['elapsed_ms'] = terminal.get('elapsed_ms')
                    job['usage'] = terminal.get('usage')

    def get(self, identifier, project, thread, offset=0):
        self.identity(identifier, project, thread)
        try:
            offset = int(offset)
        except (TypeError, ValueError) as error:
            raise ProjectError('Invalid chat text cursor.') from error
        with self.lock:
            self.cleanup()
            job = self.jobs.get(identifier)
            if not job or (job['project'], job['thread']) != (project, thread):
                raise ProjectError('Voice turn is no longer available. Reload conversation history.', 404)
            if not 0 <= offset <= len(job['text']):
                raise ProjectError('Invalid chat text cursor.')
            end = min(len(job['text']), offset + 4096)
            return {'id': identifier, 'project': project, 'thread': thread, 'status': job['status'],
                    'text': job['text'][offset:end], 'next_offset': end, 'has_more': end < len(job['text']),
                    'error': job['error'], 'elapsed_ms': job.get('elapsed_ms'), 'route': job.get('route')}

    def cancel(self, identifier, project, thread):
        self.identity(identifier, project, thread)
        with self.lock:
            self.cleanup()
            job = self.jobs.get(identifier)
            if job and (job['project'], job['thread']) != (project, thread):
                raise ProjectError('Voice turn belongs to another conversation.', 404)
            if not job:
                # Cancellation can overtake a start request. Retain a bounded tombstone.
                if len(self.jobs) >= 64:
                    raise ProjectError('Too many recent voice turns.', 429)
                self.jobs[identifier] = {'id': identifier, 'project': project, 'thread': thread, 'status': 'cancelled',
                                        'text': '', 'error': None, 'updated': time.monotonic(), 'fingerprint': None}
            elif job['status'] == 'running':
                job['cancel'].set()
                self.interrupt(job['response'])
            return {'requested': True}

    def cancel_thread(self, project, thread):
        with self.lock:
            identifiers = [job['id'] for job in self.jobs.values()
                           if job['status'] == 'running' and (job['project'], job['thread']) == (project, thread)]
        for identifier in identifiers:
            self.cancel(identifier, project, thread)
