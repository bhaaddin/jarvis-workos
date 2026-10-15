# Call JARVIS from the notebook

## Why the TeamViewer call failed

Matko uses a notebook at another location to control the powerful PC through
TeamViewer. The browser shown inside that remote desktop runs on the powerful PC.
Its microphone API therefore looks for **that PC's** input devices.

On 2026-09-26, Windows diagnostics on the PC reported two audio output endpoints
and no microphone input endpoint, with both Windows audio services running. This
explains the browser's **Requested device not found** error. Synthetic microphone
tests did not test that hardware boundary.

The notebook call page must run in the notebook's own browser. AI processing stays
on the powerful PC; the notebook supplies its microphone and speakers.

## Fast test

1. Keep JARVIS and its services running on the powerful PC.
2. On that PC, double-click **JARVIS Notebook.cmd** on the Desktop.
3. The generated **JARVIS Notebook Access.html** page shows the current HTTPS
   address, username, and password. Copy those details using TeamViewer.
4. Minimize TeamViewer on the notebook and open **Chrome or Edge on the notebook**.
5. Paste the HTTPS address and enter the displayed username/password.
6. Press **Call JARVIS** and allow microphone access on the notebook.

The task-mode helper now starts and warms the selected native model and speech
services before declaring access ready. The Desktop launcher uses this single
path. A cold model may take about a minute to prepare on the PC; it should not be
left for your first question to load.

Do not use `127.0.0.1:18791` on the notebook: that address refers to the notebook
itself. Use the generated HTTPS address. Keep the generated password private.

The default test link expires after eight hours. Running the Desktop helper again
reuses a healthy unexpired connection or safely retires the old connector and
creates a new link. The address changes when a new tunnel is created.

### If a call does not connect

The 2026-10-01 startup fix requests microphone access immediately, before loading
speech detection. Refresh an already-open page to receive the fix. The call now
shows the actual startup step:

- **Waiting for microphone permission:** choose Allow in the browser prompt. If
  no prompt is visible, check this site's microphone permission beside the address
  bar. A browser running inside TeamViewer still uses the remote PC's devices.
- **Loading speech detection:** permission has been granted; the first call loads
  the browser speech engine. The input remains paused until the engine is ready.
  After the 2026-10-03 transfer optimization, this took about 4.3 seconds in the
  fresh-browser test, down from about 10.3 seconds.
- **Starting browser audio:** the browser is preparing microphone capture/output.

An unanswered permission request now ends after 30 seconds with instructions and
**Try call again**. Audio and engine initialization have their own bounded waits.
Hang-up/timeout releases resources; a late permission grant cannot revive the old
call. The screen no longer claims to be listening while it is still connecting.

Actual public-link startup, timeout/retry and spoken-turn evidence:
[voice startup verification](docs/VOICE-STARTUP-VERIFICATION.md).

The later [speed verification](docs/VOICE-SPEED-VERIFICATION.md) records roughly
17-to-7-second call startup, separate spoken-answer timing and remaining limits.

### Interrupt or correct a question

When the call says **Thinking** and **You can interrupt me**, speak your replacement
question. JARVIS now cancels the unfinished request and handles the new one in the
same conversation. The microphone card shows whether input is currently active;
transcription and speech preparation can briefly pause capture. Mute suppresses
your input while allowing the existing answer to finish.

A delayed cancellation is bound to the old request, not the entire conversation.
Already performed actions keep their own recorded state; check results before
repeating an action. A **Task update** records interrupted work, including after
recovery. [Interruption verification](docs/VOICE-INTERRUPTION-VERIFICATION.md)
contains the actual public-link test and remaining latency limits.

## Connection and scope

```text
Notebook microphone/browser
  -> authenticated HTTPS via Cloudflare Quick Tunnel
  -> loopback notebook relay, port 18794
  -> local Project Hub, port 18791
  -> existing local speech models and assistant
```

- The user explicitly selected this relay for the fastest cross-location test.
- Audio, questions, and replies pass through Cloudflare; model inference stays on
  the PC. This is a temporary testing connection, not a production deployment.
- Every relay route requires a generated high-entropy HTTP Basic credential.
  Only the local access card and ignored `runtime/notebook-call.json` store it.
  The private Hub cookie stays inside the relay and is not returned to the notebook.
- Host/Origin checks and a method/path allowlist limit the relay to conversations,
  voice, selected read-only state, and frontend assets. Installation, project
  connection, process-launch, and shutdown HTTP endpoints are blocked. Chat retains
  the assistant's configured tools; this is not a separate agent sandbox.
- Quick Tunnels do not support SSE. Voice calls use short JSON polls over an
  admitted native streamed turn, so completed sentences can arrive before the
  final answer. Ordinary notebook text chat uses complete JSON replies; local
  text chat retains SSE.
- Hashed UI/VAD assets are cached privately in the browser to avoid repeated large
  downloads. HTML and authenticated API data remain no-store.
- No router forwarding or Windows firewall opening is needed. Both HTTP listeners
  remain unchanged in their existing scope; the new relay binds to loopback only.

## Commands

From the repository root:

```text
python scripts/remote_call.py start --tasks --open
python scripts/remote_call.py stop
python scripts/remote_call.py reload-relay
```

Stop revokes the credential, checks recorded process creation times before stopping
the two owned connector processes, and removes generated access details. It does
not stop JARVIS, Ollama, OpenClaw, n8n, or the speech service.
`reload-relay` updates only the owned loopback relay while preserving the active
notebook address and sign-in details.

The connector is pinned to official `cloudflared` **2026.9.3**, Windows amd64,
SHA-256 `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`.
The download/cache is checked against that digest before launch.

## Actual verification — 2026-09-26

The latest basic-response fix passed **74 backend / 26 frontend tests** and real
HTTPS weather/call checks. Completed text replies were **1.2–2.7 seconds** in the
five-query run; the full synthetic-microphone weather reply began audibly after
**7.545 seconds**. These are different timing boundaries; see [PERFORMANCE.md](PERFORMANCE.md).

The latest incremental voice path passed **60 backend / 24 frontend tests** and
the actual HTTPS call test; logs are in `logs/project-checks-20260926T183513Z/`
and `logs/notebook-browser-2026-09-26T18-35-54-256Z/`. See [VOICE.md](VOICE.md) for
speaker graphics, early-sentence delivery, and numerical reasoning evidence.
The initial notebook-link checks are retained below.

- **53 Python tests**, **17 frontend tests**, TypeScript/production build, Gateway
  config, both native plugin checks, and project connectivity passed.
  Logs: `logs/project-checks-20260926T173726Z/`.
- The public HTTPS test passed: anonymous requests were rejected; authenticated
  access rendered the call UI in a secure context; management routes were denied;
  a real greeting and synthetic microphone turn crossed the public relay, reached
  local transcription and assistant inference, and produced real speech playback.
  Hang-up released the captured tracks, and there were no browser page errors.
  Evidence: `logs/notebook-browser-2026-09-26T17-39-25-408Z/`.
- This test ran in an isolated browser with synthetic audio. The user's notebook
  microphone and physical speaker echo still require the notebook-side test above.
- Traces/HAR capture are disabled for the live authenticated test so its credentials
  are not recorded in network artifacts. The screenshot contains only the call UI.

Repeat with `npm run test:notebook` from `frontend/` while a notebook link is active.

References:
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3
