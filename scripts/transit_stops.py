"""Download the PID stop register for the transit skill (keyless public data)."""

import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'runtime' / 'transit-stops.json'
URL = 'https://data.pid.cz/stops/json/stops.json'


def main():
    request = urllib.request.Request(URL, headers={'User-Agent': 'Jarvis-WorkOS/0.5 transit-setup'})
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read(30 * 1024 * 1024 + 1)
    if len(raw) > 30 * 1024 * 1024:
        raise RuntimeError('Stop register exceeded the size limit.')
    data = json.loads(raw)
    groups = data.get('stopGroups')
    if not isinstance(groups, list) or not groups:
        raise RuntimeError('Stop register has no usable groups.')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix('.tmp')
    temporary.write_text(json.dumps({'downloadedAt': time.time(), 'groups': groups}), encoding='utf-8')
    temporary.replace(TARGET)
    print(json.dumps({'groups': len(groups), 'bytes': len(raw), 'target': str(TARGET)}))


if __name__ == '__main__':
    main()
