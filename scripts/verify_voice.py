"""Verify real local speech and optionally its full Medical project chat path."""

import argparse
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import io
import json
import sys
import time
import urllib.request
import uuid
import wave

from init import ROOT

URL = 'http://127.0.0.1:18791'


def audio_seconds(value):
    with wave.open(io.BytesIO(value), 'rb') as recording:
        raw = recording.readframes(10_000_000)
        return len(raw) / recording.getsampwidth() / recording.getnchannels() / recording.getframerate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', action='store_true', help='Also ask the connected Medical project and synthesize its answer.')
    args = parser.parse_args()
    folder = ROOT / 'logs' / ('voice-checks-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    folder.mkdir(parents=True, exist_ok=True)
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    with browser.open(URL + '/', timeout=10):
        pass
    results = {}

    def request(path, data=None, content_type='application/json'):
        if isinstance(data, dict):
            data = json.dumps(data).encode()
        call = urllib.request.Request(URL + path, data=data,
            headers={'Content-Type': content_type, 'Origin': URL})
        started = time.monotonic()
        with browser.open(call, timeout=300) as response:
            value = response.read()
            result = value if response.headers.get_content_type().startswith('audio/') else json.loads(value)
        results[path + '-seconds'] = round(time.monotonic() - started, 3)
        return result

    status = request('/api/voice/status')
    if not status['available']:
        raise RuntimeError(status['message'])
    print('PASS: both local speech models are installed.', flush=True)
    text = 'Tell me the React version in the medical frontend.'
    audio = request('/api/voice/speak', {'text': text, 'voice': 'bm_george'})
    duration = audio_seconds(audio)
    if not 1 < duration < 60:
        raise RuntimeError(f'Unexpected synthetic recording duration: {duration}')
    (folder / 'synthetic-request.wav').write_bytes(audio)
    print(f'PASS: local text-to-speech produced {duration:.2f}s of WAV audio.', flush=True)
    transcript = request('/api/voice/transcribe', audio, 'audio/wav')
    if not all(word in transcript['text'].lower() for word in ('react', 'medical')):
        raise RuntimeError('The synthetic phrase was not recognized: ' + transcript['text'])
    results['transcript'] = transcript['text']
    print('PASS: local speech-to-text recognized the synthetic project question.', flush=True)
    if args.project:
        source = request('/api/tool', {'action': 'read', 'project': 'medical', 'root': 'frontend', 'path': 'package.json'})
        manifest = json.loads('\n'.join(line.partition(': ')[2] for line in source['content'].splitlines()))
        expected = manifest['dependencies']['react'].lstrip('^~')
        reply = request('/api/chat', {'project': 'medical', 'thread': str(uuid.uuid4()),
            'message': transcript['text'] + ' Use the connected project tool and cite the source path.'})
        if expected not in reply['answer'] or 'package.json' not in reply['answer']:
            raise RuntimeError('Project answer did not contain the verified React version/source: ' + reply['answer'])
        results['answer'] = reply['answer']
        results['session'] = reply['session']
        answer_audio = request('/api/voice/speak', {'text': reply['answer'], 'voice': 'bm_george'})
        if audio_seconds(answer_audio) < 1:
            raise RuntimeError('The spoken answer contained no useful audio.')
        (folder / 'spoken-answer.wav').write_bytes(answer_audio)
        print('PASS: transcribed question -> Medical source tool -> correct answer -> spoken WAV.', flush=True)
    results['physical_microphone_tested'] = False
    (folder / 'results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Artifacts: {folder}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAIL: {error}', file=sys.stderr)
        raise SystemExit(1)
