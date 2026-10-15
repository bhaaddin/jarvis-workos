"""Index a bounded batch of real upstream skill metadata."""

import argparse
import json
import sys
from init import ROOT, initialize

sys.path.insert(0, str(ROOT))
from project_hub.catalog import Catalog
from project_hub.gateway import Gateway
from project_hub.projects import Projects


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=int, default=12000)
    args = parser.parse_args()
    initialize()
    catalog = Catalog(Projects(ROOT / 'runtime/project-hub.sqlite'), Gateway())
    try:
        result = catalog.sync(lambda state: print(state['message'], flush=True), target=args.target)
        print(json.dumps(result, indent=2))
    except Exception as error:
        print(f'Catalog sync failed: {error}', file=sys.stderr)
        raise SystemExit(1)
