# JARVIS development and runtime environment

Current workflow, **2026-10-01**. Run commands from `C:/Users/Matko/Jarvis-WorkOS`.

## Prepare and run

Requirements for this Windows host: **Node.js 24.16–24.x**, **Python 3.13**,
Docker Desktop using Linux containers, and NVIDIA GPU support for the selected
model. The existing model store is configured at `D:/AI/OllamaModels`.

```text
python -B scripts/dev.py doctor
python -B scripts/dev.py setup
python -B scripts/dev.py up --voice --open
```

`setup` performs `npm ci` for both packages, prepares the owned document venv,
installs the exact pinned Python requirements with no implicit dependency
upgrades, runs `pip check`, builds/verifies the table-analysis image, and builds
both applications. An already-running owned operator is stopped only when its
work is idle and restarted after successful setup. Existing private keys are
preserved; missing keys are initialized. Failures retain their original logs/exits.

For a machine missing the selected reviewed model:

```text
python -B scripts/dev.py setup --models
```

This additionally starts the model service and installs the selected Qwen3.8
recipe if absent. Model files are large. Review the configured storage path and
ports before preparing another machine. The recipe imports the pinned text GGUF;
it does not silently substitute a smaller model.

`up` is the **native operational startup**: model service, Project Hub, operator,
and optional speech. The retained `scripts/start.py` also starts the older
Gateway/workflow stack. Neither path removes existing containers as “orphans”.
Notebook access still uses Desktop `JARVIS Notebook.cmd` and its private,
expiring `JARVIS Notebook Access.html` card.

## Diagnose the actual environment

```text
python -B scripts/dev.py doctor --json
python -B scripts/dev.py doctor --offline
```

The doctor reports:

- Runtime versions and exact document dependency mismatches.
- Source/output build fingerprints and whether the running operator matches.
- Missing/invalid **configuration names**, never secret values.
- Docker availability and table-image source/provenance checks.
- Selected model installation, digest, current loading state and context.
- Operator/Hub/speech reachability and a GPU memory/power/temperature snapshot.

`--offline` performs local checks without probing Docker, GPU or network services.
Missing prerequisites and stale builds return a failing exit code. A deliberately
cold model is a warning: it can load on the next task. A healthy HTTP listener is
not treated as proof of a warm model or completed inference.

### Build freshness

Successful builds create `dist/.build-info.json`, binding their source and output
bytes. Both source edits and output corruption are detected. Private environment
files are excluded. Owned startup rejects stale or untracked builds, including a
process still serving an older compiled version.

```text
npm --prefix operator run build
npm --prefix frontend run build
node scripts/build-stamp.mjs check operator
node scripts/build-stamp.mjs check frontend
```

Build stamps establish build identity, not test success. After implementation
changes, run verification as well.

### Table-engine provenance

```text
python -B scripts/setup_table_engine.py check
python -B scripts/setup_table_engine.py install
```

The installer hashes the Dockerfile, worker and build-context policy, builds the
pinned Python/DuckDB recipe with ownership/source labels, verifies the image,
and writes its immutable ID to **`runtime/table-engine.json`**. A matching image
is reused. Source changes require rebuilding; unowned records are not overwritten.
The application also checks source identity before using the recorded image.

The earlier `operator/table-sandbox/image.json` is a historical pin, not the active
machine installation record. Manual copying of another machine's image ID is no
longer part of setup.

## Runtime visibility

Open **Runtime & resources** in the Tasks sidebar. Management-authorized users can
see the selected model/reasoning/context, warm/cold/offline state, active calls,
failure counts, model-call latency and token throughput.

- `/health` is process/storage liveness.
- `/health/ready` separately reports model availability and warm state.
- `/api/runtime` is authenticated management diagnostics.
- Per-run `performance` records model/tool time and token counts.

Telemetry stores numbers/status codes, not prompts, answers or thinking content.
Recent aggregate counters reset on process restart. Model-call timing excludes
tools/audio; it is not end-to-end voice latency.

**GPU assignment and physical residency differ.** Ollama's `size_vram` indicates
reported model placement. Windows may page GPU allocations. Device-wide NVIDIA
measurements are reported separately and are not replaced by a “100% GPU” label.

## Resource profiles and standby

```text
python -B scripts/dev.py resources balanced
python -B scripts/dev.py resources standby
python -B scripts/dev.py resources wake
python -B scripts/dev.py resources interactive
```

| Mode/operation | Behavior |
| --- | --- |
| `interactive` | Keep the selected model loaded for responsive repeated work. This is the restored current profile. |
| `balanced` | Set a 15-minute model idle lease; subsequent requests refresh it. |
| `standby` | Unload only the selected model after the operator's work checks pass. Model files and durable jobs remain. |
| `wake` | Exercise the actual selected model to prepare inference again. Cold loading can take about a minute on this machine. |

Model choice, reasoning, context and output budget are preserved by these
operations. Profiles are saved in `operator/config/resources.json`. Warm profile
changes keep the same context-shift policy as inference, avoiding an unnecessary
runner reload. If an existing lease cannot be refreshed, the response explicitly
reports that the saved policy will apply on the next request.

Controls reject active/queued work, prevent new admission during transitions,
require management permission and CSRF, and are **not proxied through notebook
management routes**. They operate on this dedicated model endpoint, not other GPU
processes or another Ollama service. Run standalone model benchmarks separately
from resource transitions.

Standby was measured releasing **13,410 MiB** of device memory in one test.
Power readings are snapshots; no sustained energy-saving percentage is claimed.

## Verification

### Project and runtime connections

The reviewed registry is `config/connections.json`. Existing clones can be
registered without installing or executing their applications:

```text
python -B scripts/connections.py discover
python -B scripts/connections.py import-clones
python -B scripts/connections.py check --project upstream-ollama
python -B scripts/connections.py verify
```

Import preserves existing project identities. Runtime metadata probes are separate
from source access and account activation. After registry edits, restart the Hub
with `python -B scripts/projects.py restart`. Review individual runtime states;
the verification command's exit code gates source checks, not all live endpoints.
Current inventory, supported adapters and private credential-reference setup:
[projects/connections](PROJECTS.md). Exact results:
[connection verification](docs/CONNECTIONS-VERIFICATION.md).

### Application and runtime checks

```text
python -B scripts/dev.py verify
node operator/scripts/prove-runtime.mjs
```

The first command runs the operator build/tests/build guards and the Hub/frontend
checks with retained full logs and original exit codes. The runtime proof uses an
isolated browser and synthetic task to verify the actual diagnostics panel,
checked calculator output, per-task timing and telemetry privacy.

Latest measured results, failures and corrections:
[environment verification](docs/ENVIRONMENT-VERIFICATION.md).
The broader capability/Medical gates remain in
[quality qualification](docs/OPERATOR-QUALITY-UPGRADE.md).
