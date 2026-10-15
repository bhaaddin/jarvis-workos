import io
import json
import unittest
from unittest.mock import patch
import wave

from project_hub.projects import ProjectError
from project_hub.voice import MAX_AUDIO, STT_MODEL, TTS_MODEL, TTS_MODEL_CS, VOICE_CS, Voice, default_voice


def wav_fixture():
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b'\0\0' * 2400)
    return output.getvalue()


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.voice = Voice('synthetic-key')

    def test_bad_audio_is_rejected_before_upstream_request(self):
        with patch.object(self.voice, 'request') as request:
            for data, kind in ((b'', 'audio/wav'), (b'x', 'text/plain'), (b'x' * (MAX_AUDIO + 1), 'audio/wav')):
                with self.subTest(kind=kind, size=len(data)), self.assertRaises(ProjectError):
                    self.voice.transcribe(data, kind)
            request.assert_not_called()

    def test_transcription_contract_and_slot_recovery(self):
        with patch.object(self.voice, 'request', return_value=(b'{"text":null}', 'application/json')):
            with self.assertRaises(ProjectError) as failure:
                self.voice.transcribe(wav_fixture(), 'audio/wav')
            self.assertEqual(failure.exception.status, 502)
        with patch.object(self.voice, 'request', return_value=(b'{"text":"  synthetic phrase  "}', 'application/json')) as request:
            result = self.voice.transcribe(wav_fixture(), 'audio/wav')
            self.assertEqual(result['text'], 'synthetic phrase')
            body = request.call_args.kwargs['data']
            self.assertIn(b'name="model"', body)
            self.assertIn(STT_MODEL.encode(), body)
            self.assertIn(b'name="file"; filename="dictation.wav"', body)
            self.assertIn(wav_fixture(), body)

    def test_speech_rejects_invalid_audio_and_recovers(self):
        with patch.object(self.voice, 'request', return_value=(b'not-a-wave', 'audio/wav')):
            with self.assertRaises(ProjectError) as failure:
                self.voice.speak('Synthetic greeting')
            self.assertEqual(failure.exception.status, 502)
        with patch.object(self.voice, 'request', return_value=(wav_fixture(), 'audio/wav')) as request:
            self.assertEqual(self.voice.speak('**Synthetic** greeting', 'bm_george'), wav_fixture())
            payload = json.loads(request.call_args.kwargs['data'])
            self.assertEqual(payload['model'], TTS_MODEL)
            self.assertEqual(payload['input'], 'Synthetic greeting')

    def test_unavailable_models_and_invalid_json_are_explicit(self):
        with patch.object(self.voice, 'request', return_value=(b'{"data":[]}', 'application/json')):
            self.assertFalse(self.voice.status()['available'])
        with patch.object(self.voice, 'request', return_value=(b'[]', 'application/json')):
            with self.assertRaises(ProjectError) as failure:
                self.voice.json('/v1/models')
            self.assertEqual(failure.exception.status, 502)

    def test_czech_voice_uses_piper_model_and_default(self):
        self.assertEqual(default_voice('cs'), VOICE_CS)
        self.assertEqual(default_voice('en'), 'bm_george')
        self.assertEqual(default_voice(''), 'bm_george')
        with patch.object(self.voice, 'request', return_value=(wav_fixture(), 'audio/wav')) as request:
            self.assertEqual(self.voice.speak('Ahoj Matko', 'jirka'), wav_fixture())
            payload = json.loads(request.call_args.kwargs['data'])
            self.assertEqual(payload['model'], TTS_MODEL_CS)
            self.assertEqual(payload['voice'], 'jirka')

    def test_status_reports_czech_voice_only_when_installed(self):
        models = {'data': [{'id': STT_MODEL}, {'id': TTS_MODEL}]}
        with patch.object(self.voice, 'request', return_value=(json.dumps(models).encode(), 'application/json')):
            status = self.voice.status()
            self.assertTrue(status['available'])
            self.assertFalse(status['czech_voice'])
            self.assertNotIn('jirka', status['voices'])
        models['data'].append({'id': TTS_MODEL_CS})
        with patch.object(self.voice, 'request', return_value=(json.dumps(models).encode(), 'application/json')):
            status = self.voice.status()
            self.assertTrue(status['czech_voice'])
            self.assertIn('jirka', status['voices'])

    def test_busy_voice_and_invalid_synthesis_inputs(self):
        with patch.object(self.voice, 'request') as request:
            for text, voice in (('', 'bm_george'), ('x' * 6001, 'bm_george'), ('Hello', 'unconfigured-voice')):
                with self.subTest(voice=voice), self.assertRaises(ProjectError):
                    self.voice.speak(text, voice)
            self.voice.slots.acquire()
            try:
                with self.assertRaises(ProjectError) as failure:
                    self.voice.speak('A synthetic sentence.')
                self.assertEqual(failure.exception.status, 429)
            finally:
                self.voice.slots.release()
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
