# JARVIS Command Center 0.3

## Operational tasks — 0.4 update

Open **JARVIS Tasks** at <http://127.0.0.1:18791/#operator>. It now submits work to
the operational tool owner, creates/downloads real files, shows approval arguments
and results, provides business-account connection cards, and routes its voice
calls through the same task engine. [TASKS.md](TASKS.md) gives actual job examples
and verification. The earlier project chat remains available under **Project chat**.

## Open and test it

**http://127.0.0.1:18791/**

The Desktop **JARVIS.cmd** launcher starts the local services and opens this UI.
It builds the React frontend if its production output is missing. The earlier
interface remains available at `/classic`.

## Seven connected sections

| Section | Working features |
|---|---|
| Overview | Live service health, project shortcuts, actual catalog and readiness counts |
| Assistant | Streamed answers, formatted Markdown/code, saved conversations, source-aware questions, voice |
| Projects | Multi-folder connection, live Git/source overview, tree, search, paged reads, OpenCode review/coding launch |
| Skills library | Local search/pagination over real upstream definitions; detail, installation, installed inventory, enablement, use-in-chat |
| Automations | Real authenticated n8n demonstration and access to the workflow editor |
| Run history | Durable install, enable, catalog, workflow, and review results |
| Settings | Persisted light/dark theme, reading voice, auto-read replies, and send-after-dictation preferences |

The current catalog contains **11,133 distinct ClawHub skill definitions**.
They are deduplicated by publisher and slug; versions are not counted as new
skills. The browser requests 24 entries at a time. Search and counts run against
the local database.

**These are discoverable definitions, not 11,133 already-enabled functions.**
The installed inventory and its Ready state come from the actual OpenClaw
runtime. Some skills need binaries, supported platforms, service accounts, or
credentials before they can run. Their declared license/setup information is
shown rather than inferred.

## Try these workflows

### Project chat

Select **Medical**, open **Assistant**, and ask:

> Read the frontend package.json. Give the React version and its exact source path.

The server reads explicitly named source files through the existing source-reader
policy and passes their current contents, hash, and real Windows path as evidence.
Other project questions retain access to the native `jarvis_projects` tool.
The chat path no longer inventories the whole repository or fetches Git status
on every question. Current Git facts remain available through the live tool.

Conversation metadata lives in the Hub; message history remains owned by OpenClaw.
Refreshing the page restores the selected conversation from that authoritative
history. Project/thread selection is isolated, including delayed network responses.

### Find and activate a skill

1. Open **Skills library** and search for a capability.
2. Open **View skill** to inspect its source, version, license, and requirements.
3. **Install selected version** invokes the upstream OpenClaw installer.
4. Check **Installed** for actual requirements and agent visibility.
5. Use **Enable** when its prerequisites are satisfied.
6. A ready skill offers **Use in chat**.

The Weather skill `@steipete/weather@1.0.0` was installed through this interface
and then enabled successfully. Its operation receipt retains the upstream audit
and installation result. Installation success alone is not labeled as verified
readiness or publisher-to-inventory provenance.

The native `jarvis_capabilities` tool lets the assistant search the same catalog
and inspect installed readiness. It does not automatically install a catalog result.

### Call JARVIS

Press the green **Call JARVIS** button in the top bar. A dedicated call screen opens,
JARVIS greets you, and you talk. Speech automatically finishes a turn after a pause;
talking over a reply interrupts it. **Mute**, optional **Captions**, a call timer,
and a red **Hang up** button provide the meeting controls. The call can continue
while another browser tab is open. Long answers use a labeled spoken excerpt;
their full text stays in chat.

Calling works independently of the one-shot dictation preferences and
preserves unsent typed drafts. The smaller microphone button still provides manual
dictation outside conversation mode.

In Settings, **Send after dictation** submits recognized speech when recording
stops. **Speak new replies** automatically reads the resulting answer in the active
chat. Both settings are off by default and were restored after testing.

