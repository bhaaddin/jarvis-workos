"""Register and verify the existing managed clones through declared adapters."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from init import ROOT, read_env
sys.path.insert(0, str(ROOT))
from project_hub.connections import Connections
from project_hub.projects import Projects, ProjectError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['discover', 'import-clones', 'list', 'check', 'verify'])
    parser.add_argument('--project')
    parser.add_argument('--query', default='')
    args = parser.parse_args()
    projects = Projects(ROOT / 'runtime/project-hub.sqlite')
    registry = Connections(projects, json.loads((ROOT / 'config/connections.json').read_text(encoding='utf-8')), environment=read_env())
    folder = ROOT / 'logs' / ('connections-' + args.operation + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True)
    if args.operation == 'discover':
        result = registry.discover()
    elif args.operation == 'import-clones':
        result = registry.import_clones()
    elif args.operation == 'list':
        result = registry.catalog(args.query, limit=100)
    elif args.operation == 'check':
        if not args.project:
            parser.error('--project is required')
        result = registry.compatibility(args.project, refresh=True)
    else:
        entries = []
        for project in projects.list():
            if args.project and project['id'] != args.project:
                continue
            status = registry.compatibility(project['id'], refresh=True)
            for root in status['roots']:
                sample = root.get('sample')
                if sample:
                    read = projects.tool({'action': 'read', 'project': project['id'], 'root': root['root'], 'path': sample['path'], 'limit': 5})
                    root['readVerified'] = read['sha256'] == sample['sha256'] and bool(read['content'])
                else:
                    root['readVerified'] = False
            entries.append(status)
            print(json.dumps({'project': project['id'], 'sourceReady': status['sourceReady'],
                'readsVerified': all(root['readVerified'] for root in status['roots']),
                'runtimes': [{'id': item['id'], 'state': item['state']} for item in status['runtimes']]}))
        result = {'projects': entries, 'sourceVerified': sum(item['sourceReady'] and all(root['readVerified'] for root in item['roots']) for item in entries),
                  'total': len(entries), 'runtimeCompatible': sum(connection['compatible'] for item in entries for connection in item['runtimes']),
                  'runtimeConfigured': sum(bool(connection.get('baseUrl')) for item in entries for connection in item['runtimes'])}
    target = folder / 'results.json'
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    summary = {key: value for key, value in result.items() if key not in ('projects', 'candidates', 'connected', 'adapters')}
    for key in ('projects', 'candidates', 'connected'):
        if key in result:
            summary[key + 'Count'] = len(result[key])
    print(json.dumps(summary, indent=2))
    print('Evidence: ' + str(target))
    return 1 if result.get('conflicts') or args.operation == 'verify' and result['sourceVerified'] != result['total'] else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, ProjectError) as error:
        print('Connection operation failed: ' + str(error))
        raise SystemExit(1)
