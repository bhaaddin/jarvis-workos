import json
from .projects import ProjectError
from .voice import VOICE_IDS

DEFAULTS = {'theme': 'dark', 'voice': 'bm_george', 'auto_speak': False, 'auto_send_voice': False}


class Preferences:
    def __init__(self, projects):
        self.projects = projects
        with projects.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS ui_preferences (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT)')

    def get(self):
        with self.projects.connection() as db:
            row = db.execute('SELECT value FROM ui_preferences WHERE id=1').fetchone()
        return {**DEFAULTS, **(json.loads(row[0]) if row else {})}

    def save(self, changes):
        if not isinstance(changes, dict) or set(changes) - set(DEFAULTS):
            raise ProjectError('Unknown preference.')
        if 'theme' in changes and changes['theme'] not in ('dark', 'light'):
            raise ProjectError('Choose a dark or light theme.')
        if 'voice' in changes and changes['voice'] not in VOICE_IDS:
            raise ProjectError('Choose an available reading voice.')
        for key in ('auto_speak', 'auto_send_voice'):
            if key in changes and not isinstance(changes[key], bool):
                raise ProjectError('Voice preferences must be boolean values.')
        with self.projects.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT value FROM ui_preferences WHERE id=1').fetchone()
            result = {**DEFAULTS, **(json.loads(row[0]) if row else {}), **changes}
            db.execute('INSERT INTO ui_preferences VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', (json.dumps(result),))
        return result
