"""Warm CUDA Whisper and the selected Kokoro provider before the first call."""
import json
import sys
import time
from init import ROOT, read_env
sys.path.insert(0, str(ROOT))
from project_hub.voice import Voice

if __name__ == '__main__':
    voice = Voice(read_env()['JARVIS_VOICE_TOKEN'], 'http://127.0.0.1:18902')
    start = time.monotonic()
    audio = voice.speak('Ready.', 'bm_george')
    spoken = time.monotonic()
    result = voice.transcribe(audio, 'audio/wav')
    print(json.dumps({'speech_warmed': True, 'tts_seconds': round(spoken - start, 3),
                      'stt_seconds': round(time.monotonic() - spoken, 3), 'transcript_present': bool(result['text'])}))
