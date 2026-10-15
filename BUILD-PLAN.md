# JARVIS WorkOS: the fastest practical build plan

Research and stack selection: **25 September 2026**.

## 1. The recommendation

Build your assistant by combining **OpenClaw + n8n + Ollama**, then connect your
existing coding tools and work applications. Build the small adapters that are
specific to your work. Use the products' existing dashboards, model integrations,
memory, and workflow engines.

Your selected scope is:

1. Email, calendar, and tasks.
2. Coding and project work.
3. Documents and research.
4. Business applications.
5. Voice and computer control.
6. Hybrid AI: local models plus a hosted model for demanding work.

The useful version of “better than JARVIS” is an assistant that knows your actual
projects, finds the right evidence, performs repeatable work, and verifies the
result. Reliability on your own tasks is the measure of success.

## 2. What exists in this starter

**2026-09-26 update:** Project Hub, multi-root project connections, source search,
native assistant project tools, project chat, and OpenCode review integration are
implemented. See [PROJECTS.md](PROJECTS.md) for the current project milestone.

**Voice milestone:** local dictation and spoken answers are connected through
Speaches/faster-whisper/Kokoro. See [VOICE.md](VOICE.md) for usage and actual tests.

This repository contains:

- A three-service runtime with version- and digest-pinned container images.
- Official source clones for OpenClaw, n8n, and Ollama under `vendor/`.
- A local model configuration for `qwen3.5:9b`.
- A JARVIS identity and an OpenClaw workflow skill.
- An authenticated n8n demonstration workflow.
- A small Node.js bridge between the assistant container and that workflow.
- Initialization, startup, model-download, and live smoke-check scripts.

The n8n demonstration contains synthetic data. The project connector accesses the
selected real source folders. Mailbox, calendar, document-library, business-system,
and broader desktop integrations remain later phases. See `VERIFICATION.md` for
actual project and voice check results.

## 3. System architecture

```text
YOU
  |
  +-- OpenClaw dashboard (first interface)
  +-- Voice / phone / messaging channel (later)
  |
  v
OPENCLAW: assistant, conversations, tool selection, memory, scheduled agent work
  |
  +-- LOCAL MODEL: Ollama -> Qwen 3.5 9B
  +-- CLOUD MODEL: a provider you connect through OpenClaw
  |
  +-- WORKFLOW TOOLS -> n8n
  |      +-- Email, calendar, tasks
  |      +-- Documents, reports, notifications
  |      +-- Existing business application APIs
  |
  +-- CODING TOOLS -> existing OpenCode / coding CLI
  |      +-- One selected repository or worktree
  |      +-- Build, tests, patch, and result summary
  |
  +-- KNOWLEDGE TOOLS -> document ingestion + cited retrieval
  |      +-- Start with a small selected document folder
  |      +-- Add Docling for PDF / Office extraction
  |      +-- Add a vector index only when the corpus needs it
  |
  +-- COMPUTER TOOLS
         +-- Browser: OpenClaw browser or Playwright MCP
         +-- Native Windows: host-side node + focused desktop adapter
```

### The connection that is implemented now

```text
OpenClaw workspace skill
  -> node bridge.mjs demo-briefing
  -> HTTP POST http://n8n:5678/webhook/jarvis/demo-briefing
  -> n8n checks X-Jarvis-Key
  -> n8n returns structured JSON with the same request_id
  -> bridge validates the response and displays the result
```

Containers use service names such as `n8n` and `ollama` to reach each other.
Your browser uses the host URLs below. `localhost` inside a container refers to
that container, not to your Windows computer or a neighboring service.

| Component | URL on your PC | Internal endpoint | Responsibility |
|---|---|---|---|
| OpenClaw | http://localhost:18789 | `openclaw:18789` | Daily assistant interface |
| n8n | http://localhost:5679 | `n8n:5678` | Workflows and application credentials |
| Ollama | http://localhost:11435 | `ollama:11434` | Local model inference |

## 4. GitHub projects to reuse

### 4.1 Core projects: already cloned and wired into the starter

