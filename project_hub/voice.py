"""Local OpenAI-compatible speech adapter. No hosted speech provider is used."""

import json
import re
import threading
import urllib.error
import urllib.request
import uuid

from .projects import ProjectError

STT_MODEL = 'Systran/faster-whisper-small'
TTS_MODEL = 'speaches-ai/Kokoro-82M-v1.0-ONNX'
TTS_MODEL_CS = 'speaches-ai/piper-cs_CZ-jirka-medium'
VOICE_CS = 'jirka'
MAX_AUDIO = 10 * 1024 * 1024
MAX_SPEECH = 25 * 1024 * 1024
VOICE_IDS = ('bm_george', 'af_heart', 'bf_emma', 'am_michael', 'jirka')
AUDIO_TYPES = {'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg'}


def default_voice(language):
    """Per-language default voice: Czech gets Jirka, everything else George."""
    return VOICE_CS if str(language or '').lower().startswith('cs') else 'bm_george'


class Voice:
    def __init__(self, token, base_url='http://127.0.0.1:18792'):
        self.token = token
        self.base_url = base_url.rstrip('/')
        self.slots = threading.BoundedSemaphore(1)

    def request(self, path, data=None, content_type='application/json', method=None, timeout=120, limit=MAX_SPEECH):
        call = urllib.request.Request(self.base_url + path, data=data, method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': content_type})
        try:
            with urllib.request.urlopen(call, timeout=timeout) as response:
                value = response.read(limit + 1)
                media_type = response.headers.get_content_type()
            if len(value) > limit:
                raise ProjectError('The speech response exceeded its size limit.', 502)
            return value, media_type
        except urllib.error.HTTPError as error:
            if error.code in (400, 413, 415, 422):
                raise ProjectError(f'The speech service rejected the audio or voice input (HTTP {error.code}).', error.code) from error
            raise ProjectError(f'Local speech service returned HTTP {error.code}. Run python scripts/setup_voice.py.', 503) from error
        except OSError as error:
            raise ProjectError('Local voice is unavailable or timed out. Run python scripts/setup_voice.py.', 503) from error

    def json(self, path, **kwargs):
        raw, _ = self.request(path, **kwargs)
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError) as error:
            raise ProjectError('The speech service returned malformed JSON.', 502) from error
        if not isinstance(result, dict):
            raise ProjectError('The speech service returned an invalid response.', 502)
        return result

    def status(self):
        try:
            models = self.json('/v1/models', timeout=5).get('data', [])
            installed = {item.get('id') for item in models if isinstance(item, dict)}
            available = {STT_MODEL, TTS_MODEL}.issubset(installed)
            czech = TTS_MODEL_CS in installed
            voices = [voice for voice in VOICE_IDS if voice != VOICE_CS or czech]
            return {'available': available, 'stt_model': STT_MODEL, 'tts_model': TTS_MODEL,
                    'tts_model_cs': TTS_MODEL_CS if czech else None, 'czech_voice': czech,
                    'voices': voices if available else [],
                    'message': 'Local speech models ready.' if available else 'Download voice models with python scripts/setup_voice.py.'}
        except ProjectError as error:
            return {'available': False, 'voices': [], 'message': str(error)}

    def transcribe(self, audio, media_type):
        if media_type not in AUDIO_TYPES:
            raise ProjectError('Upload WAV, WebM, or Ogg audio.', 415)
        if not audio or len(audio) > MAX_AUDIO:
            raise ProjectError('Audio must be nonempty and no larger than 10 MiB.', 413)
        boundary = 'jarvis-' + uuid.uuid4().hex
        fields = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{STT_MODEL}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation.{AUDIO_TYPES[media_type]}"\r\n'
            f'Content-Type: {media_type}\r\n\r\n'
        ).encode()
        if not self.slots.acquire(blocking=False):
            raise ProjectError('Local voice is busy. Try again after the current request.', 429)
        try:
            result = self.json('/v1/audio/transcriptions', data=fields + audio + f'\r\n--{boundary}--\r\n'.encode(),
                               content_type='multipart/form-data; boundary=' + boundary, limit=65536)
            text = result.get('text')
            if not isinstance(text, str) or len(text) > 12000:
                raise ProjectError('The speech service returned an invalid transcript.', 502)
            return {'text': text.strip(), 'model': STT_MODEL}
        finally:
            self.slots.release()

    def speak(self, text, voice='bm_george'):
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 6000:
            raise ProjectError('Read aloud accepts 1-6000 text characters.')
        if voice not in VOICE_IDS:
            raise ProjectError('Choose one of the available reading voices.')
        # Keep citations readable while removing basic Markdown decoration.
        spoken = re.sub(r'[*`#]', '', text)
        model = TTS_MODEL_CS if voice == VOICE_CS else TTS_MODEL
        payload = json.dumps({'model': model, 'input': spoken, 'voice': voice,
                              'response_format': 'wav', 'stream_format': 'audio', 'speed': 1.0}).encode()
        if not self.slots.acquire(blocking=False):
            raise ProjectError('Local voice is busy. Try again after the current request.', 429)
        try:
            data, media_type = self.request('/v1/audio/speech', data=payload)
            if media_type not in ('audio/wav', 'audio/x-wav') or len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
                raise ProjectError('The speech service did not return a WAV recording.', 502)
            return data
        finally:
            self.slots.release()
