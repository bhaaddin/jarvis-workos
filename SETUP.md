# Setup and operation

## Current operational environment — 2026-10-01

The native Tasks application now has a unified development/runtime workflow:

```text
python -B scripts/dev.py doctor
python -B scripts/dev.py setup
python -B scripts/dev.py up --voice --open
```

Use **Node.js24.16–24.x, Python3.13 and Docker Desktop with Linux containers**.
The setup prepares the document venv, locked Node dependencies, source-checked
table image and stamped builds. Add `--models` to setup only when the selected
reviewed model needs installing. Model, backend, Hub and speech ports are currently
11436,18801,18791 and18902. Details, resource profiles and checks:
[DEVELOPMENT.md](DEVELOPMENT.md).

The sections below retain the original Gateway/n8n demonstration setup. Their
9B download, container-only Node assumptions and cloud/Gateway configuration are
historical/legacy instructions, not the selected native Tasks model workflow.

## Legacy Gateway/demo reference

Run these commands from a terminal opened in:

```text
C:\Users\Matko\Jarvis-WorkOS
```

**Project Hub update:** the everyday interface is http://127.0.0.1:18791.
Double-click `JARVIS.cmd` on the Desktop to start and open it. See `PROJECTS.md`
for source connections, project chat, and coding/review workflows.
The Desktop launcher also starts local voice. See `VOICE.md` for dictation and
spoken answers, or run `python scripts/start.py --gpu --voice --open`.

## 1. Requirements

- Docker Desktop with Linux containers and Docker Compose v2.
- Python 3.10+ for the small host-side setup scripts; no pip packages are needed.
- NVIDIA GPU support in Docker for `--gpu`. This PC's GPU was detected separately
  and its use by Ollama is recorded in `VERIFICATION.md`.
- Free local ports `18789`, `18791`, `5679`, and `11435`; voice adds `18792`.
- Internet access for first-time images, model downloads, and later cloud services.

Git/GitHub CLI are only needed to obtain or expand the source reference clones.
Node is already inside the OpenClaw image.

## 2. Fastest startup

On this PC:

```text
python scripts/start.py --gpu --pull-model
```

The script:

1. Generates local credentials in `.env` if that file is missing.
2. Starts the services and waits for their health checks.
3. Seeds OpenClaw's Linux-native volume without replacing existing files.
4. Imports the sample n8n credential and workflow on the first successful setup.
5. Publishes the workflow and verifies its response.
6. Downloads or resumes `qwen3.5:9b` when `--pull-model` is selected.

Subsequent starts only need:

```text
python scripts/start.py --gpu
```

For a CPU-only machine, omit `--gpu`. CPU inference speed has not been measured
for this setup. Keep using the same GPU option on later starts: Compose needs
the GPU override when recreating the Ollama container.

The initial images and model are large downloads. The model itself is about
6.6 GB. Download completion does not require a hosted-model API key.

## 3. Open the assistant

1. Open http://localhost:18789.
2. Open this project's `.env` locally in your editor.
3. Copy the value of `OPENCLAW_GATEWAY_TOKEN` into **Gateway secret**.
4. Select **Connect**.

If the dashboard reports that device pairing is required, inspect the pending
device and approve the request for your own browser:

```text
docker compose exec openclaw node dist/index.js devices list
docker compose exec openclaw node dist/index.js devices approve <request-id>
```

Use the actual request ID shown by the first command. The secret belongs in the
local dashboard, not in a source file or chat message.

Try a plain question, then:

> Use the jarvis-workflows skill to run the demo briefing once. Show the request ID.

The result should identify itself as synthetic demonstration data. Empty demo
calendar/task arrays do not describe your actual accounts.

## 4. Open the workflow editor

Open http://localhost:5679 and complete n8n's local owner-account setup.

The imported workflow is named:

```text
JARVIS - Demo briefing (synthetic data)
```

It consists of an authenticated webhook and a JSON response. Open its execution
history to inspect tool calls. Add your provider's OAuth credential in n8n when
implementing the first real email/calendar workflow.

## 5. Run the checks

```text
python scripts/smoke.py --model
docker compose exec -T openclaw node dist/index.js config validate --json
docker compose exec -T openclaw node dist/index.js skills info jarvis-workflows
docker compose exec -T ollama ollama ps
```

The smoke script checks:

- OpenClaw, n8n, and Ollama respond.
- The sample workflow rejects a request without its credential.
- An authenticated request returns the expected structure and request ID.
- The bridge inside the assistant container can reach n8n.
- The local model returns a known marker when `--model` is used.

To exercise the assistant's reasoning and tool execution through the Gateway:

```text
docker compose exec -T openclaw node dist/index.js agent --agent main --session-key jarvis-demo --message "Use the jarvis-workflows skill to run demo-briefing once. Report the actual request_id and label the result synthetic demo data." --timeout 180 --json
```

