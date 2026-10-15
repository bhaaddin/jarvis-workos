# JARVIS Tasks — usable jobs

**Vercel-ready web, 2026-10-15:** frontend builds for Vercel (`frontend/vercel.json`, root = `frontend/`). `VITE_API_BASE` points the build at any backend origin; `VITE_PORTAL_DEMO=true` builds the labeled sales-demo portals (synthetic Czech trades-firm content, DEMO banner, all actions disabled — no backend needed). Live local `dist/` restored after the demo-build check. Verified: 42 frontend tests green, live + demo builds stamped. Live portals on Vercel still need an exposed backend (M1: VPS/hosting + domain + HTTPS + CORS/cookie work) — demo needs nothing.

**Social sign-in update, 2026-10-09:** finish login and verification in each
dedicated platform window; JARVIS now saves the ready session automatically.
Manual Save remains a fallback. Closed or expired attempts cannot affect a new
sign-in. [Connection workflow and evidence](SOCIAL-CONTACTS.md).

**Telegram + phone calls, 2026-10-09:** a dedicated JARVIS Telegram bridge is
connected (@Bahaoanabot) — text and voice notes reach this same Tasks brain,
with a 📞 Call JARVIS button opening the existing call page and Approve/Deny
buttons for consequential actions. Setup and power details:
[the Telegram guide](TELEGRAM.md). Direct phone-browser calls work today via
`JARVIS Notebook.cmd`; real WhatsApp calling follows the Meta route below.

**Coding from your phone, 2026-10-12:** all 12 personal GitHub repos are
cloned and connected as working projects. `jarvis_code_read` reads source
directly; `jarvis_code` edits files and runs builds/tests only after your
tap (Approve/Deny buttons on Telegram). Plain git (status/pull/commit/push)
is allowed with approval; `--force` pushes, hard resets and destructive
shell commands stay refused. Credential files and VCS/generated folders
are refused.

**Mail powers + research verdict, 2026-10-13:** `jarvis_mail` (read) and
`jarvis_send_email` (tap-approved) are live; Gmail connects via `/paswerd`
or the Tasks email card, stored encrypted, message deleted after use.
Morning inbox-watch schedule goes in right after the mailbox connects.
Researched Gmail MCP servers (GongRzhe, google_workspace_mcp 3.3K) and
Google's official CLI (31K): all need Google OAuth app setup, so none beats
the working IMAP/SMTP path without your Cloud-console work — parked, not
installed.

**Fast lane + restrictions + auto-talk, 2026-10-14:** Telegram answers
`what can you do`, `is X running` and time questions directly from tools
(~1–2s, zero model turns). Per-project code access `off|ask` via
`/code` from the phone. One-click links auto-open the call UI and scrub
the token from the address bar. Local SearXNG search service deployed
(loopback only) with JSON enabled for the searxng skill. 100 operator +
39 frontend + 51 Python tests green. Single bridge poller enforced (fixed
a PID-file bug that ran two and caused 409s).

**Acceptance 8/8 + GPU fix, 2026-10-14:** the owner's failure list runs green
(`scripts/acceptance.py`, evidence in docs/ACCEPTANCE.md). Found and fixed a
real wedge: 5-day GPU ghost state killed every model call at 180s; unload +
warm reload restored 1.4s answers. Bus agent answers in Czech with real
departures. Mail still waits for your `/paswerd`.

**Transit + error honesty, 2026-10-14:** `jarvis_transit` answers bus questions
in ~0.2s (PID stop register + free Transitous router, 9s budget, one-sentence
answer + map link, asks once on ambiguity, never flails). Telegram errors are
human now (dropped connection / too slow / refused — cause + next step, no
raw `RuntimeError`). Outbox retries unsent replies instead of losing them.

**One-click calls + Czech tools + army plan, 2026-10-13 (night):** `/call`
gives a signed one-click link — tap and talk, no username/password typing
(10-minute token, cookie session, verified live over public HTTPS).
New live skills: `jarvis_ares` (real company lookup), `jarvis_cnb` (real
daily rates), `jarvis_czech_calc` (IČO/IBAN/QR platba/workdays/holidays),
`jarvis_owner_todo` (your unblock checklist). Full suite 96/96.
[Army design](docs/ARMY.md): plan-first orchestration, lazy tool domains,
honest limits (no in-messenger calls, no live trading without a rule
change, PC sleep bounds 24/7).

