# Call JARVIS

## Use it

For the latest speed/reliability changes and measured microphone-to-audio timing,
see [PERFORMANCE.md](PERFORMANCE.md). Clear weather, greetings, and basic arithmetic
now take a direct, data-backed path while preserving native conversation history.

**TeamViewer / remote notebook:** use [the notebook HTTPS connection](NOTEBOOK.md)
in the notebook's own Chrome or Edge. A browser running inside the remote desktop
looks for the remote PC's microphone, which this PC did not have at diagnosis.

Double-click **JARVIS.cmd** on the Desktop. The green **Call JARVIS** button is in
the top bar, available from every section with a selected project conversation.

1. Press **Call JARVIS** once. Allow the browser microphone request if prompted.
2. A dedicated full-screen call opens. JARVIS greets you: **“Hi, I'm Jarvis. I'm here
   with you. What would you like to work on?”**
3. Talk. Pauses finish your turns automatically; JARVIS answers aloud.
4. You can **interrupt by speaking while JARVIS talks**. There is no send/stop-recording
   action between turns.
5. **Mute / Unmute** controls your microphone; **Captions** shows the latest recognized
   question or assistant text. A timer shows the call duration.
6. Press the red **Hang up** button when finished. Escape also hangs up.

Calls stay connected when you switch browser tabs. Changing the selected project,
conversation, or app section ends the call; closing the page releases it too.

Try: **“What can you help me do with this project?”** or
**“Tell me the React version in the Medical frontend.”**

The call automatically sends recognized turns and speaks replies,
independently of the dictation preferences. Unsent typed drafts are preserved.
The model receives concise spoken-answer instructions. Long answers are spoken as
a labeled excerpt (up to 90 words / 700 characters plus the excerpt notice), with
the full answer retained in chat.

## Speaking graphics, earlier replies, and reasoning

- **Blue “You” panel:** microphone waveform and “You are speaking” highlight.
- **Green “JARVIS” panel:** playback waveform and “JARVIS is speaking” highlight.
  The two traces use actual captured/played samples; they are not decorative
  wave animations. Muted/paused input is flat, and the working state is separate.
- Voice turns now receive incremental text through bounded JSON polling, including
  through the notebook tunnel. A complete prose sentence can start playing while
  the remainder is still being generated. Its text is not spoken twice when the
  final answer arrives. Code, headings, partial numbers, and progress preambles
  are not used as early speech.
- Short answers already complete when received use one synthesis request. Long
  answers remain bounded spoken excerpts, with full text in chat.
- A spoken interruption cancels pending generation for that turn as well as its
  audio, while preserving the call and the next utterance.
- The selected local model remains **qwen3.5:9b**. Its default reasoning is now
  **high**, and numerical questions have the native **jarvis_calculate** tool:
  bounded decimal arithmetic with 50-digit precision and an explicit rounding flag.
  The model still has to choose the correct inputs, units, and counts.
- Hashed frontend/model/worklet/WASM assets are privately cached by the browser.
  HTML, conversations, credentials, and API responses retain no-store behavior.

This reduces avoidable waiting and improves numerical verification; it is not a
promise of instant answers or uniformly correct model reasoning.

### One-shot dictation and reading

The smaller **Record dictation** microphone remains available outside a call.
Select **Stop recording**, edit the transcript, and send it. Settings can
enable **Send after dictation** and **Speak new replies** for this workflow.
**Read aloud** reads an existing answer; **Stop playback** interrupts it.

Voice is connected to the same project-aware assistant. The Medical project can
answer a dictated question using its real source-code tools and then speak the answer.

## Components connected

```text
Browser microphone
  -> Silero VAD v5 / ONNX Runtime Web (local browser, continuous conversation)
     or MediaRecorder (manual dictation)
  -> Project Hub: /api/voice/transcribe
  -> Speaches: faster-whisper (local CPU)
  -> Automatic conversational turn or editable dictation
  -> OpenClaw: local model + native project tool
  -> Assistant answer
  -> Project Hub: /api/voice/speak
  -> Speaches: Kokoro ONNX (local CPU)
  -> Browser audio playback
  -> Listen during playback for spoken interruption, or wait for the next turn
```