Review both the response and `toolSummary`/execution metadata. A healthy container
does not by itself prove model inference, and a model reply does not by itself
prove a successful tool action.

## 6. Add the cloud side of hybrid AI

Use the upstream guided model configuration from an interactive terminal:

```text
docker compose exec openclaw node dist/index.js config --section model
```

Select the provider and authenticate using your own account/API access. Choose a
model that the provider and OpenClaw actually list as available. The wizard may
change the default model; review that choice after completion.

Inspect model configuration:

```text
docker compose exec -T openclaw node dist/index.js models status
docker compose exec -T openclaw node dist/index.js models list
```

To return the default to the local model:

```text
docker compose exec openclaw node dist/index.js models set ollama/qwen3.5:9b
```

No hosted provider was authenticated or billed by this setup. Hybrid expansion
is supported by the chosen assistant platform; cloud inference remains to be
configured and tested with your provider.

## 7. Where configuration and data live

| Location | Contents |
|---|---|
| `.env` | Local Gateway token, workflow token, n8n encryption key, time zone |
| `config/openclaw.json` | Initial seed configuration for a new assistant volume |
| `workspace/` | Initial identity and skill files for a new assistant volume |
| Docker volume `jarvis-workos_openclaw-data` | Live assistant config, workspace, databases, and history |
| Docker volume `jarvis-workos_n8n-data` | Live n8n database and encrypted application credentials |
| Docker volume `jarvis-workos_ollama-data` | Downloaded model weights |
| `runtime/n8n-bootstrap/credentials.json` | Initial workflow credential import artifact |
| `runtime/demo-installed` | Successful first-time sample installation marker |

The seed process preserves existing files. Editing `config/` or `workspace/`
after the first startup does not silently overwrite the live installation.
Change live settings through OpenClaw, and deploy intentional skill changes
through its supported skill tooling or an explicit copy of the changed file.

Set `TZ` in `.env` to your actual IANA time zone before scheduling real work.
The starter uses `Etc/UTC` to avoid guessing. Apply an environment change with
`python scripts/start.py --gpu`.

Keep the existing `N8N_ENCRYPTION_KEY` with the corresponding n8n database when
moving or restoring it. A new key cannot decrypt the old credentials.

## 8. Everyday commands

Status:

```text
docker compose ps
```

Recent logs:

```text
docker compose logs --since 10m openclaw n8n ollama
```

Stop this project and retain its volumes:

```text
docker compose down
```

Start it again with GPU support:

```text
python scripts/start.py --gpu
```

Download/resume the selected model independently:

```text
python scripts/pull_model.py
```

The separate `openclaw-init` container is a one-shot storage initializer. Exiting
successfully is its expected state. The three long-running services should be
healthy.

## 9. Backups and upgrades

Before an upgrade:

1. Save the current Compose files and image pins.
2. Stop this project's services for a consistent full-volume backup.
3. Back up `jarvis-workos_openclaw-data` and `jarvis-workos_n8n-data` using Docker
   Desktop's volume export or an equivalent volume-backup tool.
4. Back up `.env` and the local setup artifacts alongside that state.
5. Model weights can be backed up or downloaded again.
6. Restart with the same GPU setting.

Change both the version label and image digest deliberately when upgrading. Test
the sample workflow and model afterward. If an upgrade migrates a database,
rollback requires its matching pre-upgrade state as well as the older image.

## 10. Troubleshooting observed during setup

### OpenClaw: `ENOENT ... fstat` / native no-replace filesystem operation

The first attempt used a Windows bind mount for live OpenClaw state. It failed on
filesystem operations used by this release. The final Compose file uses a
Docker-managed Linux volume for live state. Keep that design when relocating the
project; use an export/copy for backups rather than moving the live database back
onto the Windows bind mount.

### Gateway says token is required

This is the expected login screen. Use the token from this project's `.env`, not
a token from another assistant installation.

### Model not found

Run `python scripts/pull_model.py`, then rerun `python scripts/smoke.py --model`.

### n8n webhook returns 404

Check that the sample workflow is published. If first-time setup was interrupted,
rerun `python scripts/start.py --gpu`. The installation marker is written only
after a successful webhook response.

### n8n webhook returns 401/403

The bridge and the imported Header Auth credential must use the same workflow
token. If you rotate that token later, update both ends deliberately.

### n8n mentions a missing Python task runner

This sample uses native webhook/response nodes and no Python Code node. A Python
workflow needs the documented external runner setup when that capability is added.
The current demo's successful execution does not verify a Python runner.

### GPU unavailable

Verify Docker Desktop's Linux/WSL GPU support and the NVIDIA driver. Startup with
`--gpu` should fail visibly if GPU allocation is unavailable; omitting the flag
selects CPU serving. `ollama ps` shows the actual processor used once a model is
loaded.
