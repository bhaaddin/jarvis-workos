"""Reuse the reviewed snapshot worker for explicit review/proposal jobs."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import signal
import uuid

from .projects import INSTRUCTIONS, ProjectError, git_root, read_text, relative_name

NATIVE_OPENCODE = Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming')) / 'npm/node_modules/opencode-ai/bin/opencode.exe'
AUTOMATION = Path.home() / '.claude/automation/sm_opencode.py'
REQUESTS = Path.home() / '.claude/automation-requests/jarvis-hub'


class Reviews:
    def __init__(self, projects):
        self.projects = projects
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='jarvis-review')
        self.slots = threading.BoundedSemaphore(4)
        self.failures = {}
        with projects.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project TEXT, status TEXT, result TEXT)')
            db.execute("UPDATE reviews SET status='interrupted', result=? WHERE status IN ('queued','running')",
                       (json.dumps({'error': 'The host restarted. This job was not automatically repeated.'}),))

    def update(self, job_id, state, result):
        with self.projects.connection() as db:
            db.execute('UPDATE reviews SET status=?,result=? WHERE id=?', (state, json.dumps(result), job_id))

    def get(self, job_id):
        with self.projects.connection() as db:
            row = db.execute('SELECT id,project,status,result FROM reviews WHERE id=?', (job_id,)).fetchone()
        if not row:
            raise ProjectError('Review job not found.', 404)
        if job_id in self.failures:
            return {'id': row[0], 'project': row[1], 'status': 'failed', **self.failures[job_id]}
        return {'id': row[0], 'project': row[1], 'status': row[2], **json.loads(row[3])}

    def active_count(self):
        with self.projects.connection() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM reviews WHERE status IN ('queued','running')")]
        return sum(job_id not in self.failures for job_id in ids)

    def latest(self, project):
        self.projects.get(project)
        with self.projects.connection() as db:
            identifiers = [row[0] for row in db.execute('SELECT id FROM reviews WHERE project=? ORDER BY rowid DESC LIMIT 10', (project,))]
        return [self.get(identifier) for identifier in identifiers]

    def start(self, request):
        if not AUTOMATION.is_file():
            raise ProjectError('The prepared OpenCode snapshot helper is not installed on this machine.', 503)
        project_id, root_id = request.get('project'), request.get('root')
        root = self.projects.root(project_id, root_id)
        if git_root(root) != root:
            raise ProjectError('Strong review requires the root of a Git worktree. Ordinary folders still support local chat.')
        task, files = request.get('task', ''), request.get('files', [])
        mode = request.get('mode', 'review')
        if mode not in ('review', 'patch') or not isinstance(task, str) or not 5 <= len(task) <= 8000:
            raise ProjectError('Choose review or patch proposal and describe the task.')
        if not isinstance(files, list) or not 1 <= len(files) <= 4:
            raise ProjectError('Select one to four source files for this focused task.')
        specs, remaining = [], 42000
        source_paths = [relative_name(path) for path in files]
        instruction_paths = []
        for path in source_paths:
            for instruction in self.projects.instructions(root, path):
                if instruction['truncated'] or instruction.get('budget_exhausted'):
                    raise ProjectError('Project instructions exceed the snapshot budget. Use the native coding session for this task.')
                instruction_paths.append(instruction['path'])
        candidates = list(dict.fromkeys([*instruction_paths, *source_paths]))
        if len(candidates) > 8:
            raise ProjectError('This selection needs more than eight source/instruction files. Select fewer source files.')
        for path in dict.fromkeys(candidates):
            text = read_text(root, path, check_ignore=path not in INSTRUCTIONS)
            selected, byte_count = [], 0
            is_instruction = path in instruction_paths
            if is_instruction and len(text.encode('utf-8')) > remaining:
                raise ProjectError('The complete project instructions exceed the snapshot budget.')
            source_lines = text.splitlines(keepends=True)
            for line in (source_lines if is_instruction else source_lines[:180]):
                length = len(line.encode('utf-8'))
                if byte_count + length > (remaining if is_instruction else min(12000, remaining)):
                    break
                selected.append(line)
                byte_count += length
            if not selected:
                raise ProjectError('The selected files exceed the snapshot budget. Choose smaller files.')
            specs.append({'path': path, 'start': 1, 'end': len(selected)})
            remaining -= byte_count
        job_id = uuid.uuid4().hex
        payload = {'tasks': [{
            'id': 'project-task', 'repo': str(root), 'profile': mode,
            'task': ('Respect the supplied project instructions and ownership. This is a bounded snapshot task. '
                     'Do not delegate. Return evidence and missing context. '
                     'A patch is a proposal; no code has been applied or tested.\n\n' + task),
            'files': specs,
        }]}
        if not self.slots.acquire(blocking=False):
            raise ProjectError('Four review jobs are already queued or running. Wait for one to finish.', 429)
        try:
            REQUESTS.mkdir(parents=True, exist_ok=True)
            request_path = REQUESTS / f'{job_id}.json'
            request_path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
            with self.projects.connection() as db:
                db.execute('INSERT INTO reviews VALUES (?,?,?,?)',
                           (job_id, project_id, 'queued', json.dumps({'files': specs, 'mode': mode})))
            self.pool.submit(self.execute, job_id, request_path, specs, mode)
        except Exception:
            self.slots.release()
            raise
        return self.get(job_id)

    def execute(self, job_id, request_path, specs, mode):
        metadata = {'files': specs, 'mode': mode}
        try:
            self.update(job_id, 'running', metadata)
            command = [sys.executable, '-B', str(AUTOMATION), '--request', str(request_path),
                       '--max-workers', '1', '--timeout', '180']
            with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, encoding='utf-8', errors='replace', shell=False,
                                  start_new_session=os.name != 'nt') as process:
                try:
                    stdout, stderr = process.communicate(timeout=360)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                       capture_output=True, timeout=15, check=False)
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.communicate(timeout=15)
                    raise
                exit_code = process.returncode
            report = json.loads(stdout)
            results = report.get('results') if isinstance(report, dict) else None
            if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
                raise ValueError('The coding helper returned an invalid result envelope.')
            result = results[0]
            ok = exit_code == 0 and result.get('status') == 'response_received' and result.get('exit_code') == 0
            answer = result.get('answer', '')
            if not isinstance(answer, str):
                raise ValueError('The coding helper returned a non-text answer.')
            artifact = Path(report['artifacts']) if report.get('artifacts') else None
            if artifact:
                response = artifact / 'project-task/response.txt'
                if response.is_file() and response.stat().st_size < 1024 * 1024:
                    answer = response.read_text(encoding='utf-8')
            self.update(job_id, 'completed' if ok else 'failed', {
                **metadata, 'answer': answer, 'exit_code': exit_code,
                'errors': result.get('errors', []), 'artifacts': str(artifact) if artifact else None,
                'applied': False,
            })
        except Exception as error:
            failure = {**metadata, 'error': str(error), 'applied': False}
            self.failures[job_id] = failure
            try:
                self.update(job_id, 'failed', failure)
            except Exception as persistence_error:
                print(f'Review {job_id} failed; could not persist failure: {persistence_error}', flush=True)
        finally:
            self.slots.release()


def launch_coding(root):
    if os.name != 'nt' or not NATIVE_OPENCODE.is_file():
        raise ProjectError('Native OpenCode is not installed at the expected Windows location.', 503)
    process = subprocess.Popen([str(NATIVE_OPENCODE), str(root)], cwd=root,
                               creationflags=subprocess.CREATE_NEW_CONSOLE, shell=False)
    return {'launched': True, 'pid': process.pid, 'folder': str(root), 'engine': 'OpenCode'}
