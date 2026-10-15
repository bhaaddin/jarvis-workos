"""Install ClawHub catalog skills through the OpenClaw gateway (same path as Skills library).

Usage: python -B scripts/install_catalog_skills.py <catalog-id> [<catalog-id> ...]
Prints a JSON summary per skill. Exits nonzero if any install fails.
Secrets never printed: gateway output is truncated, requirements list keys only.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from project_hub.catalog import Catalog
from project_hub.gateway import Gateway
from project_hub.projects import ProjectError, Projects
from init import ROOT


def main(ids):
    catalog = Catalog(Projects(ROOT / 'runtime' / 'project-hub.sqlite'), Gateway())
    summary = []
    failed = False
    for identifier in ids:
        try:
            entry = catalog.get(identifier)
            print('INSTALL %s (%s) requirements=%s' % (
                identifier, entry.get('version'),
                [r.get('key') for r in entry.get('requirements', [])]), flush=True)
            result = catalog.install(identifier, lambda progress: print(
                '  ... ' + str(progress.get('message', ''))[:160], flush=True))
            inventory = catalog.gateway.skills(refresh=True)
            match = [item for item in inventory if item['name'] == entry['slug']]
            summary.append({'id': identifier, 'version': entry.get('version'),
                            'requirements': [r.get('key') for r in entry.get('requirements', [])],
                            'installed_name': result.get('name_candidate'),
                            'inventory_match': [{'name': m['name'], 'ready': m['ready'],
                                                 'missing': m.get('missing')} for m in match]})
        except ProjectError as error:
            failed = True
            summary.append({'id': identifier, 'error': str(error)[:300]})
    print(json.dumps(summary, indent=2))
    return 1 if failed else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: install_catalog_skills.py <catalog-id> [...]')
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1:]))
