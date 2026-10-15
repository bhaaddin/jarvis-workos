"""Supported OpenClaw CLI operations shared by the command center."""

import json
from pathlib import Path
import subprocess
import threading
import time

from .projects import ProjectError

ROOT = Path(__file__).resolve().parents[1]


class Gateway:
    def __init__(self):
        self.mutations = threading.Lock()
        self.cache_lock = threading.Lock()
        self.inventory_cache = None

    def command(self, *arguments, timeout=60, as_json=False):
        command = ['docker', 'compose', 'exec', '-T', 'openclaw', 'node', 'dist/index.js', *arguments]
        try:
            result = subprocess.run(command, cwd=ROOT, capture_output=True, encoding='utf-8',
                                    errors='replace', timeout=timeout, shell=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ProjectError('The assistant command did not complete. Check its current state before retrying.', 504) from error
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()[-2000:]
            raise ProjectError(f'OpenClaw command failed (exit {result.returncode}): {detail}', 502)
        if len(result.stdout) > 4 * 1024 * 1024:
            raise ProjectError('The assistant response exceeded the inspection limit.', 502)
        if as_json:
            try:
                data = json.loads(result.stdout)
            except ValueError as error:
                raise ProjectError('OpenClaw returned an invalid JSON response.', 502) from error
            if not isinstance(data, dict):
                raise ProjectError('OpenClaw returned an unexpected response shape.', 502)
            return data
        return result.stdout.strip()

    def rpc(self, method, parameters, timeout=60):
        return self.command('gateway', 'call', method, '--params', json.dumps(parameters), '--json', as_json=True, timeout=timeout)

    def skills(self, refresh=False):
        with self.cache_lock:
            if self.inventory_cache and not refresh and time.monotonic() - self.inventory_cache[0] < 30:
                return self.inventory_cache[1]
        data = self.command('skills', 'list', '--json', as_json=True)
        if not isinstance(data.get('skills'), list):
            raise ProjectError('The assistant skill inventory is unavailable.', 502)
        items = []
        for entry in data['skills']:
            if not isinstance(entry, dict) or not isinstance(entry.get('name'), str):
                continue
            missing = entry.get('missing') if isinstance(entry.get('missing'), dict) else {}
            known = {'bins', 'anyBins', 'env', 'config', 'os'}.issubset(missing) and all(isinstance(value, list) for value in missing.values())
            ready = (entry.get('eligible') is True and entry.get('modelVisible') is True
                     and entry.get('disabled') is False and entry.get('blockedByAgentFilter') is False
                     and entry.get('blockedByAllowlist') is False and known and not any(missing.values()))
            items.append({**entry, 'ready': ready, 'requirements_known': known})
        with self.cache_lock:
            self.inventory_cache = (time.monotonic(), items)
        return items

    def enable_skill(self, name):
        with self.mutations:
            items = self.skills(refresh=True)
            entry = next((item for item in items if item['name'] == name), None)
            if not entry:
                raise ProjectError('That skill is not installed.', 404)
            if not entry['requirements_known']:
                raise ProjectError('Skill requirements are unknown. Refresh the inventory before enabling.', 409)
            if any((entry.get('missing') or {}).values()):
                raise ProjectError('Complete the listed skill requirements before enabling it.', 409)
            config = self.command('config', 'get', 'agents.defaults', '--json', as_json=True)
            allowed = config.get('skills')
            changes = []
            if isinstance(allowed, list) and name not in allowed:
                changes.append({'path': 'agents.defaults.skills', 'value': [*allowed, name]})
            if entry.get('disabled'):
                changes.append({'path': f'skills.entries["{name}"].enabled', 'value': True})
            if changes:
                self.command('config', 'set', '--batch-json', json.dumps(changes))
            return {'name': name, 'inventory': self.skills(refresh=True)}