Microphone and playback lifetimes remain scoped to the current project/thread/view.
The local speech stack and its limits are documented in [VOICE.md](VOICE.md).

### What JARVIS can help with now

- Read/search connected project source, explain architecture, inspect Git status,
  and find project instructions or verification commands.
- Discuss changes and prepare review proposals. **Projects** can launch a local
  coding session or run a bounded OpenCode review; a proposal is not an applied edit.
- Search the skill catalog and inspect actual installed readiness in **Skills library**.
- Use the configured authenticated n8n demonstration and inspect its run receipt.
- Maintain project-specific conversations and accept/speak local voice turns.

The project-reader tool is read-only. Commands mentioned in repository instructions
do not mean webchat can execute them on the Windows host. Individual account,
workflow, and community-skill integrations require their actual connections.

### Run a workflow

Open **Automations → Run connection test**, then inspect its completed receipt in
**Run history**. The supplied workflow returns a real request ID and explicitly
labels its content as synthetic demonstration data.

## Catalog synchronization

**Expand catalog** starts a bounded background import from the public ClawHub API.
The SQLite checkpoint and each page commit atomically. Failed/interrupted requests
retain the last committed cursor; repeated cursors are rejected across resumes.

Command-line equivalent:

```text
python scripts/sync_catalog.py --target 12000
```

The initial command reached the terminal time limit after indexing 11,133 valid
records. The saved checkpoint is intact; this is a partial upstream traversal,
not a claim that the entire registry was downloaded. The local catalog already
exceeds the requested 10,000-entry scale. Expanding it does not enable those skills.

## Development and verification

Frontend source: `frontend/src/` (React + TypeScript + Vite).

From `frontend/`:

```text
npm ci
npm test
npm run build
```

For a hot-reload development UI, start the host service, then run `npm run dev`.
Vite listens on `127.0.0.1:18793` and proxies the local APIs. The production UI
uses the normal `18791` endpoint and assets in `frontend/dist`.

From the repository root, retain full logs and original exit codes:

```text
python scripts/verify_projects.py --frontend --live
```

## Actual v0.3 verification

The phone-call follow-up passed **47 backend tests**, **16 frontend tests**,
the production build, and native runtime checks. All **seven browser call scenarios**
passed together, including a real greeting and spoken interruption between two
questions. Detailed evidence is in [VOICE.md](VOICE.md) and [VERIFICATION.md](VERIFICATION.md).
The following records preserve the original v0.3 baseline.

- Strict TypeScript and the production Vite build passed.
- Final verification passed 45 backend behavioral tests and 3 frontend tests.
  Full logs: `logs/project-checks-20260926T131924Z/`.
- Frontend tests cover SSE UTF-8/CRLF byte boundaries, incomplete/error streams,
  and one-time local-session renewal without retrying ambiguous failures.
- Backend checks cover 10,201-entry synthetic catalog pagination, real identity
  deduplication, checkpoint atomicity/cycles, readiness evidence, thread isolation,
  legacy adoption, history projection, streamed-turn cleanup, and preferences.
- Live browser checks covered source search/read, streamed Medical answers,
  conversation/page recovery after refresh, real Weather installation/enablement,
  the n8n execution receipt, and theme persistence.
- A delayed-project test preserved the other project's selected thread and emitted
  zero mismatched history requests. A delayed-history test did not erase an active
  streamed reply.
- A synthetic microphone stream exercised the React recorder, local transcription,
  automatic submission, a correct Medical answer, and automatic audio playback.
  Tracks were released and test voice preferences were restored.
- Desktop and 390px mobile layouts were inspected. Catalog pages render 24 cards,
  and the mobile document width matches the viewport. The conversation selector
  and Send control remain visible in the mobile chat layout.

Physical microphone/speaker behavior and the operation of every community skill
were not tested. Individual integrations retain their own setup requirements.
