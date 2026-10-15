# Verification record

## Basic-query speed and reliability — 2026-09-26

- Reproduced Prague weather at **19.698 s**, with a skill read and four unbounded
  curl executions. Direct provider endpoints were roughly 0.2–0.5 s; Ollama was
  qwen3.5:9b, 6.6 GB and fully GPU-resident. Evidence:
  `logs/weather-diagnostic-20260926T190514Z/`.
- A native weather tool alone improved warm requests but its initial 12.727 s and
  unrequested forecast prose missed the target. Direct data-backed basic replies
  replaced that model-mediated path; history remains in OpenClaw via supported RPCs.
- Final public HTTPS timings: Prague first **2.665 s**, repeat **1.372 s**, Brno
  **1.830 s**, greeting **1.225 s**, arithmetic **1.302 s**, including completion
  and native-history persistence. All questions/answers were recovered from history.
  `logs/basic-speed-20260926T202340Z/results.json`.
- First weather text was available in **0.470–0.932 s**. A real-service browser
  voice test measured **7.545 s from synthetic utterance end to audible weather**,
  passed refresh/history checks, and reported no page errors:
  `logs/notebook-browser-2026-09-26T20-23-59-276Z/`.
- **74 backend tests**, **26 frontend tests**, production build, Gateway config,
  native tool contracts and project connectivity passed:
  `logs/project-checks-20260926T201504Z/`.
- Slow-history regression passed with a 5.5 s delayed response, one in-flight
  request, and recovered admission: `logs/voice-browser-2026-09-26T20-01-38-029Z/`.
- Native `jarvis_weather` was activated and the competing shell skill disabled.
  Provider deadlines/failure output, cache behavior, direct-query classification,
  native Q/A projection, and restart follow-up context are covered by tests.
- The final same-country ambiguity guard was checked with eight passing focused
  weather tests and live Prague/Brno provider probes in `logs/basic-speed-20260926T203537Z/`.
- Results apply to the checked requests, not all future model/network conditions.
  Full diagnosis, commands, and timing boundaries: [PERFORMANCE.md](PERFORMANCE.md).

## Speaking graphics, incremental replies, and answer quality — 2026-09-26

- **60 backend tests**, **24 frontend tests**, TypeScript/production build,
  Gateway configuration, verified native tool contracts, and project connectivity
  passed in `logs/project-checks-20260926T183513Z/`.
- Voice text arrives through bounded, idempotent JSON jobs rather than waiting for
  a complete remote response. Tests cover incremental Unicode cursors, replay,
  ownership, submission failure/capacity release, cancel-before-start tombstones,
  interruption, early speech before terminal output, and no duplicate spoken prefix.
- Seven browser scenarios passed in `logs/voice-browser-2026-09-26T18-19-57-804Z/`.
  The real-call case's complete-version assertion originally sampled an early partial
  sentence. After separating source completeness from intentional speech interruption,
  the real call passed in `logs/voice-browser-2026-09-26T18-25-07-507Z/`.
- Public HTTPS notebook call passed after final cache/response refinements in
  `logs/notebook-browser-2026-09-26T18-35-54-256Z/`.
- Initial warm synthetic timing was STT **2.574 s**, first model text **1.712 s**,
  full answer **2.097 s**, answer TTS **2.059 s**, excluding capture and network
  playback overhead. That answer was numerically wrong. Evidence:
  `logs/call-timing-20260926T175201Z/`.
- Increasing reasoning initially corrected two typed examples, but repeated checks
  still exposed arithmetic errors. Added and actually loaded `jarvis_calculate`.
  Final six numerical examples returned correct results, with calculator tool use
  observed in five: `logs/call-reasoning-20260926T181928Z/`.
  Individual final reply times ranged from **2.627–8.584 s**; verification/tool use
  can add work. These are small smoke checks, not universal latency/quality claims.
