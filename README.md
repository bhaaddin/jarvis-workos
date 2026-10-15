# JARVIS WorkOS

A personal AI work assistant with Node-owned tasks/tools and native Ollama
inference, plus retained OpenClaw and n8n integrations.

## Current entry points

- **[Social contacts](SOCIAL-CONTACTS.md)** — Instagram/TikTok profile research,
  saved shortlists, source evidence and manually sent outreach drafts. Available
  as a tab in JARVIS Tasks; dedicated platform sign-in is required.

- **[JARVIS Tasks](http://127.0.0.1:18791/#operator)** — operational jobs, files,
  reminders, calls and runtime diagnostics. Current model: Qwen3.8-27B, 32K
  context and xhigh reasoning. [Task guide](TASKS.md).
- **[Projects & connections](http://127.0.0.1:18791/#projects)** — Medical,
  JARVIS WorkOS and **42 registered source clones**. Search/read source and check
  declared runtime contracts. [Project guide](PROJECTS.md) and
  [verification evidence](docs/CONNECTIONS-VERIFICATION.md).
- **[Development and runtime setup](DEVELOPMENT.md)** — reproducible setup,
  source-checked startup, diagnostics and guarded resource controls.

## Command Center

**[Open the frontend](http://127.0.0.1:18791/)** — seven connected sections,
streamed project chat, persistent conversations, one-button JARVIS calls, and a searchable
catalog of **11,133 real upstream skill definitions**.

Read **[COMMAND-CENTER.md](COMMAND-CENTER.md)** for test workflows, installation/
readiness semantics, and frontend development commands. Catalog entries are
discoverable capabilities; installed readiness is verified separately.

## Start here

**Basic response speed:** [PERFORMANCE.md](PERFORMANCE.md) records the diagnosed
weather-tool bottleneck, direct fast handlers, and separate text/voice timings.

**Using TeamViewer from your notebook?** Follow **[NOTEBOOK.md](NOTEBOOK.md)**.
Open the authenticated notebook HTTPS link in the notebook's own browser to use
its microphone while the powerful PC runs JARVIS.

**Daily entry point: double-click `JARVIS.cmd` on your Desktop, or open
http://127.0.0.1:18791.**

**[Connect a local project](PROJECTS.md)** — browse/search registered source, ask
project-aware questions, inspect source/runtime compatibility, request a stronger
OpenCode review locally, and open the selected folder in your coding engine.

**[Call JARVIS](VOICE.md)** — press **Call JARVIS** once. A full-screen call opens,
he greets you, and you talk. Interrupt by speaking; mute or hang up using the call
controls. Local Silero speech detection, faster-whisper, and Kokoro handle the audio.

1. **[Detailed build plan](BUILD-PLAN.md)** — architecture, GitHub components,
   all five work areas, implementation order, estimates, and completion criteria.
2. **[Setup and operation](SETUP.md)** — exact commands, dashboard access,
   cloud-model onboarding, and day-to-day operation.
3. **[Verification](VERIFICATION.md)** — what was actually checked and what is next.
4. **[Sources](SOURCES.md)** — exact upstream revisions, images, and licenses.

## Retained Gateway/workflow starter

The original starter below is a separate entry point from the native operational
Tasks agent. Its model selection does not change `operator/config/model.json`.

- Project Hub: **http://127.0.0.1:18791**
- Assistant: **http://localhost:18789**
- Workflow editor: **http://localhost:5679**

For the assistant, copy `OPENCLAW_GATEWAY_TOKEN` from this folder's local `.env`
file into the dashboard's **Gateway secret** field and select **Connect**.

Try:

> Use the jarvis-workflows skill to run the demo briefing. Show the request ID.

The n8n demo verifies a real tool connection using synthetic data. Project source
connections are live through Project Hub. Work-account OAuth connections are
separate from connecting a source-code folder.

## Start again on this NVIDIA-equipped PC

For current native Tasks, from `C:\Users\Matko\Jarvis-WorkOS`:

```text
python -B scripts/dev.py up --voice --open
```

Use [DEVELOPMENT.md](DEVELOPMENT.md) for setup/verification and
[PROJECTS.md](PROJECTS.md) for source registration/runtime checks.

### Original full Gateway/demo stack

Open a terminal in `C:\Users\Matko\Jarvis-WorkOS`, then run:

```text
python scripts/start.py --gpu --voice
```

For a fresh installation that also needs the model download:

```text
python scripts/start.py --gpu --voice --pull-model
```

Verify:

```text
python scripts/smoke.py --model
```

The original starter uses `qwen3.5:9b` locally. A hosted provider can be added through
OpenClaw's model configuration wizard. The source clones are in `vendor/`;
the running services use official pinned container images.
