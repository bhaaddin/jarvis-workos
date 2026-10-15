# Notebook voice startup repair — 2026-10-01

## Reported failure and reproduction

The user saw an indefinite **Connecting to JARVIS** screen while the speaker
cards incorrectly said **Ready to speak / Listening to you**. A reachable login
page did not establish that a call could acquire a microphone and play audio.

The old startup loaded the speech engine before requesting a microphone. It had
no deadline for microphone permission, AudioContext startup or engine loading.
An unanswered `getUserMedia` request reproduced the same stuck screen through the
authenticated public link. Browser permission promises may remain pending until
the user responds: [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
The screenshot alone does not establish the physical notebook's permission/device
state; that state was not remotely inspected.

Previous full voice proofs supplied a synthetic MediaStream and disabled autoplay
restrictions. They tested the speech/agent pipeline, not native microphone
acquisition under normal browser audio policy. The new startup probe uses full
Chromium, the real media API and normal autoplay policy with synthetic microphone
hardware. The installed Windows headless-shell package rejected native capture
with `NotSupportedError`; a direct constraint matrix succeeded in full Chromium.

## Repair

- Request microphone permission during the Call click, before speech-model/WASM
  loading, and keep the track disabled while the engine initializes.
- Preserve audio activation from the click and display separate microphone,
  browser-audio and speech-engine stages.
- Bound permission waiting to 30 seconds, browser audio to 10 seconds and engine
  initialization to 45 seconds. These are stage limits, not latency promises.
- Abort startup on timeout/hang-up, close audio, stop streams arriving after
  cancellation and discard stale startup callbacks. Reuse one acquired stream
  for the connected call.
- Provide specific blocked/missing/unreadable microphone messages and an explicit
  **Try call again** action. Startup/error cards and footer do not claim readiness.

Implementation: `frontend/src/{useVoice,speechDetector,voiceConversation}.ts`,
`CallScreen.tsx` and its operator/legacy call sites. No inference-model downgrade
or business-authorization change is involved.

## Retained evidence

Paths are relative to `C:/Users/Matko/Jarvis-WorkOS`.

| Check | Result | Artifact |
| --- | --- | --- |
| Before-fix ignored permission | Still `starting` after the probe's 70-second wait; failed | `logs/call-startup-2026-10-01T14-55-34-129Z/results.json` |
| Before-fix targeted regressions | Three failures: unbounded microphone wait, unbounded audio startup and false readiness labels | `logs/call-startup-regression-before.log` |
| Native media constraint matrix | Full Chromium passed plain, processed and unprocessed audio; headless-shell rejected all three | `logs/call-startup-2026-10-01T15-00-37-641Z/results.json`, `logs/call-startup-2026-10-01T15-00-37-573Z/results.json` |
| Before-fix granted-permission control | Native API/default audio policy could connect when permission completed | `logs/call-startup-2026-10-01T15-03-03-616Z/results.json` |
| Regression/build checks | 95 Python/Hub tests, 32 frontend tests, syntax checks and frontend build passed | `logs/project-checks-20261001T150723Z/` |
| Deployed public-link startup | Immediate native microphone request, visible loading stage, real greeting playback, listening and released tracks; no browser errors | `logs/call-startup-2026-10-01T15-08-13-731Z/results.json` |
| Deployed timeout/late permission/retry | Actionable timeout at 30 seconds; audio closed; late acquired tracks stopped; Try call again connected; hang-up released tracks | `logs/call-startup-2026-10-01T15-08-14-091Z/results.json` |
| Complete public spoken turn | Recognized the synthetic arithmetic question, invoked `jarvis_calculate`, spoke **355**, released tracks; no browser errors | `logs/task-voice-2026-10-01T15-09-33-723Z/results.json` |

Fresh-browser engine initialization took about **10.3 seconds**; the greeting
then played and the call entered listening. The complete spoken-turn test measured
**14.158 seconds from utterance end to audible answer**, including an actual
10.051-second agent run. It remains a synthetic-audio pipeline test; native media
startup is verified separately above. Physical notebook microphone/speaker behavior
requires the user's browser test. Neither result establishes instant startup or a
1–2-second spoken response.

## Repeat

With the current private notebook link and services running:

```text
python -B scripts/verify_projects.py --frontend
node operator/scripts/probe-call-startup.mjs --notebook
node operator/scripts/probe-call-startup.mjs --notebook --ignore-permission
node operator/scripts/prove-voice.mjs --notebook
```

The ignored-permission probe deliberately holds the first request, checks timeout
and late-stream cleanup, then uses the real media API on retry. The regular probe
uses native capture from the start. Both use isolated contexts and retain only
synthetic/status evidence, without Authorization headers, credentials or traces.