| Project | Why use it | Version selected | License position |
|---|---|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | Assistant gateway, dashboard, tools, skills, memory, channels, scheduling | `v2026.9.6` | MIT at the inspected revision |
| [n8n](https://github.com/n8n-io/n8n) | Existing email/calendar/app nodes and visual workflows | `n8n@2.40.7` | Sustainable Use License for covered code; source-available, with separate enterprise code |
| [Ollama](https://github.com/ollama/ollama) | Local model serving with a simple API | `v0.34.4` | MIT; individual models have their own licenses |

n8n's inspected license permits your own internal business use. Selling a hosted
automation product is a different licensing question. Keep that distinction if
you later turn this personal assistant into a commercial service.

The source clones are shallow and sparse to reduce setup time. The runtime uses
official prebuilt images, so three large upstream applications do not need local
source builds. Exact source commits and image digests are in `SOURCES.md`.

### 4.2 Add these when their feature is implemented

| Capability | Existing component | Integration approach |
|---|---|---|
| Coding | Your existing OpenCode toolchain | Use the upstream coding-agent capability or a bounded local adapter; preserve each repository's instructions |
| Browser actions | [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Register as a tool server in the selected execution environment, or use OpenClaw's own browser |
| PDF / Office extraction | [Docling](https://github.com/docling-project/docling) | Convert selected documents into structured text with page/source metadata |
| Local speech recognition | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Add a speech-to-text service if native voice integrations do not cover the required workflow |
| Local speech output | [Piper](https://github.com/OHF-Voice/piper1-gpl) | Add text-to-speech; inspect GPL-3.0 and the chosen voice's license at adoption time |

The existing coding-tool reference location is
`C:\Users\Matko\GitHub-Reference-Library\tools\opencode-source`.
It is a source reference, not proof that a coding worker is configured in the new
assistant container. Connect the actual installed tool and its selected worktree.

### 4.3 Why this combination

OpenClaw covers more of the personal-assistant control plane than a basic chat
interface. n8n supplies reusable application connectors and inspectable workflows.
Ollama supplies local inference. These are distinct responsibilities.

[Open WebUI](https://github.com/open-webui/open-webui) was also checked. It is a
reasonable chat/document interface, but it would add a second front end and
another place to configure assistant behavior in this design. Its current
license also has branding conditions. Use one main interface in the first version.

## 5. Hardware and model strategy

The inspected PC has approximately **64 GB RAM** and an **NVIDIA RTX 5080 with
16 GB VRAM**. Docker Desktop is already running with Linux containers.

### Local starting model

`qwen3.5:9b` is the initial candidate. Its Ollama model page lists a roughly
6.6 GB quantized download and tool support. This leaves more headroom than a large
model for the context cache and other GPU work. Actual latency and task quality
must be measured on this PC.

The starter uses a 32,768-token runtime context and one concurrent local request.
Increase either only after measuring memory use and latency. Model download size
is not the same as total inference memory.

### Hybrid model selection

Start with two explicit choices:

- **Local:** routine drafting, selected private documents, simple classification,
  local experimentation, and offline work after downloads are complete.
- **Cloud:** demanding coding, complex reasoning, or long research tasks, using
  a model available in the account you connect.

Use OpenClaw's provider/model onboarding instead of hardcoding a guessed hosted
model ID. Provider access and supported model names change independently of this
repository. A chat subscription does not automatically include API usage.

Initially, select the model explicitly for a task. Later, add task-based routing
only after you have example tasks and measured costs. A local-only workflow must
not silently fall back to a cloud provider. Local storage by itself does not make
a cloud-model conversation local-only.

## 6. Phase 1: establish the foundation

**Planning estimate:** 0.5-1 working day, including download and machine issues.

1. Start the Compose project.
2. Download the local model.
3. Open the assistant dashboard and establish the local operator connection.
4. Confirm a plain assistant reply.
5. Run the sample workflow directly.
6. Ask the assistant to run the same workflow through its skill.
7. Connect one hosted model and compare the same small task when an account is available.

**Done means:** the assistant replies, a real workflow returns a correlated result,
and restarting the services preserves configuration and history.

**Deliverables:** this starter, a documented model choice, and a verified tool call.

## 7. Phase 2: email, calendar, and task management

**Planning estimate:** 1-3 working days for one provider and a few useful workflows.

### First useful workflow: morning briefing

```text
Manual request or one daily schedule
  -> Fetch today's calendar events
  -> Fetch selected unread / flagged email
  -> Fetch due and overdue tasks
  -> Normalize times to your configured time zone
  -> Remove duplicates and retain original source links
  -> Summarize priorities, clashes, and next actions
  -> Return a briefing in the assistant
```

Configure either Microsoft 365/Outlook or Google Workspace first, according to
the account you actually use. Store OAuth connections in n8n's credential store.

For Microsoft accounts, prefer delegated Microsoft Graph access for this
single-user assistant. Reading mail and calendar is a different permission from
sending mail or changing calendar events. Select the scopes needed by each actual
workflow. See the official [permission overview](https://learn.microsoft.com/graph/permissions-overview).

### Build these next

| Workflow | Inputs | Output | Verification |
|---|---|---|---|
| Find email | Sender / topic / date range | Relevant messages with links | Open the returned message IDs |
| Draft reply | Message ID and requested intent | Draft ID and preview | Fetch the draft from the mail provider |
| Schedule meeting | Attendees, duration, time range | Event ID and time zone | Read the event back |
| Capture task | Title, due date, project | Task ID | Read the task back |
| Weekly review | Date range and selected sources | Completed / blocked / upcoming work | Link every status to its source |

Use the task/calendar application as the source of truth. Keep conversation
summaries in assistant memory rather than creating a second competing task list.

For writes, use stable request IDs. After a timeout, check whether the provider
created the draft, task, or event before repeating the request.

## 8. Phase 3: coding and projects

**Planning estimate:** 1-3 working days for the first repository adapter.

### Reuse your current development tools

1. Select one repository and one task.
2. Run the coding engine in that repository or a dedicated worktree.
3. Load its `AGENTS.md`, `CLAUDE.md`, manifests, and current Git status.
4. Give the worker a bounded task and completion conditions.
5. Return changed paths, a patch, exact checks, and unresolved failures.
6. Record the result in the existing project workflow.

The Docker assistant does not automatically see Windows executables or your
repositories. Use a Windows/WSL-side execution node or a dedicated coding worker
with an explicitly selected repository path. Connect the real coding environment;
do not duplicate the whole .NET/React toolchain inside the assistant image just
to obtain the first integration.

### Useful coding commands to expose

- Explain a module and identify its entry points.
- Implement one well-defined feature in a worktree.
- Run that repository's required verification and summarize failures.
- Review a diff for correctness and missing cases.
- Summarize project status from current Git/GitHub records.

**Done means:** one requested code change is produced in the correct worktree,
the appropriate checks actually run, and the report matches their results.

## 9. Phase 4: documents, research, and useful memory

**Planning estimate:** 1-3 working days for a selected small document collection.

### Start with a bounded document set

Choose a useful folder: project specifications, manuals, contracts, or study
materials. Ingest that folder before attempting to index the whole computer.

```text
Selected folder
  -> Detect new / changed / deleted files using content hashes
  -> Extract text, headings, tables, page numbers, and source location
  -> Split into searchable sections
  -> Create local embeddings if semantic search is needed
  -> Retrieve relevant sections for a question
  -> Answer with document and page/section citations
```

Use Docling for document formats that need extraction. Reuse the assistant's
memory capability for preferences and project context. Add a dedicated retrieval
service/vector database when the corpus, filtering, or update requirements justify
it. Preserve the original documents as the authoritative material.

### Keep three types of knowledge distinct

| Type | Example | Handling |
|---|---|---|
| User preferences | Preferred report format | Compact assistant memory |
| Working context | Goal and decisions for an active project | Project-scoped context with source references |
| Source documents | A contract, PDF, specification, or research paper | Searchable document index with provenance |

Index entries need source ID, file hash, page/section, extraction time, and access
scope. A deleted source must become unavailable to retrieval. Re-ingesting the
same file must not produce duplicate answers.

**Done means:** a small question set returns traceable answers, and questions
whose answers are absent are reported as unsupported by the indexed documents.

For web research, preserve source URLs and retrieval dates. Treat page content as
research material rather than instructions that can change the requested task.

## 10. Phase 5: business applications

**Planning estimate:** 2-5 working days per small, well-defined application flow.

Start with the business API that already owns the operation. An assistant adapter
should translate a request into that API's contract and return the result.

For your SportMedical applications, the first useful candidate is an operational
summary: selected scheduling statistics, pending administrative tasks, or a report
generated by an existing endpoint. Verify the current source and API contracts
before selecting a specific endpoint.

Use the existing identities, authorization, appointment/patient models, and report
generation. The integration should not create parallel clinical or scheduling
data models, and it should not bypass business rules by writing directly to the
application database.

### Integration shape

```text
Assistant task
  -> Named workflow / typed adapter operation
  -> Existing application API with the user's intended scope
  -> Existing validation and business logic
  -> Result identifier / report URL / structured status
  -> Read-back or status check
```

Use synthetic data while developing this connector. Decide which data can use a
hosted model before attaching that data source to the hybrid workflow. This
starter has not connected to business or patient records.

**Done means:** one real application use case works through its supported API,
and the assistant's completion claim can be checked in that application.

## 11. Phase 6: voice and computer control

**Planning estimate:** 1-3 working days for push-to-talk; additional time for each
native desktop workflow and for reliable always-on voice.

### Voice: build in this order

1. A push-to-talk input in an existing supported client.
2. Speech-to-text feeding the same assistant conversation.
3. Spoken responses through an existing TTS provider or local Piper.
4. Interruption, latency tuning, microphone selection, and language testing.
5. A wake word only after the end-to-end voice interaction is reliable.

```text
Microphone -> speech-to-text -> OpenClaw -> tools -> final text -> speech output
```

Prefer supported native OpenClaw voice capabilities where they meet the need.
Use faster-whisper/Piper for a custom local pipeline if required. A real-time
media platform is an expansion for phone calls and multi-device streaming, not a
dependency for the first spoken command.

### Computer control: prefer stable interfaces

1. Application API when available.
2. Browser automation for web applications.
3. Windows accessibility/UI Automation for native desktop applications.
4. Screen-coordinate interaction only where no stable interface exists.

OpenClaw's browser and Playwright automate browsers. A Linux container does not
give either tool control over native Windows windows. Native control needs a
Windows-side process and a selected application's automation interface.

Examples of first workflows: open a named project, fill a specific web form,
download a requested report, or launch a known desktop application.

**Done means:** the assistant observes the final application state and reports
what happened. A generated click sequence alone is not a completed workflow.

## 12. The small custom layer

Most custom work should be in these areas:

1. **Skills:** concise instructions for your actual workflows.
2. **Adapters:** typed calls into your existing applications and coding tools.
3. **Workflow definitions:** repeatable processes assembled in n8n.
4. **Retrieval rules:** which sources answer which questions, with citations.
5. **Task verification:** how each action proves completion.

Use the current Node bridge for the first fixed workflow. As the tool set grows,
promote the operations into an OpenClaw plugin or an MCP server with named,
validated inputs and outputs. MCP standardizes tool access; it does not make
unrelated repositories automatically compatible.

### Suggested production action contract

```json
{
  "schema_version": 1,
  "request_id": "unique-id",
  "operation": "calendar.create_event",
  "input": {
    "title": "Project review",
    "start": "2026-10-01T09:00:00+02:00",
    "duration_minutes": 30
  }
}
```

Return `status`, `request_id`, source-system IDs, and relevant evidence. Represent
queued, completed, failed, and unknown outcomes distinctly. An accepted request
is not a completed action. Long jobs should return a job ID with a status lookup.

Each write-capable adapter owns validation, authorization through its underlying
application, duplicate prevention, timeouts, and read-back. That behavior belongs
in code or the workflow, not only in a prompt.

## 13. Project structure

```text
Jarvis-WorkOS/
  README.md                     Quick entry point
  BUILD-PLAN.md                 This architecture and phased roadmap
  SETUP.md                      Exact startup and operation instructions
  SOURCES.md                    GitHub revisions, licenses, and image provenance
  VERIFICATION.md               Actual checks and known gaps
  compose.yaml                  Three runtime services + one-shot storage seed
  compose.gpu.yaml              NVIDIA GPU configuration
  .env.example                  Secret-free configuration template
  config/
    openclaw.json               Initial assistant configuration
  workspace/
    IDENTITY.md                 Assistant identity
    SOUL.md                     Working style
    TOOLS.md                    Connected capabilities
    skills/jarvis-workflows/
      SKILL.md                  Tool usage instructions
      bridge.mjs                Small HTTP integration adapter
  workflows/
    demo-briefing.json          Importable n8n workflow
  scripts/
    init.py                     Generate local credentials once
    seed-openclaw.mjs           Seed Linux-native state without overwrites
    start.py                    Start and connect the services
    pull_model.py               Download/resume the local model
    smoke.py                    Check live service and workflow boundaries
  vendor/
    openclaw/                   Official shallow/sparse source clone
    n8n/                        Official shallow/sparse source clone
    ollama/                     Official shallow/sparse source clone
  runtime/                      Generated local setup state; ignored by Git
  logs/                         Local command logs; ignored by Git
```

Docker named volumes hold live assistant state, the n8n database, and model
weights. Linux-native volumes avoid the Windows bind-mount filesystem failure
found during this setup. The tracked `config/` and `workspace/` files seed a fresh
installation; later live changes belong to the running installation.

## 14. A realistic delivery sequence

These are planning estimates for one experienced implementer with account access,
not measured completion times or a promise that all applications integrate easily.

| Milestone | Approximate focused effort | Useful outcome |
|---|---|---|
| Foundation | 0.5-1 day | Local chat and one working tool connection |
| Office assistant | 1-3 additional days | Morning briefing, email drafts, calendar/task flow |
| Coding and documents | 2-6 additional days | One repository worker and a cited document collection |
| Voice and one business flow | 3-8 additional days | Spoken interaction and a real application operation |
| Daily-driver reliability | Several more weeks of iteration | Better recovery, broader coverage, backups, measured quality |

A useful personal version can be a short project. Reliable coverage of all your
work grows through a sequence of verified integrations. Reusing source saves
infrastructure work; account setup, application contracts, and task verification
still need attention.

## 15. Budget and operating cost

The current PC is adequate for the proposed starting configuration. Allocate disk
space for the container images, the roughly 6.6 GB model, and growing state.
Larger models and document indexes need additional space.

For planning, set an initial hosted-AI budget around **US$20-100/month**, then
measure actual use. Heavy coding and long-running research can exceed that range.
This is a budget allowance, not a quoted provider price. Voice, search, business
API, and optional cloud services can have separate charges.

The local model has no per-token provider bill, but it uses your hardware and
electricity. A sleeping or powered-off PC will not run scheduled jobs. If daily
availability becomes important, move the always-on gateway/workflows to a small
server and keep GPU inference or desktop execution on the PC as appropriate.

## 16. Reliability that makes it useful

- Keep one owner for each responsibility: OpenClaw for conversations, n8n for
  deterministic workflows, Git for code, and work applications for their records.
- Give every operation a request ID and a clear completion condition.
- Use one scheduler per recurring workflow to prevent duplicate runs.
- Preserve application links and document citations in the final answer.
- Inspect provider state before retrying a write whose outcome is unknown.
- Cap long-running loops and report partial results when a connector fails.
- Back up live state together with the configuration and encryption key it needs.
- Pin versions, test upgrades on the small demonstration, and retain a rollback.

The starter publishes its interfaces on this PC's loopback address. Remote access
is a separate deployment step with authentication and transport configuration.

## 17. How to judge whether it is working

Create a small set of real tasks you repeat each week. Start with these examples:

1. Summarize today's meetings with correct times and links.
2. Find a specific email and prepare an appropriate draft.
3. Capture a task once, even if the first call times out.
4. Explain a selected repository feature using actual file paths.
5. Implement one bounded change and report real test results.
6. Answer a document question with a correct source citation.
7. Say when the indexed documents do not contain an answer.
8. Produce a report through an existing business API.
9. Complete one browser workflow and verify its final state.
10. Complete one spoken command with an understandable reply.

Record task success, human corrections, latency, and cost. Compare the local and
hosted models on the same inputs. Expand autonomy and connector coverage using
those results rather than the size of the agent/tool list.

## 18. Next implementation priority

After the foundation is verified, connect **one email/calendar provider and build
the morning briefing**. It combines several work areas, produces a daily benefit,
and establishes the reusable connection pattern for the rest of the system.

The next account-specific decisions are the mail/calendar provider, the first
task application, the initial document folder, and the first repository/business
workflow. The architecture supports these choices without rebuilding the core.
