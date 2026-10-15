"""A real, paginated community skill catalog backed by ClawHub metadata."""

import json
import re
import threading
import time
import urllib.parse
import urllib.request

from .projects import ProjectError

IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}\Z')


def parse_skill(item):
    if not isinstance(item, dict):
        raise ProjectError('ClawHub returned an invalid skill record.', 502)
    owner, slug = item.get('ownerHandle'), item.get('slug')
    if not isinstance(owner, str) or not isinstance(slug, str) or not IDENTIFIER.fullmatch(owner) or not IDENTIFIER.fullmatch(slug):
        return None
    version = item.get('latestVersion') if isinstance(item.get('latestVersion'), dict) else {}
    stats = item.get('stats') if isinstance(item.get('stats'), dict) else {}
    topics = item.get('topics') if isinstance(item.get('topics'), list) else []
    metadata = item.get('metadata') if isinstance(item.get('metadata'), dict) else {}
    setup = metadata.get('setup') if isinstance(metadata.get('setup'), list) else []
    downloads = stats.get('downloads', 0)
    return {
        'id': f'clawhub:{owner}/{slug}', 'owner': owner, 'slug': slug,
        'name': str(item.get('displayName') or slug)[:200],
        'description': str(item.get('summary') or item.get('description') or '')[:4000],
        'topics': [value[:80] for value in topics[:15] if isinstance(value, str)],
        'version': str(version.get('version') or '')[:120],
        'license': str(version.get('license') or 'Not specified')[:100],
        'downloads': downloads if isinstance(downloads, int) and not isinstance(downloads, bool) and downloads >= 0 else 0,
        'requirements': [{'key': str(value.get('key', ''))[:120], 'required': bool(value.get('required'))}
                         for value in setup[:30] if isinstance(value, dict)],
        'url': 'https://clawhub.ai/' + urllib.parse.quote(owner, safe='') + '/' + urllib.parse.quote(slug, safe=''),
        'source': 'ClawHub', 'status': 'available',
    }