**Security scans from your phone, 2026-10-13:** `jarvis_code` grew a `scan
operation (Semgrep 1.180.0, private `p/security-audit` + `p/secrets`
rulesets, metrics off, nothing leaves the PC). Approval-gated like edits.
Live proof: test-simple scanned after tap-approve — 1 file, 0 findings,
4.1s end to end. Semgrep's `--config auto` was rejected (it demands metrics
on); fixed rulesets were verified to work privately.

**Reference research, 2026-10-13:** mem0 (67k stars, Apache-2.0) cloned as a
source-only reference for a future memory upgrade — its vector-DB + LLM
extractor needs are too heavy to adopt today. Semgrep (17k stars, LGPL-2.1)
adopted as a *tool*, not embedded code. SmolAgents reviewed and skipped:
it duplicates the operator's own tested agent loop.

**Gateway skills installed, 2026-10-13:** all 10 catalog picks plus prompt-guard
are installed through the Skills-library backend; 8 are enabled and ready
(skill-vetter, prompt-guard, ddgs-search, self-improving proactive agent,
cognitive-memory, browser-use, automation-workflows, data-analysis).
Second wave, also ready: elite-longterm-memory-local, searxng,
memory-manager, memory-hygiene, markdown-converter, rss-reader,
playwright-mcp (via an npx shim; container-ephemeral, browsers not
installed), ocr-local. Live proof: the gateway agent answered a real
ddgs-search query. `Translate` installed but stays disabled (commercial
clawic.com skill, external data-home design, agent-filter block — forcing
it is not worth it). Still blocked: `elite-longterm-memory`
(`OPENAI_API_KEY`), `exa-search` (`EXA_API_KEY` — the "no key needed"
claim was wrong), `neural-memory` (no pip in container).

**Girlfriend persona, 2026-10-13:** voice speaks warm and affectionate like
a loving girlfriend on the phone (Czech with Czech, English with English);
Telegram small talk matches, work stays professional. Sincerity rule kept:
asked directly, he says he is JARVIS, an AI. Live proof: "Ahoj, jak se
máš?" → warm Czech reply in 5.9s. Enabled means the gateway's own
requirement checks pass; only ddgs-search has a live functional proof.
These extend the Gateway assistant, not the Tasks brain you talk to on
Telegram — that distinction stands. More skills also mean more model load;
speed complaints point at the 27B, not at missing skills.

**WhatsApp calling, 2026-10-12:** Meta Business Calling API adapter
scaffolded and tested (webhook verification, signed events, call
lifecycle); live calls need your Meta checklist in
[WHATSAPP-CALLING.md](WHATSAPP-CALLING.md) plus stable ingress and the
WebRTC media bridge.

**Finance connection, 2026-10-08:** choose **Finance** beside Assistant for the
paper wallet, locked study, historical result list, dated prices and headlines.
Existing Tasks and Talk use the same direct read-only connection. Cards read
without a model hop; Qwen3.8/xhigh is preserved for conversations.
[Connection guide](FINANCE.md) · [actual latency and verification](docs/FINANCE-VERIFICATION.md).

**Social contacts, 2026-10-06:** a new workspace connects dedicated Instagram and
TikTok sessions, researches profiles, saves source-backed public contacts, drafts
outreach, tracks contacted status and exports CSV. Open **Social contacts** beside
Assistant. Account sign-in and the real-platform search remain separate activation
checks; [the social guide](SOCIAL-CONTACTS.md) states exactly what was verified.

**Conversation update, 2026-10-06:** you can interrupt while JARVIS is thinking and
ask a replacement question. Cancellation targets that request, so delayed network
responses cannot stop the next question. Interrupted work gets a durable task
update; cancellation counts are separate from model failures.
[Actual public-call verification](docs/VOICE-INTERRUPTION-VERIFICATION.md).

**Speed update, 2026-10-03:** notebook startup now preloads the model/speech services
and compresses speech assets before the tunnel. Fresh-browser call startup measured
about 7 seconds versus 17; the final spoken-answer sample was still 10.9 seconds.
[Measured speed and remaining delay](docs/VOICE-SPEED-VERIFICATION.md).

**Voice startup repair, 2026-10-01:** microphone permission is requested immediately;
connection stages, bounded waits and retry replace the indefinite Connecting
screen. Refresh an open notebook tab. [Startup and spoken-turn evidence](docs/VOICE-STARTUP-VERIFICATION.md).

**Environment update,2026-10-01:** the Tasks sidebar now includes model-aware
runtime diagnostics and timing. Source-checked setup, lean native startup and
guarded GPU standby/wake are documented in [DEVELOPMENT.md](DEVELOPMENT.md).

**Connections update, 2026-10-01:** the Projects view now includes 42 registered
clones, source requirements and explicit runtime checks. Use **Projects &
connections** from the notebook as well. [Project guide](PROJECTS.md) and
[verified connection inventory](docs/CONNECTIONS-VERIFICATION.md).

**Open on the PC:** <http://127.0.0.1:18791/#operator>, or Desktop `JARVIS.cmd`.

**Open on the notebook:** Desktop `JARVIS Notebook.cmd` prepares the services and
opens the private `JARVIS Notebook Access.html` card. Copy its HTTPS address into
Chrome/Edge on the notebook, outside TeamViewer, and use the separate credentials
on that card. The authenticated task link expires after eight hours. Temporary
URLs/passwords are not stored in this guide.

The task agent is now connected to the actual Command Center, including its call
screen. This page executes jobs through the Node operator and displays owned
downloads, approval arguments/results, tasks/reminders and account connections.
The older project-specific chat remains under **Project chat**.

**Current upgrade,2026-09-30:** Tasks uses **Qwen3.8-27B** with native local inference,
32K context and xhigh reasoning. GPU assignment and actual device memory are
reported separately in Runtime & resources. The harder work
qualification improved from3/6 to6/6 checked scenarios. It now analyzes uploaded
tables with DuckDB and exports checked results directly into real files. Current
selection, complete evidence, verifier correction and actual latency:
[quality upgrade](docs/OPERATOR-QUALITY-UPGRADE.md).

## Try real jobs

| Ask JARVIS | What it uses |
| --- | --- |
| “Create an Excel spending sheet: groceries 85, transport 24, utilities 110. Add the total and give me the file.” | Real XLSX writer, Decimal totals, read-back preview and authenticated download |
| “Create a PDF/Word report from these notes.” | ReportLab / python-docx; actual PDF/DOCX output, not a proposed template |
| Attach a PDF/DOCX/XLSX/CSV and ask for a summary or calculation | Protected upload, bounded document/table extraction, paged observations and calculator |
| “Reconcile these invoice/payment CSVs, keep currencies separate, and create Excel and a PDF.” | Bounded DuckDB joins/filtering/exact decimals; actor-owned query results can be transferred directly to files |
| “Find the invoice files in Downloads.” | Named allowed file roots, filename search and metadata; credential/database exclusions |
| “Check which Claude, OpenCode or node processes are running. Report RAM and disk space.” | Actual Windows process and CIM inspection |
| “Read Medical’s frontend React version and cite the source.” | Existing authenticated Project Hub source reader and project instructions |
| “Read upstream-ollama's go.mod and check its runtime connection.” | Registered clone source, exact project/root citations and declared runtime metadata probe |
| “List my GitHub repositories/issues/pull requests.” | The PC’s existing authenticated `gh` account |
| “Read this public page” / “Search the web for …” | Fresh isolated Playwright browser, DNS-pinned public requests, actual links/text |
| “Fill this public form with these values and submit it.” | Proposed explicit browser steps; approval before external interaction, observed final page |
| “Run JavaScript to analyze these JSON values.” | Approval-controlled Docker execution, no network/host mounts/credentials, bounded resources/output/deadline |
| “Remind me in 10 minutes to review invoices.” | Server-clock relative reminder, persistent due notification and completion control |
| “Remember this preference” | Protected long-term memory across service restarts |

For spreadsheets, the tool’s `totalColumns` parameter selects the numeric columns
to sum. It writes the total into the file and reads the file back. Download links
come from authoritative artifact receipts; the model cannot change their host.

For table-analysis results, `tableObservationId` transfers the verified columns
and rows into the output instead of relying on model transcription. Reports do
not need spreadsheet-only arguments, and a missing filename extension is appended.
The task UI shows real progress and the selected model.

Generated-code output can feed a subsequent document-creation step. The executor
is JavaScript in an actual isolated container, not unrestricted Windows shell
access. Source inspection does not grant permission to edit a coordinator-only
Medical checkout.

Image-only PDFs report `needs_ocr`; OCR is not silently fabricated. Uploaded files
are limited to 20 MiB. Personal Documents/Downloads/Desktop roots require the
specific personal-file permission; other accounts receive their own inbox and
artifact roots.

## Connect real business accounts

### SportMedical

Use the **SportMedical** card in JARVIS Tasks with the existing clinic email and
password. The connector uses the actual `/api/v1/session` contract and stores the
returned session encrypted; the password is not retained.

The connector discovers the running API profile and exposes only advertised,
reviewed read operations. Registration agenda reads use scheduling appointments;
newer Booking APIs can expose day/summary/calendars/activities. Bounded patient
searches, dashboard reads, invoices and prices depend on the detected routes.
`today` and `tomorrow` use Prague DST-aware bounds. Multiple patient matches need
clarification; missing appointment prices stay unknown.

**Current connection check, 2026-10-01:** API5092 is reachable and returns HTTP 401
to the anonymous `/openapi/v1.json` probe. The registry correctly reports
`authentication_required`; it has not retrieved an authenticated contract or
activated a clinic account. The clinic connector requires a reviewed running
contract before using login credentials. See [connection verification](docs/CONNECTIONS-VERIFICATION.md).

Historical Sept30 qualification found an old DLL failing the anonymous-access
check and a detached source build failing on two CA1711 errors; those reports do
not establish the current deployed API's identity. The read-only assistant cannot
rebook/create/change records, including after sign-in. Real protected reads and
clinical authorization still need qualification against a recognized API and
authorized account.

### Email

Open **Email** and enter the IMAP host, mailbox username and password/app password.
IMAP uses TLS on port 993. Optional SMTP uses TLS 465 or required STARTTLS 587.
Successful IMAP authentication is checked before storing the encrypted connection.

The adapter can list folders/messages, search and read messages, download supported
attachments into owned storage, and propose an actual email with owned attachments.
Attachment IDs/digests are bound to the send; total outbound attachments are
limited to 10 MiB. SMTP acceptance is not a delivery receipt. Ambiguous sends are
not blindly repeated. Sender claims and email bodies remain untrusted input.

OAuth-only providers still require that provider’s OAuth setup; an assistant
subscription does not supply mailbox access. No real inbox was read and no real
email was sent during qualification. Connect the account to activate those jobs.

Changing an account connection changes the actor revision so pending approvals
cannot silently execute against a different account configuration.

## Verified jobs and evidence

Evidence below is relative to `C:/Users/Matko/Jarvis-WorkOS`.

Latest connection checkpoint, 2026-10-01: **57 operator tests plus one build guard,
95 Hub/backend tests, 27 frontend tests and both TypeScript builds passed**.
Actual clone source access and host/Gateway/CLI/notebook paths were verified:
[connection evidence](docs/CONNECTIONS-VERIFICATION.md).

The Sept30 model upgrade additionally checked multi-file financial reconciliation,
long-document policy retrieval, follow-up budgeting, source analysis and actual
UI table-to-Excel/PDF work. Its evidence and failed candidate
comparisons are linked in [the quality report](docs/OPERATOR-QUALITY-UPGRADE.md).
The following Sept27/28
records remain the original task-pack qualification history.

- Real UI process inspection, including the actual operator process ID:
  `logs/task-jobs-2026-09-27T21-53-27-263Z/results.json`.
- Real UI Excel creation/download with a reopened **219** total, actual React
  source/version, public page, authenticated GitHub and a saved reminder:
  `logs/task-jobs-2026-09-27T21-57-07-554Z/results.json`. This cohort intentionally
  resumed at the file job; process inspection has its separate evidence above.
- Actual approval UI → isolated code → stdout total219, UID65534, loopback-only
  interfaces, no host credentials, container removed:
  `logs/sandbox-job-2026-09-27T23-10-53-528Z/results.json` (including the in-container deadline wrapper).
- Actual inspected public HTTP-echo form → approved fill/click → observed submitted
  values: `logs/browser-job-2026-09-27T22-42-10-047Z/results.json`. This was a test
  endpoint, not a real customer order.
- Public notebook HTTPS: unauthorized requests rejected, management blocked,
  actual PDF downloaded with its filename and requested sentence, exact 60-second relative reminder and
  a notification emitted by the real scheduler:
  `logs/notebook-tasks-2026-09-27T23-08-22-448Z/results.json`.
- Real browser microphone pipeline with synthetic speech → Whisper → operational
  agent → spoken355, with tracks released after hang-up:
  `logs/task-voice-2026-09-27T22-33-08-174Z/results.json` (public HTTPS).
- Actual web search returned10 links:
  `logs/web-search-2026-09-27T22-58-04-362Z/results.json`.
- Final build/regression checks: **37 operator tests**, **77 Hub/backend tests**,
  **27 frontend tests**, both TypeScript builds and Python dependency consistency
  passed. Full evidence:
  `logs/operator-check-2026-09-27T23-06-20-244Z/` and
  `logs/project-checks-20260927T230619Z/`.

The original Sept27 status check reported **26 callable tools** and healthy storage/action
and agent queues. It also confirmed **clinicConnected=false, emailConnected=false,
smtpConfigured=false** at this checkpoint. Account activation is the remaining
access requirement, not evidence of a connected inbox or patient-data session.

Earlier failed cohorts are retained: oversized process observations broke the
model follow-up; a first spreadsheet omitted the requested total; model prose
invented artifact URLs. Repairs include compact/paged observations, explicit
required totals and file read-back, and receipt-owned final download URLs. An
OpenClaw empty-answer placeholder can fall back to a verified completed-file
receipt; it is not treated as an ordinary answer.

Voice is functional but has not met the 1–2-second useful-answer target. The Sept27
public warm test was about **11.94 seconds** from utterance end to audible answer (roughly
0.8 seconds transcription round trip and 8.8 seconds operational-agent round trip).
It used a synthetic microphone from the PC through HTTPS, not physical notebook
acoustics. Cold GPU loading is now warmed before launch and speech models remain
resident; these measurements must not be presented as a faster-than-measured call.

With the27B upgrade and final hybrid speech placement, the Sept30 public HTTPS
synthetic-microphone check was **12.64 seconds**. A preceding local8.65-second
sample used a different path/profile and is not the notebook result.

The later Qwen3.8/native deployment's final public sample was **10.83 seconds**
with the actual calculator result spoken. Other samples remained around12–13s;
the1–2-second target is still unmet. Concise voice mode and bounded HTTP waiting
are enabled; reasoning remains xhigh.

## Implementation and lifecycle

- `operator/src/{task-integrations,files,web-tools,mail,clinic}.ts` and
  `operator/python/documents.py`: executable adapters.
- `operator/skills/`: versioned manifests/handlers; environment enablement remains
  explicit. The simulation send is disabled in normal task staging.
- `frontend/src/OperatorPanel.tsx`: actual job UI, files, approvals, connections and
  calls, integrated into the existing app.
- `project_hub/operator_client.py`: scoped local-owner bridge; no Node/Gateway
  credentials sent to browsers. Temporary task access uses an explicit notebook
  mode and still excludes host-management routes.
- `scripts/operator_process.py`: owned start/status/graceful restart. Active/queued
  work blocks management shutdown. `scripts/start.py` integrates normal launch.
- Speech: existing pinned `Jarvis-Evaluation/compose.voice-gpu.yaml`, with persistent
  CUDA float16 Whisper Small and the same Kokoro model on CPU. This preserves
  speech weights while leaving inference headroom for27B on the16GB GPU.
- `scripts/warm_operator_model.py` exercises the configured inference transport
  (currently native Ollama), checks model/context identity and reports GPU
  assignment separately from physical device memory. See [DEVELOPMENT.md](DEVELOPMENT.md).

Use `npm run check` in `operator`, and
`python -B scripts/verify_projects.py --frontend` from WorkOS for retained logs.
Browser scripts are under `operator/scripts/prove-*.mjs`; their latest individual
reports state what was actually measured. A tested adapter is not proof of a
connected account, completed delivery, or clinical correctness.