- The plugin first lacked its new `contracts.tools` declaration. Runtime generation
  13 includes both `jarvis_projects` and `jarvis_calculate`; the new semantic verifier
  checks required tools and error diagnostics instead of trusting CLI exit 0 alone.
- Blue input / green output traces use actual samples. Desktop speaking states and
  320×568 layout were inspected; automation uses synthetic microphone audio.
- The selected local model, 32,768 context, and 4,096 output limit were retained.
  Its reasoning default was raised to high. Notebook URL/sign-in were preserved.

## Notebook / TeamViewer microphone boundary — 2026-09-26

- User confirmed TeamViewer from a notebook at a different location and selected
  an authenticated Cloudflare HTTPS link for the fastest test. The remote PC's
  Windows device inventory had two output endpoints, no input endpoints, and
  running audio services. The physical-device failure was therefore outside the
  earlier synthetic microphone tests.
- Added a loopback-only authenticated notebook relay, call API allowlist, private
  Hub-cookie handling, bounded connections/uploads, and a pinned Cloudflare connector.
  The notebook UI uses JSON replies because Quick Tunnels do not support SSE.
- **53 backend tests**, **17 frontend tests**, production build, and native runtime
  checks passed in `logs/project-checks-20260926T173726Z/`.
- A real public HTTPS call test passed in
  `logs/notebook-browser-2026-09-26T17-39-25-408Z/`: denied anonymous/management requests,
  authenticated secure-context UI, greeting, synthetic microphone input, local STT,
  buffered assistant response, actual TTS playback, and hang-up cleanup. The call
  screenshot was inspected. This does not verify the user's physical notebook mic.
- Connection instructions and generated credential-card location are in [NOTEBOOK.md](NOTEBOOK.md).
  No live password or private Hub cookie is recorded in these notes or test traces.

## One-button phone call — 2026-09-26

- Matko clarified the required UX as “one button call and then we talk.” The
  chat-embedded controls were replaced by a dedicated call screen and spoken greeting.
- **47 backend tests**, **16 frontend tests**, strict TypeScript/production build,
  Gateway configuration, native plugin checks, and project connectivity passed:
  `logs/project-checks-20260926T164218Z/`.
- All **seven browser call scenarios passed together**:
  `logs/voice-browser-2026-09-26T16-37-16-899Z/results.json`.
- The real-local scenario clicked Call once, heard JARVIS greet, asked a Medical
  question, injected another utterance during answer playback, observed automatic
  interruption, heard the second answer, and hung up. One microphone stream,
  two user requests, three TTS outputs including the greeting, no browser errors.
  Evidence: `artifacts/voice-real-phone-call-one--74fd3--interruption-second-answer/phone-call.json`
  within that run. The first answer included React `^19.2.8`.
- Lifecycle cases covered input mute while output continued, muted/partial-speech
  discard, simulated background-tab visibility, originating-thread cancellation,
  late/denied permission, and autoplay recovery within the same call. Error/race
  cases intercept APIs where needed; the real-local scenario does not.
- Desktop and 390×844 / 320×568 call screenshots were inspected. Mute, captions,
  and the red hang-up control fit on both phone sizes.
- After the final hint and playback-end polish, audio recovery and both phone
  layouts passed again: `logs/voice-browser-2026-09-26T16-42-52-718Z/`.
  Additional mobile page-width assertions passed in `logs/voice-browser-2026-09-26T16-43-43-588Z/`.
- Browser microphone input was synthetic. Actual hardware acoustics/echo rejection
  and headset behavior remain untested; browser echo cancellation is requested.
- The call UI requests concise model replies and bounds automatic speech, but this
  is not an instant-response or model-correctness benchmark.

## Earlier chat-embedded voice conversation — 2026-09-26

- `python scripts/verify_projects.py --frontend --live`: **47 backend tests**,
  **14 frontend tests**, strict TypeScript/production build, Gateway config, two
  native plugin runtime checks, and project connectivity passed.
  Full logs: `logs/project-checks-20260926T161213Z/`.
