# Voice interruption and request reliability — 2026-10-06

## Delivered behavior

- After transcription finishes, microphone detection stays active while the
  operational agent reasons. Confirmed speech interrupts the current turn;
  noise misfires do not cancel it. Mute continues to suppress input without
  discarding the answer already being prepared.
- The call screen shows actual input readiness and **“You can interrupt me”**
  while thinking. Muted input is not described as listening.
- The browser cancels one immutable request ID. An old request settling late
  cannot clear the replacement request's busy state or cancel that replacement.
- Cancellation received before the original chat request creates an owner-bound
  cancellation record. A late submission binds its input hash but stays cancelled;
  different input cannot subsequently reuse that identity.
- A cancelled running turn leaves a fixed, authoritative history notice after its
  execution settles. Pending notices survive restart and are written once. The
  model can distinguish interrupted work from unfinished work it should resume.
- Intentional model cancellations are counted separately from failures. The
  model-call latency median includes completed calls only, so frequent interruption
  does not produce a misleading failure rate or artificially low latency.

Already admitted actions retain their own recorded outcomes. Stopping a turn
does not claim to undo a completed file, send or other effect.

## Actual public-browser workflow

The isolated browser used normal autoplay policy and synthetic PCM speech:

1. Open the authenticated notebook Tasks page and create a fresh conversation.
2. Call JARVIS and play a source-inspection request concerning Medical's SDK and
   frontend versions.
3. Verify the real backend run is **running** and the visible call is thinking
   with live microphone detection.
4. Speak a replacement request: use the calculator for seven times six.
5. Observe exactly one request-specific cancellation and one replacement chat.
6. Verify the old run is **cancelled**, the replacement is **completed**, and its
   actual tool result is from `jarvis_calculate`, without resuming source reads.
7. Hear **“42”**, hang up and verify released microphone tracks.

Both browser runs passed with no page errors. The final run also verified model
telemetry deltas of **2 calls, 1 cancellation, 0 failures**.

Replacement-utterance end to audible answer was **7.961 seconds** in the first
run and **5.062 seconds** in the final run. These are two samples of this workflow,
not a general speedup claim or a 1–2-second response qualification. Native media
acquisition was checked separately using full Chromium with synthetic microphone
hardware; that test reached listening and released tracks. Physical notebook
microphone/speaker behavior still needs the user's own-device test.

## Request/state contract

New endpoint: `POST /api/conversations/:id/runs/:runId/cancel`, with an empty JSON
body. It requires the existing authenticated actor, matching conversation/run
ownership, Origin and CSRF. It is explicitly proxied through the Hub and task-mode
notebook route allowlist. The conversation-wide cancellation endpoint remains
available for its existing explicit callers; ordinary Tasks interruption uses
the request-bound endpoint.

Cancellation before admission cannot enqueue the original request later. A
delayed cancellation cannot abort a newer run in the same conversation. Completed
results are preserved. Cancellation notices use the existing encrypted record
store and transactional finalization/recovery. Working history replays only the
fixed `request_cancelled` notice with its exact approved text; arbitrary persisted
system instructions continue to be discarded.

## GPU batching experiment

The same Qwen3.8 model, xhigh reasoning, 32K context and 8K output budget were
tested with batch sizes 256 and 512, using seed 42 and voice delivery. Each run
used an isolated synthetic tenant/database and verified actual arithmetic, a
created spreadsheet with total 219, and a saved Czech ten-minute reminder.

| Completed task | Batch 256 | Batch 512 |
| --- | ---: | ---: |
| Arithmetic | 9.083 s | 74.951 s, including 67.237 s runner loading |
| Spreadsheet | 20.566 s | 26.767 s |
| Czech reminder | 6.210 s | 6.855 s |

Both passed 3/3. Prompt processing and output lengths varied; batch 512 did not
show a consistent completed-work advantage. **Batch 256 was restored.** Model,
reasoning and context selection were not changed. A larger hardware setting is
not accepted solely because its individual prefill measurement looks better.
Experiments can reload a shared inference runner; repeat only when its consumers
are idle.

## Evidence

Paths are relative to `C:/Users/Matko/Jarvis-WorkOS`:

| Check | Evidence |
| --- | --- |
| Before-change paused-microphone regression | `logs/thinking-interruption-before.log` |
| Initial cancellation endpoint tests and subsequent fixture corrections | `logs/operator-check-2026-10-06T10-46-39-935Z/`, `logs/operator-check-2026-10-06T10-55-35-319Z/` |
| Before-change cancellation telemetry tests | `logs/cancellation-metrics-before.log` |
| Final 64 operator tests, one build guard and build | `logs/operator-check-2026-10-06T11-19-26-733Z/` |
| Final 99 Python/Hub tests, 39 frontend tests, syntax checks and frontend build | `logs/project-checks-20261006T111926Z/` |
| Initial public interruption proof | `logs/voice-interruption-2026-10-06T11-07-41-059Z/results.json` |
| Final public interruption/telemetry proof | `logs/voice-interruption-2026-10-06T11-20-59-425Z/results.json` |
| Actual native-media startup | `logs/call-startup-2026-10-06T11-12-44-086Z/results.json` |
| Batch 256 / 512 comparisons | `logs/model-benchmark-2026-10-06T10-38-07-760Z/results.json`, `logs/model-benchmark-2026-10-06T10-39-01-620Z/results.json` |
| Restored default batch warmup | `logs/gpu-batch-restored-256.log` (PowerShell UTF-16 log) |

The early actor-scope fixture was corrected to create an actor through the
administrator path and supply a valid Origin for an unauthenticated POST. Those
fixture failures are retained alongside the actual missing-route/input-state
regressions. The final tests include pre-admission cancellation, stale cancellation
against an active successor, actor isolation, completed-result preservation,
restart/lost-ack notice idempotence, mute, stale audio and private telemetry.

## Repeat

```text
npm --prefix operator run check
python -B scripts/verify_projects.py --frontend
node operator/scripts/prove-interruption.mjs --notebook
node operator/scripts/probe-call-startup.mjs --notebook
```

Implementation: `operator/src/{runs,store-worker,working-memory,server,model-metrics}.ts`,
`frontend/src/{taskRequests,voiceConversation,CallScreen,OperatorPanel}.{ts,tsx}`,
and `project_hub/operator_client.py`. The active notebook link must be unexpired
for the public proofs. Permanent remote access remains a separate domain/account
configuration requirement.
