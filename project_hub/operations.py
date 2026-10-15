"""Bounded user operations and their durable execution receipts."""

from concurrent.futures import ThreadPoolExecutor
import json
import threading
import time
import uuid

from .projects import ProjectError


class Operations:
    def __init__(self, projects):
        self.projects = projects
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='jarvis-operation')
        self.lock = threading.Lock()
        self.active = set()
        self.failures = {}
        with projects.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, kind TEXT, title TEXT, status TEXT, created REAL, updated REAL, result TEXT)')
            db.execute("UPDATE operations SET status='interrupted',updated=? WHERE status IN ('queued','running')", (time.time(),))

    def update(self, identifier, status, result):
        with self.projects.connection() as db:
            db.execute('UPDATE operations SET status=?,updated=?,result=? WHERE id=?',
                       (status, time.time(), json.dumps(result, ensure_ascii=False), identifier))

    def get(self, identifier):
        with self.projects.connection() as db:
            row = db.execute('SELECT id,kind,title,status,created,updated,result FROM operations WHERE id=?', (identifier,)).fetchone()
        if not row:
            raise ProjectError('Operation not found.', 404)
        result = dict(zip(('id', 'kind', 'title', 'status', 'created', 'updated'), row[:6]), result=json.loads(row[6]))
        if identifier in self.failures:
            result.update(status='failed', result=self.failures[identifier])
        return result

    def list(self, limit=100):
        with self.projects.connection() as db:
            ids = [row[0] for row in db.execute('SELECT id FROM operations ORDER BY created DESC LIMIT ?', (limit,))]
        return [self.get(identifier) for identifier in ids]

    def count(self):
        with self.lock:
            return len(self.active)

    def start(self, kind, title, action, key=None):
        key = key or kind
        with self.lock:
            if key in self.active:
                raise ProjectError('That operation is already running.', 409)
            if len(self.active) >= 4:
                raise ProjectError('Four operations are already queued or running.', 429)
            self.active.add(key)
        identifier = uuid.uuid4().hex
        now = time.time()
        inserted = False
        try:
            with self.projects.connection() as db:
                db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,?)', (identifier, kind, title, 'queued', now, now, '{}'))
            inserted = True
            self.pool.submit(self.execute, identifier, key, action)
        except Exception as error:
            if inserted:
                self.failures[identifier] = {'error': str(error)}
                try:
                    self.update(identifier, 'failed', self.failures[identifier])
                except Exception as persistence_error:
                    print(f'Could not persist scheduling failure for {identifier}: {persistence_error}', flush=True)
            with self.lock:
                self.active.discard(key)
            raise
        return self.get(identifier)

    def execute(self, identifier, key, action):
        try:
            self.update(identifier, 'running', {})
            result = action(lambda progress: self.update(identifier, 'running', progress))
            self.update(identifier, 'completed', result)
        except Exception as error:
            self.failures[identifier] = {'error': str(error)}
            try:
                self.update(identifier, 'failed', {'error': str(error)})
            except Exception as persistence_error:
                print(f'Operation {identifier} failed: {error}; receipt error: {persistence_error}', flush=True)
        finally:
            with self.lock:
                self.active.discard(key)