- Two real consecutive spoken turns passed using synthetic microphone audio and
  the actual browser Silero → local Whisper → OpenClaw → local Kokoro chain.
  The first returned Medical frontend React `^19.2.8`; the second answered a
  capabilities question. Playback ended and capture reopened automatically after
  each answer. The browser reported no page/console errors for that test.
  Report: `logs/voice-browser-2026-09-26T16-12-36-428Z/results.json`.
- Four lifecycle scenarios passed: interrupt playing audio and cancel the original
  chat on project switch; blocked autoplay; late/denied microphone permission;
  discard stale transcription and stop capture when hidden.
  Report: `logs/voice-browser-2026-09-26T16-15-48-484Z/results.json`.
  These race/error scenarios intercept APIs where needed; they do not claim actual
  native Gateway cancellation was proven by the mocked abort receipt.
- Mobile test corrected a desktop-only test selector, then passed at 390×844.
  Report: `logs/voice-browser-2026-09-26T16-17-02-506Z/results.json`.
  Its `voice-mobile-listening.png` and the real-turn `conversation-desktop.png`
  were inspected. End remains reachable and there is no horizontal page overflow.
- Six browser scenarios therefore passed across targeted runs; not a claim of a
  single all-six run. The final composer CSS was rebuilt before lifecycle/mobile checks.
- Earlier evidence is retained: a first browser-tool connection ended during STT;
  standalone Playwright initially required its browser download; the initial real
  conversation produced a >2-minute answer. Bounded, explicitly labeled spoken
  excerpts fixed the lengthy-playback problem and the real test passed afterward.
- Physical microphone/speaker acoustics and non-English speech were not tested.
  See [VOICE.md](VOICE.md) for use, boundaries, and reproducible commands.

## Command Center 0.3 — 2026-09-26

- Final unified checks: `python scripts/verify_projects.py --frontend --live`.
  All checks passed; full logs are in `logs/project-checks-20260926T131924Z/`.
  Results: **45 backend behavioral tests**, **3 frontend tests**, strict TypeScript,
  production build, both native plugin runtime checks, and project connectivity.
- The final mobile composer-height correction was rebuilt with `npm run build`.
  At 390×844, the chat panel ends at pixel 844, the composer ends at pixel 809,
  and Send is visible without page scrolling.
- Inspected final screenshots:
  `C:/Users/Matko/jarvis-v03-overview-desktop.png`,
  `C:/Users/Matko/jarvis-v03-skills-desktop.png`,
  `C:/Users/Matko/jarvis-v03-skills-mobile.png`, and
  `C:/Users/Matko/jarvis-v03-assistant-mobile.png`.
- Production React/TypeScript frontend built and served at the normal test URL.
- Catalog: 11,133 real upstream definitions; browser pagination showed 24 entries
  per page and 464 pages for the full cached catalog.
- Streamed Medical reply returned React `^19.2.8` and the correct Windows source
  path. Both user and assistant messages survived refresh in the selected conversation.
- Weather install operation `d249f51a65124d438fe1da8cb6cf0270` completed through
  OpenClaw; the Installed view then enabled the skill and reported Ready.
- n8n operation `b20b9329a19c4dc281750ac45083f0e1` completed with matching request
  ID `586b0cb8-a679-4d52-8632-70fd7e3c0c26` and `mode: demo`.
- Light/dark preferences survived refresh. Auto-send/auto-speak were exercised
  with synthetic browser audio and then restored to off.
- Browser race checks proved project/thread selection isolation and preservation
  of an in-progress answer when an older history response arrived late.
- The React client recovered its local session after a host restart without a
  manual token action. Ambiguous non-authentication failures are not auto-retried.
- Backend behavior checks and frontend stream tests passed. Reproducible commands
  and scope are in `COMMAND-CENTER.md`; full backend logs are in `logs/project-checks-*`.

Earlier milestones below are retained as historical verification records.

## Voice milestone — 2026-09-26

- Final combined startup passed: `python scripts/start.py --gpu --voice`.
  OpenClaw, n8n, Ollama, and Speaches all reported healthy.
