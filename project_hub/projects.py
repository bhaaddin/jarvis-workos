"""Project registration and bounded, live source inspection."""

import ctypes
from contextlib import contextmanager
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import threading
import time
import unicodedata

GIT = shutil.which('git')
MAX_FILE = 512 * 1024
MAX_INDEX = 20000
INSTRUCTIONS = ('AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'koordinator.local.md')
SKIP_DIRS = {
    '.git', '.svn', '.hg', '.ssh', '.aws', '.azure', '.claude', '.opencode', '.config',
    '.idea', '.vscode', 'node_modules', 'vendor', 'bin', 'obj', 'dist', 'build',
    'coverage', '__pycache__', '.venv', 'venv', '.next', '.nuxt', '.cache',
    'runtime', 'logs', 'data', 'backups', 'uploads', '.playwright-mcp',
}
TEXT_EXT = {
    '.md', '.txt', '.cs', '.csproj', '.sln', '.slnx', '.props', '.targets',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi', '.toml',
    '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss', '.go', '.rs',
    '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.cu', '.cuh', '.metal', '.sh', '.ps1', '.cmd', '.bat',
    '.kt', '.kts', '.gradle', '.swift', '.rb', '.rake', '.php', '.fs', '.fsproj', '.vb', '.vbproj', '.cmake',
    '.sql', '.graphql', '.proto', '.vue', '.svelte', '.conf', '.ini', '.rst',
}
BLOCK_FILES = (
    '.env*', '.npmrc', '.netrc', '.git-credentials', 'appsettings*.json',
    '*credentials*', '*password*', 'secrets*', 'auth.json', 'auth-profiles.json',
    '*private-key*', 'id_rsa*', 'id_ed25519*', 'package-lock.json', '*lock.json',
    'pnpm-lock.yaml', 'yarn.lock', '*.min.js', '*.min.css', '*prihlasovacie*',
)
SPECIAL_TEXT = {'dockerfile', 'makefile', 'codeowners', 'license', 'copying', 'notice', '.gitignore', '.gitattributes', '.editorconfig',
                'go.mod', 'go.sum', 'go.work', 'gemfile', 'rakefile', 'requirements.txt', 'meson.build'}


class ProjectError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def slug(value):
    plain = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')[:64]


def relative_name(value, allow_empty=False):
    if not isinstance(value, str) or len(value) > 600:
        raise ProjectError('A relative source path is required.')
    value = value.replace('\\', '/')
    if value == '' and allow_empty:
        return ''
    parts = value.split('/')
    if not value or any(p in ('', '.', '..') or p.endswith((' ', '.')) for p in parts):
        raise ProjectError('Use a normal relative path without traversal.')
    if any(ord(c) < 32 or c in ':<>"|?*' for c in value):
        raise ProjectError('The source path contains unsupported characters.')
    if any(re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?', p, re.I) for p in parts):
        raise ProjectError('Device paths are not source files.')
    return value


def allowed_name(relative, directory=False):
    parts = PurePosixPath(relative).parts
    if any(p.lower() in SKIP_DIRS for p in parts):
        return False
    name = parts[-1].lower() if parts else ''
    if any(fnmatch.fnmatchcase(part.lower(), pattern) for part in parts for pattern in BLOCK_FILES):
        return False
    return directory or name in SPECIAL_TEXT or Path(name).suffix in TEXT_EXT


def is_link(path):
    metadata = path.lstat()
    return stat.S_ISLNK(metadata.st_mode) or bool(getattr(metadata, 'st_file_attributes', 0) & 0x400)


def checked_path(root, relative):
    relative = relative_name(relative)
    root = Path(root)
    if root.resolve(strict=True) != root:
        raise ProjectError('The connected folder moved. Reconnect it before reading.', 409)
    path = root
    for part in relative.split('/'):
        path = path / part
        if is_link(path):
            raise ProjectError('Linked files and junctions are not followed.', 403)
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or not allowed_name(relative):
        raise ProjectError('This path is outside the project source view.', 403)
    return resolved


def opened_path(stream, fallback):
    # Check the file actually opened, not only the pathname checked before open().
    if os.name == 'nt':
        import msvcrt
        from ctypes import wintypes
        api = ctypes.WinDLL('kernel32', use_last_error=True).GetFinalPathNameByHandleW
        api.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
        api.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(32768)
        count = api(msvcrt.get_osfhandle(stream.fileno()), buffer, len(buffer), 0)
        if not count or count >= len(buffer):
            raise ProjectError('Could not verify the opened source file.', 403)
        value = buffer.value
        if value.startswith('\\\\?\\UNC\\'):
            value = '\\\\' + value[8:]
        elif value.startswith('\\\\?\\'):
            value = value[4:]
        return Path(value)
    descriptor = Path(f'/proc/self/fd/{stream.fileno()}')
    return descriptor.resolve() if descriptor.exists() else fallback.resolve(strict=True)


def git(root, *arguments, input_bytes=None):
    if not GIT:
        raise ProjectError('Git is not installed on the host.', 503)
    environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    environment.update(GIT_TERMINAL_PROMPT='0', GIT_PAGER='cat', GIT_OPTIONAL_LOCKS='0')
    command = [GIT, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
               '-c', 'core.quotePath=false', '-C', str(root), *arguments]
    output, errors, overflow = bytearray(), bytearray(), threading.Event()
    with subprocess.Popen(command, stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, shell=False) as process:
        def drain(stream, target, maximum):
            while chunk := stream.read(65536):
                if len(target) + len(chunk) > maximum:
                    overflow.set()
                    process.kill()
                    return
                target.extend(chunk)
        readers = [threading.Thread(target=drain, args=(process.stdout, output, 2 * 1024 * 1024), daemon=True),
                   threading.Thread(target=drain, args=(process.stderr, errors, 16384), daemon=True)]
        for reader in readers:
            reader.start()
        try:
            if input_bytes is not None:
                try:
                    process.stdin.write(input_bytes)
                    process.stdin.close()
                except BrokenPipeError:
                    pass
            code = process.wait(timeout=20)
        except subprocess.TimeoutExpired as error:
            process.kill()
            process.wait()
            raise ProjectError('The Git command exceeded its 20-second limit.', 504) from error
        finally:
            for reader in readers:
                reader.join(timeout=2)
    if overflow.is_set():
        raise ProjectError('Git output exceeded the source-view limit.', 413)
    return code, bytes(output), errors.decode('utf-8', 'replace')


def git_root(root):
    if not GIT:
        return None
    code, output, error = git(root, 'rev-parse', '--show-toplevel')
    if code:
        if 'not a git repository' in error.lower():
            return None
        raise ProjectError(f'Git inspection failed (exit {code}): {error.strip()}', 422)
    return Path(output.decode('utf-8').strip()).resolve()


def ignored_paths(root, paths):
    if not paths or git_root(root) is None:
        return set()
    code, data, error = git(root, 'check-ignore', '-z', '--stdin',
                            input_bytes='\0'.join(paths).encode('utf-8') + b'\0')
    if code not in (0, 1):
        raise ProjectError(f'Git ignore check failed (exit {code}): {error.strip()}', 422)
    return {p for p in data.decode('utf-8', 'replace').split('\0') if p}


def read_text(root, relative, check_ignore=True):
    path = checked_path(root, relative)
    # Local instruction files are intentionally discovered even when Git ignores them.
    if check_ignore and Path(relative).name not in INSTRUCTIONS and relative in ignored_paths(root, [relative]):
        raise ProjectError('This file is excluded by Git ignore rules.', 403)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE:
        raise ProjectError('Choose a text source file smaller than 512 KiB.', 413)
    with path.open('rb') as stream:
        actual = opened_path(stream, path)
        if actual != path or not actual.is_relative_to(Path(root)):
            raise ProjectError('The source path changed during the read.', 409)
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE:
            raise ProjectError('Choose a text source file smaller than 512 KiB.', 413)
        raw = stream.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE or b'\0' in raw:
        raise ProjectError('Binary or oversized files are outside the source view.', 413)
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise ProjectError('This source file is not UTF-8 text.', 415) from error


class Projects:
    def __init__(self, database):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, roots TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS project_metadata (project_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')

    @contextmanager
    def connection(self):
        database = sqlite3.connect(self.database, timeout=10)
        try:
            with database:
                yield database
        finally:
            database.close()

    def list(self):
        with self.connection() as db:
            return [{'id': row[0], 'name': row[1], 'roots': json.loads(row[2]), **({'metadata': json.loads(row[3])} if row[3] else {})}
                    for row in db.execute('SELECT p.id,p.name,p.roots,m.payload FROM projects p LEFT JOIN project_metadata m ON m.project_id=p.id ORDER BY p.name')]

    def set_metadata(self, project_id, metadata):
        self.get(project_id)
        if not isinstance(metadata, dict) or len(json.dumps(metadata)) > 32000:
            raise ProjectError('Use bounded project metadata.')
        with self.connection() as db:
            db.execute('INSERT INTO project_metadata VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET payload=excluded.payload',
                       (project_id, json.dumps(metadata)))

    def get(self, project_id):
        projects = self.list()
        for project in projects:
            if project['id'] == project_id:
                return project
        choices = '; '.join(f'project="{p["id"]}", root=' + '/'.join(r['id'] for r in p['roots']) for p in projects)
        raise ProjectError(f'Unknown project ID. Use the project and root separately. Available: {choices or "none; connect a folder in Project Hub"}.', 404)

    def connect(self, name, roots, project_id=None):
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ProjectError('Enter a project name of 1-100 characters.')
        if not isinstance(roots, list) or not 1 <= len(roots) <= 8:
            raise ProjectError('Connect between one and eight project folders.')
        normalized = []
        for item in roots:
            if not isinstance(item, dict) or not isinstance(item.get('path'), str):
                raise ProjectError('Each project folder needs a path.')
            path = Path(item['path']).expanduser().resolve(strict=True)
            if not path.is_dir() or path == Path(path.anchor) or path == Path.home():
                raise ProjectError('Choose a project folder rather than a drive or user home.')
            label = slug(item.get('label') or path.name)
            if not label or any(r['id'] == label for r in normalized):
                raise ProjectError('Folder labels must be distinct. Use backend and frontend, for example.')
            if any(path.is_relative_to(Path(r['path'])) or Path(r['path']).is_relative_to(path) for r in normalized):
                raise ProjectError('Project folders must not duplicate or overlap each other.')
            normalized.append({'id': label, 'label': item.get('label') or path.name, 'path': str(path)})
        identifier = project_id or slug(name)
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', identifier):
            raise ProjectError('Use a project ID containing lowercase letters, numbers, and hyphens.')
        with self.connection() as db:
            existing = db.execute('SELECT roots FROM projects WHERE id=?', (identifier,)).fetchone()
            if existing and json.loads(existing[0]) != normalized:
                raise ProjectError('That project name is already connected to different folders. Use another name.', 409)
            db.execute('INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
                       (identifier, name.strip(), json.dumps(normalized)))
        return self.get(identifier)

    def disconnect(self, project_id):
        self.get(project_id)
        with self.connection() as db:
            db.execute('DELETE FROM project_metadata WHERE project_id=?', (project_id,))
            db.execute('DELETE FROM projects WHERE id=?', (project_id,))
        return {'disconnected': project_id}

    def root(self, project_id, root_id):
        project = self.get(project_id)
        if not root_id and len(project['roots']) == 1:
            root_id = project['roots'][0]['id']
        for root in project['roots']:
            if root['id'] == root_id:
                path = Path(root['path'])
                if not path.is_dir() or path.resolve(strict=True) != path:
                    raise ProjectError('The connected folder is unavailable or moved. Reconnect it.', 409)
                return path
        raise ProjectError('Select a folder/root from this project.')

    def index(self, root):
        if git_root(root) is not None:
            # Git owns ignore semantics and avoids traversing ignored dependency trees.
            code, data, error = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.')
            if code:
                raise ProjectError(f'Git source inventory failed (exit {code}): {error.strip()}', 422)
            candidates = data.decode('utf-8', 'replace').split('\0')
            paths = []
            started = time.monotonic()
            visited = 0
            for candidate in candidates:
                visited += 1
                if len(paths) >= MAX_INDEX or time.monotonic() - started > 4:
                    break
                try:
                    path = relative_name(candidate)
                    if allowed_name(path) and checked_path(root, path).is_file():
                        paths.append(path)
                except (OSError, ProjectError):
                    continue
            return {'files': sorted(set(paths)), 'truncated': visited < len(candidates), 'visited': visited}
        paths, stack, visited = [], [(root, 0)], 0
        started = time.monotonic()
        truncated = False
        while stack:
            directory, depth = stack.pop()
            if depth > 24:
                truncated = True
                continue
            try:
                if directory.resolve(strict=True) != directory or (directory != root and is_link(directory)):
                    continue
                with os.scandir(directory) as entries:
                    for entry in entries:
                        visited += 1
                        if visited > 60000 or len(paths) >= MAX_INDEX or time.monotonic() - started > 4:
                            truncated = True
                            stack.clear()
                            break
                        relative = Path(entry.path).relative_to(root).as_posix()
                        if is_link(Path(entry.path)):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            if allowed_name(relative, directory=True) and not (Path(entry.path) / '.git').exists():
                                stack.append((Path(entry.path), depth + 1))
                        elif entry.is_file(follow_symlinks=False) and allowed_name(relative):
                            paths.append(relative)
            except (OSError, ValueError):
                continue
        ignored = ignored_paths(root, paths)
        return {'files': sorted(set(paths) - ignored), 'truncated': truncated, 'visited': visited}

    def instructions(self, root, relative=''):
        relative = relative_name(relative, allow_empty=True)
        directories = ['']
        if relative:
            parent = PurePosixPath(relative).parent
            directories += [str(p) for p in reversed([parent, *parent.parents]) if str(p) != '.']
        result, budget = [], 40000
        for directory in dict.fromkeys(directories):
            for name in INSTRUCTIONS:
                path = f'{directory}/{name}' if directory else name
                try:
                    text = read_text(root, path)
                except (OSError, ProjectError):
                    continue
                result.append({'path': path, 'content': text[:min(budget, 12000)],
                               'truncated': len(text) > min(budget, 12000)})
                budget -= min(len(text), budget, 12000)
                if budget <= 0:
                    result[-1]['budget_exhausted'] = True
                    return result
        return result

    def git_status(self, root):
        top = git_root(root)
        if top is None:
            return {'repository': False, 'branch': None, 'changes': []}
        code, data, error = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.')
        if code:
            raise ProjectError(f'Git status failed (exit {code}): {error.strip()}', 422)
        chunks, changes, hidden = data.decode('utf-8', 'replace').split('\0'), [], 0
        index = 0
        while index < len(chunks):
            entry = chunks[index]
            index += 1
            if not entry:
                continue
            status_code, path = entry[:2], entry[3:]
            directory = path.endswith('/')
            if 'R' in status_code or 'C' in status_code:
                index += 1
            try:
                relative = (top / path).relative_to(root).as_posix()
            except ValueError:
                continue
            if allowed_name(relative, directory=directory):
                changes.append({'status': status_code, 'path': relative + ('/' if directory else '')})
            else:
                hidden += 1
        branch_code, branch, _ = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')
        head_code, head, _ = git(root, 'rev-parse', '--short', 'HEAD')
        return {'repository': True, 'branch': branch.decode().strip() if branch_code == 0 else '(detached)',
                'head': head.decode().strip() if head_code == 0 else None,
                'changes': changes[:150], 'change_count': len(changes), 'excluded_count': hidden,
                'truncated': len(changes) > 150}

    def overview(self, project_id):
        project = self.get(project_id)
        result = {**project, 'roots': []}
        for entry in project['roots']:
            try:
                root = self.root(project_id, entry['id'])
                index = self.index(root)
                manifests = [p for p in index['files'] if Path(p).name in
                             ('package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'global.json', 'composer.json', 'Gemfile', 'CMakeLists.txt', 'pom.xml')
                             or Path(p).suffix in ('.csproj', '.fsproj', '.vbproj', '.sln', '.slnx', '.gradle')]
                stack = []
                if any(Path(p).suffix in ('.csproj', '.fsproj', '.vbproj', '.sln', '.slnx') for p in manifests):
                    stack.append('.NET / C#')
                if any(Path(p).name == 'package.json' for p in manifests):
                    stack.append('Node / JavaScript / TypeScript')
                if any(p.endswith('.py') for p in index['files']):
                    stack.append('Python')
                for label, names, extensions in [('Rust', {'Cargo.toml'}, {'.rs'}), ('Go', {'go.mod'}, {'.go'}),
                    ('C / C++ / CUDA', {'CMakeLists.txt'}, {'.c','.cpp','.cc','.cxx','.cu'}), ('PHP', {'composer.json'}, {'.php'}),
                    ('Ruby', {'Gemfile'}, {'.rb'}), ('Java / Kotlin', {'pom.xml'}, {'.java','.kt','.gradle'}), ('Swift', set(), {'.swift'})]:
                    if any(Path(p).name in names or Path(p).suffix in extensions for p in index['files']):
                        stack.append(label)
                instructions = self.instructions(root)
                result['roots'].append({**entry, 'available': True, 'stack': stack or ['Source folder'],
                    'source_files': len(index['files']), 'index_truncated': index['truncated'],
                    'manifests': manifests[:60], 'instructions': instructions,
                    'git': self.git_status(root)})
            except (ProjectError, OSError) as error:
                result['roots'].append({**entry, 'available': False, 'error': str(error)})
        return result

    def tool(self, request):
        action = request.get('action')
        if action == 'list':
            projects = self.list()
            query = request.get('query', '')
            if not isinstance(query, str) or len(query) > 200:
                raise ProjectError('Use a project search of at most200 characters.')
            if query:
                projects = [p for p in projects if query.casefold() in (p['id'] + ' ' + p['name']).casefold()]
            start, limit = request.get('start', 1), request.get('limit', 50)
            if type(start) is not int or type(limit) is not int or start < 1 or not 1 <= limit <= 100:
                raise ProjectError('Project lists use start>=1 and limit1–100.')
            return {'projects': projects[start-1:start-1+limit], 'total': len(projects), 'start': start,
                    'truncated': start-1+limit < len(projects)}
        project_id = request.get('project')
        if action == 'overview':
            return self.overview(project_id)
        root = self.root(project_id, request.get('root'))
        if action == 'git':
            return self.git_status(root)
        if action == 'instructions':
            instructions = self.instructions(root, request.get('path', ''))
            return {'instructions': instructions, 'truncated': any(i['truncated'] or i.get('budget_exhausted') for i in instructions)}
        if action == 'read':
            path = relative_name(request.get('path'))
            root_id = request.get('root') or self.get(project_id)['roots'][0]['id']
            text = read_text(root, path)
            lines = text.splitlines()
            try:
                start = max(1, int(request.get('start', 1)))
                limit = min(300, max(1, int(request.get('limit', 160))))
            except (TypeError, ValueError) as error:
                raise ProjectError('Line numbers must be integers.') from error
            selected = lines[start - 1:start - 1 + limit]
            content = '\n'.join(f'{start + n}: {line}' for n, line in enumerate(selected))
            return {'project': project_id, 'root': root_id, 'path': path,
                    'source': f'{project_id}/{root_id}/{path}',
                    'absolute_path': str(root / path),
                    'start': start, 'total_lines': len(lines), 'content': content[:24000],
                    'truncated': start - 1 + len(selected) < len(lines) or len(content) > 24000,
                    'sha256': hashlib.sha256(text.encode()).hexdigest()}
        if action == 'tree':
            path = relative_name(request.get('path', ''), allow_empty=True)
            prefix = path + '/' if path else ''
            index = self.index(root)
            entries = {}
            for file in index['files']:
                if file.startswith(prefix):
                    name, separator, _ = file[len(prefix):].partition('/')
                    entries[name] = {'name': name, 'path': prefix + name, 'kind': 'folder' if separator else 'file'}
            ordered = sorted(entries.values(), key=lambda e: (e['kind'] != 'folder', e['name'].lower()))
            return {'path': path, 'entries': ordered[:300], 'truncated': index['truncated'] or len(ordered) > 300}
        if action == 'search':
            query = request.get('query', '')
            if not isinstance(query, str) or not 2 <= len(query) <= 200:
                raise ProjectError('Search for 2-200 characters.')
            index, hits, size, scanned = self.index(root), [], 0, 0
            started = time.monotonic()
            for path in index['files']:
                if len(hits) >= 40 or size > 16 * 1024 * 1024 or time.monotonic() - started > 5:
                    break
                try:
                    text = read_text(root, path, check_ignore=False)
                except (OSError, ProjectError):
                    continue
                size += len(text.encode('utf-8'))
                scanned += 1
                if query.casefold() in path.casefold():
                    hits.append({'path': path, 'line': 1, 'preview': '[filename match]'})
                for number, line in enumerate(text.splitlines(), 1):
                    if query.casefold() in line.casefold():
                        hits.append({'path': path, 'line': number, 'preview': line.strip()[:240]})
                        if len(hits) >= 40:
                            break
            return {'query': query, 'hits': hits[:40], 'files_scanned': scanned,
                    'truncated': index['truncated'] or scanned < len(index['files']) or len(hits) >= 40}
        raise ProjectError('Unknown project tool.')