class Catalog:
    def __init__(self, projects, gateway):
        self.projects = projects
        self.gateway = gateway
        self.sync_lock = threading.Lock()
        with projects.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, owner TEXT, slug TEXT, name TEXT, description TEXT, topics TEXT, downloads INTEGER, payload TEXT)')
            db.execute('CREATE INDEX IF NOT EXISTS capabilities_popularity ON capabilities(downloads DESC,id)')
            db.execute('CREATE TABLE IF NOT EXISTS catalog_state (source TEXT PRIMARY KEY, cursor TEXT, complete INTEGER, pages INTEGER, updated REAL, generation INTEGER)')
            db.execute("INSERT OR IGNORE INTO catalog_state VALUES ('clawhub',NULL,0,0,0,0)")
            db.execute('CREATE TABLE IF NOT EXISTS skill_installs (catalog_id TEXT PRIMARY KEY, version TEXT, installed_name TEXT, verified INTEGER, updated REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS catalog_cursors (source TEXT, cursor TEXT, PRIMARY KEY(source,cursor))')
            db.execute("INSERT OR IGNORE INTO catalog_cursors SELECT source,cursor FROM catalog_state WHERE cursor IS NOT NULL")

    def stats(self):
        with self.projects.connection() as db:
            count = db.execute('SELECT COUNT(*) FROM capabilities').fetchone()[0]
            row = db.execute("SELECT complete,pages,updated,generation FROM catalog_state WHERE source='clawhub'").fetchone()
        return {'available': count, 'source': 'ClawHub', 'feed_complete': bool(row[0]), 'pages': row[1],
                'updated': row[2], 'generation': row[3], 'target': 10000}

    def ingest(self, response, previous_cursor):
        if not isinstance(response, dict) or not isinstance(response.get('items'), list) or 'nextCursor' not in response:
            raise ProjectError('ClawHub returned an invalid catalog page.', 502)
        cursor = response['nextCursor']
        if cursor is not None and (not isinstance(cursor, str) or not cursor or len(cursor) > 12000):
            raise ProjectError('ClawHub returned an invalid continuation cursor.', 502)
        if cursor is not None and cursor == previous_cursor:
            raise ProjectError('The registry returned a repeated cursor.', 502)
        entries = [parse_skill(item) for item in response['items']]
        with self.projects.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute("SELECT cursor FROM catalog_state WHERE source='clawhub'").fetchone()[0]
            if current != previous_cursor:
                raise ProjectError('The catalog checkpoint changed. Refresh its state before continuing.', 409)
            if cursor is not None and db.execute("SELECT 1 FROM catalog_cursors WHERE source='clawhub' AND cursor=?", (cursor,)).fetchone():
                raise ProjectError('The registry returned a cursor already visited in this traversal.', 502)
            for entry in entries:
                if entry is None:
                    continue
                db.execute('INSERT INTO capabilities VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,topics=excluded.topics,downloads=excluded.downloads,payload=excluded.payload',
                    (entry['id'], entry['owner'], entry['slug'], entry['name'], entry['description'],
                     ' '.join(entry['topics']), entry['downloads'], json.dumps(entry, ensure_ascii=False)))
            db.execute("UPDATE catalog_state SET cursor=?,complete=?,pages=pages+1,updated=?,generation=generation+1 WHERE source='clawhub'",
                       (cursor, int(cursor is None), time.time()))
            if cursor is not None:
                db.execute("INSERT INTO catalog_cursors VALUES ('clawhub',?)", (cursor,))
        return cursor

    def sync(self, progress=lambda value: None, target=12000):
        if not self.sync_lock.acquire(blocking=False):
            raise ProjectError('Catalog synchronization is already running.', 409)
        try:
            with self.projects.connection() as db:
                cursor, complete = db.execute("SELECT cursor,complete FROM catalog_state WHERE source='clawhub'").fetchone()
            if complete:
                return {**self.stats(), 'message': 'The current registry traversal is complete.'}
            seen = set()
            for _ in range(100):
                parameters = {'limit': 200, 'sort': 'downloads'}
                if cursor:
                    parameters['cursor'] = cursor
                url = 'https://clawhub.ai/api/v1/skills?' + urllib.parse.urlencode(parameters)
                request = urllib.request.Request(url, headers={'User-Agent': 'Jarvis-WorkOS/0.3 catalog-client', 'Accept': 'application/json'})
                with urllib.request.urlopen(request, timeout=30) as response:
                    raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise ProjectError('Registry page exceeded the catalog size limit.', 502)
                page = json.loads(raw)
                next_cursor = page.get('nextCursor') if isinstance(page, dict) else None
                if next_cursor is not None and next_cursor in seen:
                    raise ProjectError('The registry cursor cycle was detected.', 502)
                cursor = self.ingest(page, cursor)
                seen.add(cursor)
                state = self.stats()
                progress({**state, 'message': f'Indexed {state["available"]:,} real skill definitions.'})
                if cursor is None or state['available'] >= target:
                    return {**state, 'paused': cursor is not None, 'message': 'Catalog batch indexed. Entries are available definitions, not enabled tools.'}
            return {**self.stats(), 'paused': True, 'message': 'Page budget reached; resume synchronization to continue.'}
        finally:
            self.sync_lock.release()

    def search(self, query='', category='', page=0, limit=30, generation=None):
        if not isinstance(query, str) or len(query) > 160 or not isinstance(category, str) or len(category) > 80:
            raise ProjectError('The catalog search is too long.')
        try:
            page, limit = int(page), int(limit)
        except (TypeError, ValueError) as error:
            raise ProjectError('Page and limit must be integers.') from error
        if page < 0 or page > 10000 or not 1 <= limit <= 100:
            raise ProjectError('Invalid catalog page size.')
        clauses, parameters = [], []
        if query.strip():
            clauses.append('(name LIKE ? ESCAPE \'!\' OR description LIKE ? ESCAPE \'!\' OR owner LIKE ? ESCAPE \'!\' OR topics LIKE ? ESCAPE \'!\')')
            term = '%' + query.strip().replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
            parameters += [term] * 4
        if category:
            clauses.append('topics LIKE ?')
            parameters.append('%' + category + '%')
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        with self.projects.connection() as db:
            db.execute('BEGIN')
            current = db.execute("SELECT generation FROM catalog_state WHERE source='clawhub'").fetchone()[0]
            if generation is not None and str(generation) != str(current):
                raise ProjectError('Catalog refreshed. Start from the first page.', 409)
            total = db.execute('SELECT COUNT(*) FROM capabilities' + where, parameters).fetchone()[0]
            rows = db.execute('SELECT payload FROM capabilities' + where + ' ORDER BY downloads DESC,id LIMIT ? OFFSET ?',
                              [*parameters, limit, page * limit]).fetchall()
        return {'items': [json.loads(row[0]) for row in rows], 'total': total, 'page': page,
                'limit': limit, 'generation': current, 'has_more': (page + 1) * limit < total}

    def get(self, identifier):
        with self.projects.connection() as db:
            row = db.execute('SELECT payload FROM capabilities WHERE id=?', (identifier,)).fetchone()
            installed = db.execute('SELECT version,installed_name,verified FROM skill_installs WHERE catalog_id=?', (identifier,)).fetchone()
        if not row:
            raise ProjectError('Skill is not in the local catalog.', 404)
        entry = json.loads(row[0])
        entry['installation'] = {'version': installed[0], 'name': installed[1], 'verified': bool(installed[2])} if installed else None
        return entry

    def install(self, identifier, progress):
        entry = self.get(identifier)
        version = entry['version']
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+_-]{0,119}', version):
            raise ProjectError('This entry has no installable version. Open its source page for details.', 409)
        reference = f'@{entry["owner"]}/{entry["slug"]}'
        with self.gateway.mutations:
            progress({'message': f'Installing {reference} at {version} through OpenClaw.'})
            output = self.gateway.command('skills', 'install', reference, '--version', version, timeout=180)
            inventory = self.gateway.skills(refresh=True)
            # A matching display name alone is insufficient to claim verified ownership.
            candidates = [item for item in inventory if item['name'] == entry['slug'] and item.get('source') == 'openclaw-workspace']
            name = candidates[0]['name'] if len(candidates) == 1 else None
            with self.projects.connection() as db:
                db.execute('INSERT INTO skill_installs VALUES (?,?,?,?,?) ON CONFLICT(catalog_id) DO UPDATE SET version=excluded.version,installed_name=excluded.installed_name,verified=excluded.verified,updated=excluded.updated',
                           (identifier, version, name, 0, time.time()))
            return {'message': 'Installation command completed. Check installed inventory and requirements before use.',
                    'output': output[-12000:], 'name_candidate': name, 'ready': False, 'provenance_verified': False}