- Final checks passed: `python scripts/verify_projects.py --live`;
  full logs are in `logs/project-checks-20260926T101246Z/`.
- Local Speaches, faster-whisper, and Kokoro models are installed and connected.
- The real speech-to-project pipeline passed:
  `python scripts/verify_voice.py --project`.
- Artifacts: `logs/voice-checks-20260926T095144Z/`.
- The isolated browser recorded a synthetic stream through MediaRecorder/WebM,
  obtained a real transcript, sent it to the Medical assistant, and played the
  generated answer. Playback start/stop and track release were observed.
- Project-switch cancellation and synthetic microphone-denial handling passed.
- The test suite now contains 25 passing behavioral checks. Static checks include
  the voice browser module. Log: `logs/project-checks-20260926T095143Z/`.
- Physical microphone/speaker and non-English speech quality were not tested.
- Final browser console check returned zero errors/warnings. Voice controls fit
  both the 1440px desktop and 390px mobile layouts.
- Inspected screenshots are saved as
  `C:/Users/Matko/jarvis-project-voice-desktop.png` and
  `C:/Users/Matko/jarvis-project-voice-mobile.png`.
- See `VOICE.md` for the component/license boundary, English output voices,
  reproducible commands, and exact scope of the synthetic tests.

## Project Hub milestone — 2026-09-26

- Medical backend/frontend and JARVIS WorkOS source connections are registered.
- Container-to-Windows source reads passed through the authenticated project bridge.
- The native `jarvis_projects` plugin loaded and executed through the live Gateway.
- Browser project chat returned the actual React and SDK versions with qualified
  source identifiers after full tool-schema exposure was enabled.
- A real OpenCode review completed: job `949d256eea47474b9d78d527cfa20ed7`;
  artifacts: `C:/Users/Matko/.claude/automation-logs/opencode/20260926T092012Z-p3662hzl`.
- Twenty behavioral checks passed; run log:
  `logs/project-checks-20260926T091751Z/behavior-tests.log`.
- Node syntax, Gateway config, plugin runtime, and connected-project checks passed
  in the same verification run.
- Browser checks covered source search/read, idempotent project connection,
  project-specific chat, saved review results, and a 390px layout with no page overflow.
- Earlier skill-only/deferred-tool attempts failed or confused root/project IDs.
  The final implementation registers a typed native tool and exposes its schema
  directly. No medical application source was changed by these checks.

The sections below record the earlier foundation milestone, before Project Hub.

Checked on **2026-09-25** on the local Windows PC.

## 1. Observed result

The starter's three services run successfully. Local model inference works on
the NVIDIA GPU. The assistant invoked the authenticated n8n demonstration through
its skill and reported the real tool result.

This establishes a working assistant foundation. It does not establish that
email, calendar, coding, document retrieval, business operations, voice, or native
desktop integrations have been completed.

## 2. Checks performed

| Check | Actual result |
|---|---|
| Python compilation: `init.py`, `start.py`, `pull_model.py`, `smoke.py` | Passed |
| Node syntax: workflow bridge and storage seeder | Passed |
| `docker compose config --quiet` | Passed |
| GPU override Compose validation | Passed |
| First successful `python scripts/start.py --gpu` | All three runtime services healthy; credential/workflow import and publication succeeded |
| Subsequent `python scripts/start.py --gpu` | Passed; existing services remained healthy and the demo was not re-imported |
| `python scripts/smoke.py` | Service, webhook authentication, response contract, and container-to-container bridge checks passed |
| `python scripts/smoke.py --model` | All checks passed, including `JARVIS_LOCAL_OK` from local model inference |
| OpenClaw `config validate --json` | `valid: true`, no configuration warnings |
| OpenClaw `skills info jarvis-workflows` | Ready, visible to model, command available, binary/environment requirements satisfied |
| Ollama `ps` after inference | `qwen3.5:9b`, `100% GPU`, 32,768-token context |
| Assistant turn through the running Gateway | Completed the synthetic workflow through `read` and `exec`; actual tool result inspected |
| OpenClaw browser entry | Rendered the expected token login screen at `/chat` |
| n8n browser entry | Rendered owner-account setup at `/setup` |
| Three upstream clone checks | Exact commits match `SOURCES.md`; each working tree was clean |

