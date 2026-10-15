# Voice startup speed — 2026-10-03

## Delivered changes

- Compress immutable speech-engine/build assets on the PC before they enter the
  tunnel. Cloudflare was already compressing the browser-facing response, but the
  origin relay still uploaded the full 14.24 MB WASM file. Compression now covers
  that upstream transfer as well.
- Cache compressed bytes by content hash, bounded to 16 MiB/32 entries. Honor
  `Accept-Encoding`, including explicit gzip opt-out, and send `Vary`. Pages, API
  responses, conversations, artifacts and voice audio are outside this cache.
- Task-mode notebook startup uses the existing native model/speech preparation
  before publishing or reusing a link. A healthy Node listener alone does not
  establish a loaded model. On this day's initial check the model was cold; the
  explicit warmup printed **77.106 seconds**. That preparation now happens before
  the helper announces readiness, rather than on the first spoken request.
- The Desktop Notebook launcher calls this path once, avoiding the preceding
  legacy-stack launch and duplicate warmup. The spoken greeting is shortened to
  **“Hi, I'm Jarvis.”**

Qwen3.8-27B, xhigh reasoning, 32K context and the 8K output budget are unchanged.
No intent regex shortcuts or canned task answers were introduced.

## Measured public-link results

Both startup runs used a fresh full-Chromium context, the actual browser media
API, synthetic microphone hardware and normal autoplay policy. Phase timestamps
are sampled every 250 ms. The first row measures from the first observed
`starting` phase through the end of the greeting and entry into `listening`;
it excludes page navigation and is not spoken-answer latency.

| Measurement | Before | After |
| --- | ---: | ---: |
| Call startup to listening | approximately 16.85 s | approximately 7.16 s |
| Speech-engine loading stage | approximately 10.34 s | approximately 4.29 s |
| WASM resource transfer duration | 7.456 s | 2.367 s |
| Browser-decoded WASM bytes | 14,239,897 | 14,239,897 |

The browser received roughly 3.66 MB of encoded WASM both times. Looking only at
those downstream sizes would have missed the upstream uncompressed transfer.
The retained before/after probes both completed real greeting playback, entered
listening, released microphone tracks and reported no browser errors. These are
individual measurements on this connection, not a general latency guarantee.

### Complete spoken answer

The final synthetic question **“What is 12 times 25 plus 11 times 5?”** was
transcribed, executed through the real calculator and answered aloud as **355**.
Utterance-end to audible answer was **10.874 seconds**; agent execution was
**7.432 seconds**. Numeric profiling attributed about **3.702 seconds** to prompt
processing and **3.431 seconds** to generation. This still does not meet a
1–2-second conversational-response target. The startup improvement is not a
claim that model answers became equally faster.

## Evidence

Paths are relative to `C:/Users/Matko/Jarvis-WorkOS`:

- Before startup/assets: `logs/call-startup-2026-10-03T11-28-55-217Z/results.json`.
- Before numeric/model state: `logs/voice-profile-2026-10-03T11-28-55-253Z/results.json`.
- Failing compression regression before implementation: `logs/voice-speed-before.log`.
- Final checks: `logs/project-checks-20261003T114244Z/` — **99 Python/Hub tests,
  32 frontend tests, syntax checks and frontend build passed**.
- Actual revised startup/reuse: `logs/native-start-20261003T114352740181Z/` — model
  and speech services, actual speech warmup and native inference warmup passed;
  the existing public URL/credential were preserved during this reuse.
- After startup/assets: `logs/call-startup-2026-10-03T11-44-38-560Z/results.json`.
- Spoken turn: `logs/task-voice-2026-10-03T11-46-06-638Z/results.json`.
- Final numeric model profile: `logs/voice-profile-2026-10-03T11-46-52-205Z/results.json`.

Source: `project_hub/remote_call.py`, `scripts/remote_call.py`,
`frontend/src/voiceConversation.ts`, `operator/scripts/probe-call-startup.mjs`,
`operator/scripts/profile-voice.mjs`, and the Desktop `JARVIS Notebook.cmd`.
Regression checks also cover failed readiness preserving existing access,
idempotent link reuse, unchanged private response bodies and explicit encoding
opt-out. No patient/account data is used in these measurements.

## Repeat

```text
python -B scripts/remote_call.py start --tasks
node operator/scripts/probe-call-startup.mjs --notebook
node operator/scripts/prove-voice.mjs --notebook
node operator/scripts/profile-voice.mjs
```

The task helper now prepares its own native services. A genuinely cold start can
still take time before the access card is ready. Permanent remote access remains
a separate domain/account decision; the current temporary link still expires.