- [Speaches](https://github.com/speaches-ai/speaches): self-hosted speech API.
- [vad-web](https://github.com/ricky0123/vad) / [Silero VAD](https://github.com/snakers4/silero-vad): speech boundaries.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime): browser-local VAD inference.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): speech recognition.
- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx): efficient speech output.
- [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M): Apache-licensed model weights.

ElevenLabs is a proprietary service, with a free tier and paid plans. Its SDKs
being public does not make the service open source. This integration uses local
speech models and does not require an ElevenLabs account, API key, or per-character
speech API payment. Hardware/electricity and any separately selected coding/model
provider usage are separate operating costs.

Speech-service source references are cloned under `vendor/`; browser detection
uses exact npm packages and model assets in the frontend lockfile. The runtime uses the pinned
official Speaches CPU image with its packaged speech engines. The source-reference
revisions and actual runtime package versions are recorded in `SOURCES.md`.

## Models and voices

| Capability | Model / selection |
|---|---|
| Speech recognition | `Systran/faster-whisper-small`, CPU int8, four CPU threads |
| Speech output | `speaches-ai/Kokoro-82M-v1.0-ONNX` |
| Default voice | `bm_george` — British male |
| Other exposed voices | `af_heart`, `bf_emma`, `am_michael` |

The recognition model supports multiple languages, including Czech and Slovak.
The executed end-to-end voice tests used **English**. Output voices: the four
English Kokoro voices plus **Jirka · Czech male** (Piper `cs_CZ-jirka-medium`,
local ONNX, verified 2026-10-13 with a real Czech WAV). Pick Jirka in the
voice selector for Czech; Telegram voice notes in Czech answer with Jirka
automatically, and Czech chat messages get Czech replies. The voice selector
uses names confirmed in the installed model's catalog.

Speech inference stays local. Initial image/model downloads need internet access.
The model cache persists in Docker volume `jarvis-workos_voice-models`.

## Start and stop

From this repository:

```text
python scripts/start.py --gpu --voice --open
```

Install/check voice independently:

```text
python scripts/setup_voice.py
```

The speech service is an optional Compose profile. Its endpoint is
`http://127.0.0.1:18792`, authenticated with the generated local
`JARVIS_VOICE_TOKEN`. Browser requests use the Project Hub session, so this token
is not placed in browser storage or source files.

To stop all containers, including voice, while retaining their data:

```text
docker compose --profile voice down
```

The host-side Project Hub is stopped separately:

```text
python scripts/projects.py stop
```

## Behavior and limits

- Capture starts only after **Call JARVIS** or **Record dictation**.
- One microphone stream is owned for the whole call. Tracks are disabled while
  muted and during transcription, model work, and speech preparation. Detection
  resumes before playback so a confirmed user utterance can interrupt it.
- A spoken interruption cancels that turn's output and any unfinished generation,
  not the call. Tiny VAD misfires do not interrupt playback. Call cancellation
  invalidates all pending work.
- Mute affects microphone input; an already-submitted question and JARVIS's current
  answer can finish. Unmute begins fresh capture, discarding partially captured speech.
- Continuous mode ignores silence/misfires and returns to listening if STT produces
  an empty transcript. It requires at least 320 ms of detected speech, preserves
  600 ms of onset padding, and sends a long uninterrupted turn after about 55 seconds.
- The VAD model, AudioWorklet, ONNX module, and WASM all load from this local host.
  There is no speech-detection CDN request. Browser inference uses one CPU thread.
- Manual dictation remains editable unless its auto-send preference is enabled.
  The browser stops/discards manual recordings beyond its 60-second capture limit.
- The server accepts at most 10 MiB of WAV, WebM, or Ogg audio per request.
- Read-aloud accepts up to 6,000 text characters and returns WAV audio.
- A single speech request runs at a time to keep CPU use predictable.
- Switching projects/conversations/app sections or closing the page releases call
  capture, pending speech requests, and playback. A hidden tab keeps the call alive.
- Ending during a chat turn also requests native cancellation of the originating
  conversation. History remains authoritative for the remote run's final state.
- Late microphone grants and stale transcription responses cannot insert text into
  a different project's draft.
- The Call click primes the audio element for normal one-button playback. If the
  browser still blocks audio, the call offers **Enable audio** and resumes the same
  call, without another greeting or Call click. Manual reading uses native controls.
- Browser echo cancellation, noise suppression, and automatic gain control are
  requested. Synthetic tests do not establish real speakerphone echo rejection;
  physical microphone/speaker acoustics remain untested.

The 60-second browser capture limit is a UI limit; the server's independent bound
is compressed upload size and request timeout. This is a trusted single-user local
application, not a public audio-upload service.

## Latest call update verification — 2026-09-26

- **60 backend tests**, **24 frontend tests**, strict TypeScript/production build,
  Gateway config, native tool contracts, and project connectivity passed:
  `logs/project-checks-20260926T183513Z/`.
- Seven browser scenarios passed in `logs/voice-browser-2026-09-26T18-19-57-804Z/`,
  including speech starting before a controlled answer completed, mute, cancellation,
  permission/autoplay recovery, and both phone layouts. The real-call case initially
  inspected the deliberately partial first sentence too early for a full-version
  assertion. Its targeted rerun passed after waiting for the source value before
  interrupting: `logs/voice-browser-2026-09-26T18-25-07-507Z/`.
- The actual public HTTPS notebook call passed after the final response/cache
  refinements: `logs/notebook-browser-2026-09-26T18-35-54-256Z/`.
- The final six numerical examples returned the correct results; five visibly used
  `jarvis_calculate` in native history. Evidence:
  `logs/call-reasoning-20260926T181928Z/results.json`. Earlier reasoning-only failures
  are preserved. These are narrow checks, not a general intelligence benchmark.
- Native inspection initially exposed a missing calculator tool declaration in the
  plugin manifest. It was corrected, hot-reloaded at runtime generation 13, and the
  verifier now rejects missing tools/error diagnostics even if `plugins inspect`
  itself returns exit 0.
- Blue user / green JARVIS waveform screenshots and the small mobile layout were
  inspected. Audio is synthetic in browser automation; no new physical acoustic
  claim is made. The notebook URL and credential were preserved during relay reload.

## Earlier phone-call verification — 2026-09-26

- **47 backend tests**, **16 frontend tests**, strict TypeScript/production build,
  Gateway config, both native plugin runtime checks, and project connectivity passed.
  Logs: `logs/project-checks-20260926T164218Z/`.
- **All seven browser call tests passed in one run**:
  `logs/voice-browser-2026-09-26T16-37-16-899Z/`.
- The un-intercepted real call exercised one Call click, the spoken greeting,
  Medical question/answer, a second utterance injected while audio was playing,
  automatic interruption, the next answer, and hang-up. Silero, Whisper, OpenClaw,
  Kokoro, and the browser audio element were all real; microphone audio was synthetic.
  Exactly one microphone stream was acquired, two questions were submitted, and
  three speech responses were produced (greeting plus two answers). React `^19.2.8`
  was returned; the unsent typed draft survived. The test recorded zero browser errors.
- Other cases checked mute during greeting, discard of partial speech on mute,
  a simulated background-tab visibility change, origin-bound cancellation, late/
  denied microphone permission, autoplay recovery, and 390×844 / 320×568 layouts.
  API interception is used for deterministic error/cancellation cases.
- Following minor call-hint/playback-end polish, audio-recovery and both mobile
  cases passed again in `logs/voice-browser-2026-09-26T16-42-52-718Z/`.
  Mobile page-width assertions also passed in `logs/voice-browser-2026-09-26T16-43-43-588Z/`.
- Desktop and both mobile call screenshots were inspected. Physical speakerphone
  echo, headset behavior, and non-English voice quality have not been tested.

Repeat the checks with `python scripts/verify_projects.py --frontend --live`, then
`npm run test:voice` from `frontend/` against the running production host.

## Earlier chat-embedded conversation verification — 2026-09-26

This earlier interface was superseded by the phone-call experience above. Its
historical test results and limitations are retained below.

- **47 Python tests**, **14 frontend tests**, strict TypeScript/production build,
  Gateway config, both native plugin runtime checks, and project connectivity passed.
  Logs: `logs/project-checks-20260926T161213Z/`.
- A real two-turn browser test used synthetic spoken WAVs as microphone input,
  actual browser VAD, local Whisper, OpenClaw project chat, local Kokoro, and actual
  audio playback. The first question returned React `^19.2.8`; the second asked
  about project capabilities. Each answer completed and listening resumed without
  another Start click. Unsent typed text survived.
  Evidence: `logs/voice-browser-2026-09-26T16-12-36-428Z/`.
- Four additional browser cases passed after that build: actual playback interruption
  and origin-bound chat cancellation; autoplay-block fallback; late/denied permission;
  delayed transcript isolation and hidden-page cleanup.
  Evidence: `logs/voice-browser-2026-09-26T16-15-48-484Z/`.
- The mobile test's initial desktop-only selector was corrected. Its targeted rerun
  passed at 390×844 with End visible and no horizontal overflow; the screenshot was
  inspected. Evidence: `logs/voice-browser-2026-09-26T16-17-02-506Z/`.
- The first real two-turn attempt exposed an overlong capabilities reply: playback
  was still running after two minutes. Automatic speech is now explicitly bounded
  and labeled as an excerpt; full chat text remains intact. Conciseness instructions
  do not guarantee a short or correct model answer.

These six browser scenarios passed across the targeted runs above. Lifecycle
error/race cases use intercepted API responses where needed; the two-turn test uses
the real local services throughout. **Physical microphone/speaker acoustics have
not been tested.** The selected model and reasoning settings were not changed.

Repeat from the repository root:

```text
python scripts/verify_projects.py --frontend --live
```

Then, from `frontend/`, against the running production host:

```text
npx playwright install chromium
npm run test:voice
```

The optional browser suite creates synthetic conversations and retains timestamped
results, failure traces, and screenshots under `logs/voice-browser-*`.

## Earlier one-shot verification — 2026-09-26

The following checks passed:

1. Generated a 3.29-second English WAV with the local British voice.
2. Transcribed it locally and recovered the intended Medical/React question.
3. Sent that transcript through Project Hub to OpenClaw.
4. Received the correct React version with the source reference.
5. Generated a spoken WAV for the returned answer.
6. Used a synthetic Web Audio stream with the browser's **real MediaRecorder**,
   sent its WebM recording through the real transcription endpoint, and populated
   the editor with the recognized text.
7. Sent that browser transcript and received a source-backed Medical answer.
8. Verified browser audio playback advanced in time and Stop playback paused it.
9. Verified late microphone acquisition after a project switch releases tracks,
   leaves the other project's draft empty, and cancels recording.
10. Verified a synthetic permission-denial error is visible and restores controls.

Artifacts: `logs/voice-checks-20260926T095144Z/` contains the synthetic WAV,
transcript, assistant result, spoken-answer WAV, and timings. In that one run,
transcription took about 3.3 seconds and project chat about 24.7 seconds. These
are single-run observations, not a general latency or quality benchmark.

**A physical microphone and speaker were not tested.** Browser capture/playback
was checked with synthetic media in the isolated browser. Physical device selection
and actual acoustic quality remain hardware-dependent.

Repeat the automated checks:

```text
python scripts/verify_projects.py --live
python scripts/verify_voice.py --project
```

## Troubleshooting

- **Voice unavailable:** run `python scripts/setup_voice.py`, then select
  **Check voice** in the dashboard.
- **No transcript:** inspect the recording input, speak clearly, and record a
  shorter segment. Silence is not a useful transcription-quality test.
- **No automatic playback:** use the displayed audio player's Play button.
- **Busy voice:** allow the current local speech request to finish.
- **Host code was updated:** restart Project Hub after active work completes.
- **First request is slower:** the service is loading model weights. The configured
  model TTL retains loaded models for subsequent requests.