## 3. End-to-end assistant evidence

The Gateway-backed command used session key `jarvis-setup-check` and requested:

> Use the jarvis-workflows skill to run demo-briefing once. Report the actual
> request_id from the tool result and clearly label the result as synthetic demo data.

Observed evidence:

- Provider/model: `ollama/qwen3.5:9b`.
- Gateway run ID: `cce40e89-6a4a-4f68-b2e6-deec5d8303b1`.
- The assistant read `skills/jarvis-workflows/SKILL.md`.
- It executed the Node bridge with the `demo-briefing` argument.
- The tool result had `isError: false` and returned:

```json
{
  "request_id": "3d6c9bf3-abe0-4e02-8b69-ab98cc962477",
  "status": "completed",
  "mode": "demo",
  "source": "n8n"
}
```

- The final assistant answer reported that same request ID and identified the
  data as synthetic.
- The actual `chat.history` tool-result entry was inspected, so the completion
  claim is supported by the execution record rather than only assistant prose.
- Reported agent duration was approximately 12.2 seconds for this single run.
  This is one sample, not a general latency benchmark.

The run metadata also recorded **one initial `tool_call` error** before the
successful skill read and bridge execution. The assistant completed the intended
action, but this was not a zero-error tool-discovery benchmark. Broader reliability
needs the task-based evaluation described in the build plan.

The session transcript remains in the assistant's live state. The small model
download log is under `logs/model-pull.log`. Terminal outputs from this setup are
also retained in the coding session's tool history.

## 4. Setup issues resolved

### Windows bind-mounted OpenClaw state

The initial Gateway startup failed with `ENOENT ... fstat` and a diagnostic about
unsupported native no-replace filesystem operations. Live state was moved to the
Docker-managed `jarvis-workos_openclaw-data` volume. The same release then started
and passed its health/configuration checks.

The final setup uses a one-shot seeder to copy initial configuration and workspace
files into the Linux-native volume. Existing files are preserved on later starts.

### Local provider environment

The Gateway environment explicitly sets `OLLAMA_API_KEY=ollama-local`, the
documented placeholder for the self-hosted provider. The completed agent run
reported environment-based local provider authentication.

### Registry/download interruption

The initial Ollama container-image pull encountered a registry/CDN EOF. A later
pull completed with the pinned digest. The model download was interrupted and
then resumed successfully; local inference was checked after completion.

## 5. Browser scope

The OpenClaw token gate and n8n owner-setup screen rendered. n8n's unauthenticated
`/rest/login` request returned HTTP 401 while showing its initial setup screen.

An authenticated browser chat was not verified. The browser automation runtime
could not import the local filesystem module needed by the attempted secret-free
test harness. The actual authenticated assistant/tool path was instead verified
through OpenClaw's Gateway CLI. Normal user sign-in instructions are in `SETUP.md`.

## 6. Capabilities still to connect

- Hosted-model provider account and cloud inference.
- Email/calendar/task OAuth accounts and real office workflows.
- A selected repository and the existing coding engine's execution environment.
- A document corpus, extraction pipeline, and cited retrieval.
- Business application API authentication and selected operations.
- Microphone input, speech recognition/output, and native Windows control.
- Remote/phone access and any required always-on deployment.

These are planned phases, not hidden dependencies of the synthetic demo. No
external account credentials are required to repeat the local checks above.

## 7. Repository state

The standalone repository is `C:\Users\Matko\Jarvis-WorkOS`, initialized on `main`
with no commits. The generated `.env`, runtime artifacts, model data, and source
reference clones are not staged as application source. No remote repository was
created, and no commit or push was performed.
