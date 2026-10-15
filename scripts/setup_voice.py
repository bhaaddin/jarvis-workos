"""Start the pinned local speech service and install its two model artifacts."""

import json
import subprocess
import sys
from init import ROOT, initialize

sys.path.insert(0, str(ROOT))
from project_hub.voice import STT_MODEL, TTS_MODEL, VOICE_IDS, Voice


def main():
    environment = initialize()
    subprocess.run(['docker', 'compose', '--profile', 'voice', 'up', '-d', '--wait', '--wait-timeout', '180', 'voice'],
                   cwd=ROOT, check=True)
    client = Voice(environment['JARVIS_VOICE_TOKEN'])
    installed = {model['id'] for model in client.json('/v1/models').get('data', [])}
    for model in (STT_MODEL, TTS_MODEL):
        if model not in installed:
            print(f'Downloading local voice model: {model}', flush=True)
            client.request('/v1/models/' + model, method='POST', timeout=1800)
        print(f'Model available: {model}', flush=True)
    voices = client.json('/v1/audio/voices')
    available = {item['id'] for item in voices.get('voices', [])}
    missing = set(VOICE_IDS) - available
    if missing:
        raise RuntimeError('Reading voices missing from the installed model: ' + ', '.join(sorted(missing)))
    print('Reading voices ready: ' + ', '.join(VOICE_IDS), flush=True)
    print('Local voice models installed. Runtime audio checks are a separate step.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Voice setup failed: {error}', file=sys.stderr)
        raise SystemExit(1)
