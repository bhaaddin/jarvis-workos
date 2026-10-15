# JARVIS projects, clones and connections

**Verified 2026-10-01:** 42 managed source clones are registered alongside Medical
and JARVIS WorkOS: **44 projects, 45 readable roots**. Six declared runtime probes
passed. Medical's API is reachable but requires authentication; the optional
evaluation app is stopped, and two FHIR endpoints need configuration. Exact
project IDs, probe scope and retained evidence:
[connection verification](docs/CONNECTIONS-VERIFICATION.md).

## Open it

Double-click **`JARVIS.cmd` on the Desktop**, or open:

**http://127.0.0.1:18791/#projects**

The launcher starts Docker Desktop if necessary, starts the assistant services,
starts the Windows-side Project Hub, and opens the dashboard. The dashboard uses
a local browser session; there is no token to copy for normal project work.

Open **Connections & cloned projects**, search for a repository, and select it to
inspect its source roots, HEAD, declared development requirements and runtime
checks. **Refresh checks** forces a new check; ordinary detail requests may reuse
a result for 20 seconds. The source explorer below the catalogue opens files with
qualified project/root paths and line numbers.

On the notebook, open the current private access card's HTTPS address and select
**Projects & connections**. This provides authenticated source inspection and
connection checks. Registration, coding/review launches and runtime management
use the local interface. Temporary URLs and passwords stay on the private card.

## Connect another project

1. Click **Connect a project**.
2. Enter its name.
3. Paste its folder path.
4. Click **Connect project**.

For a project with separate repositories, enter one folder per line:

```text
backend=C:\Projects\MyApplication.Api
frontend=C:\Projects\MyApplication.Web
```

The same operation from a terminal opened in this repository:

```text
python scripts/projects.py connect "C:\Projects\MyApplication" --name "My Application"
```

For multiple roots:

```text
python scripts/projects.py connect --name "My Application" --root "backend=C:\Projects\MyApplication.Api" --root "frontend=C:\Projects\MyApplication.Web"
```

Folders can be ordinary source directories or Git worktrees. A project supports
up to eight non-overlapping roots. Reconnecting the same name and roots is
idempotent. A duplicate name with different roots returns a clear conflict.

## Medical is connected

Project ID: **`medical`**

| Root | Source folder |
|---|---|
| `backend` | `C:\Users\Matko\SportMedical.Diagnostics` |
| `frontend` | `C:\Users\Matko\sportmedical-frontend` |

The Desktop MEDISENSE plan points to these repositories. Current branches and
changed source paths are read from Git when requested. Repository instructions
appear in Overview and accompany project chat. The backend's coordinator role
is part of those instructions.

The assistant itself is also connected as **JARVIS WorkOS** (`jarvis-workos`).

## Existing clones are connected

| Collection | Clones | Location relative to this workspace |
| --- | ---: | --- |
| Runtime upstreams | 7 | `vendor/` |
| Evaluation projects | 4 | `../Jarvis-Evaluation/` |
| Application/SDK libraries | 12 | `../GitHub-Reference-Library/repos/` |
| Development-tool sources | 10 | `../GitHub-Reference-Library/tools/` |
| Skill sources | 6 | `../GitHub-Reference-Library/skill-sources/` |
| Explicit temporary references | 3 | Reviewed Bookio paths in `config/connections.json` |

Examples include Ollama, OpenClaw, n8n, Speaches, OpenJarvis, Medplum, Firely,
FullCalendar, QuestPDF and the OpenCode sources. Each imported clone uses root
**`source`**, for example `upstream-ollama/source/go.mod`. The complete ID list is
in the [verification report](docs/CONNECTIONS-VERIFICATION.md#registered-inventory).

Discovery examines immediate Git checkouts in the reviewed collections and the
explicit extra paths. It does not recursively scan personal drives or download
new repositories. The binary-only `rtk-bin` directory is not a source clone.
Temporary references remain readable only while their configured folders exist.

```text
python -B scripts/connections.py discover
python -B scripts/connections.py import-clones
python -B scripts/connections.py list --query ollama
python -B scripts/connections.py check --project upstream-ollama
```

Import is idempotent: existing paths retain their IDs, names, roots and metadata.
Conflicting registrations are reported, not replaced. Edit the reviewed
`config/connections.json` locations/extras to add another managed collection;
use **Connect a project** for an individual local folder.

## What the dashboard does

### Overview

Shows connected roots, detected stack, bounded source counts, live Git status,
and project instructions. Counts are source-view counts, not a claim to include
every file on disk.

### Source explorer

Browse folders, search filenames and literal source text, and read source with
line numbers. Results are bounded and indicate truncation. Root selection is
explicit, so a backend path does not silently resolve against the frontend.

### Ask JARVIS

Use [JARVIS Tasks](TASKS.md) for the operational agent, or the existing **Project
chat** for a separate legacy Gateway conversation per project. Both have a
`jarvis_projects` tool connected to the Windows source reader. It supports
`list`, `connections`, `compatibility`, `overview`, `tree`, `read`, `search`,
`git`, and `instructions`. Source results contain qualified identifiers for
citations. `list` and `connections` accept a name/ID `query` and 1-based `start`;
their page limit is 1–100, default 50.

Examples:

> Read the frontend package.json and backend global.json. Give the versions and source lines.

> Find the appointment scheduling implementation and explain its entry points.

> Read the project instructions and explain the required verification commands.

> Read upstream-ollama, root source, go.mod. Cite its module and Go version, then check its declared runtime connection.

Tool argument examples:

```json
{"action":"connections","query":"ollama","start":1,"limit":20}
{"action":"compatibility","project":"upstream-ollama"}
{"action":"read","project":"upstream-ollama","root":"source","path":"go.mod","start":1,"limit":20}
```

These are three separate tool calls. The operational agent receives the complete
enabled tool schemas; `operator/config/model.json` keeps `toolDiscovery:false`.
The retained Gateway independently keeps `tools.toolSearch:false`.

### Strong review

Select one to four source paths and request a review or patch proposal. This
uses the prepared OpenCode snapshot helper and its existing provider account.
The current helper profile uses `openai/gpt-6-astra`.

Applicable root/nested instructions accompany the source snapshots. Full
instructions must fit the helper's eight-file/48 KiB envelope. Ordinary source
snippets are bounded to 180 lines and 12 KiB per file. Results identify missing
context rather than claiming to have inspected the whole repository.

Completed results remain in the local review history. Reopening Strong review
shows the most recent saved result for that project. An interrupted browser
connection can resume a running job's status. The full worker output and source
hashes are saved under the returned automation artifact directory.

**A patch proposal is not an applied change.** Use the native coding session to
implement and verify an actual change in the appropriate project/worktree.

### Open coding session

Opens the existing native OpenCode executable in the selected folder. It uses
the normal project instructions and tool permissions. Select the appropriate
implementation worktree for the requested change.

## Supported connection adapters

| Adapter | Implemented check/access |
| --- | --- |
| `local-source` | Bounded tree, numbered read, search and repository instructions for an ordinary source folder |
| `git-source` | Source access plus Git metadata; normal, sparse, worktree and external-gitdir checkouts |
| `http-health` | Successful response from the configured health path |
| `http-json` | JSON object matching explicit expected scalar fields |
| `ollama` | `/api/version` and `/api/tags` shapes |
| `openai-models` | `/v1/models` catalogue and any declared required model IDs |
| `openapi` | OpenAPI 3.x/Swagger 2.x document, path count and contract fingerprint |
| `fhir` | `/metadata` CapabilityStatement with a FHIR version |

Source checks report readable samples, Git revision, safe upstream URL, license
filenames and bounded manifest requirements. A declared Go/.NET/Node/Python
version describes the source; it does not verify the installed toolchain or a
successful build. Sparse checkouts expose only the files present locally.

Runtime checks are read-only metadata requests. A passing model catalogue is not
a generation/transcription test; a passing health endpoint is not a completed
workflow; an OpenAPI/FHIR document is not authenticated access to business records.
Account adapters in [TASKS.md](TASKS.md#connect-real-business-accounts) have their
own authorization and operation checks. These eight adapters define the current
supported surface; other protocols need an implemented, reviewed adapter.

### Declare a runtime endpoint

Add a specification under an existing project ID in the `runtimes` object of
`config/connections.json`. For a service whose actual health response contains
`{"status":"ok"}`, the entry would be:

```json
"my-application": [
  {
    "id": "api",
    "adapter": "http-json",
    "baseUrl": "http://127.0.0.1:8080",
    "path": "/health",
    "expected": {"status": "ok"}
  }
]
```

Use the service's real contract and exact project ID. `baseUrl:null` records an
endpoint that still needs configuration. IDs are unique within each project;
unknown adapters or malformed specifications are rejected instead of falling
back to a generic connection.

For a bearer-authenticated metadata endpoint, set `credentialEnv` to the name of
a private `JARVIS_...` key available in the workspace environment. The value stays
in the private `.env`, not in registry JSON, tool arguments, URLs or reports. The
probe uses that value as a Bearer token; it does not perform OAuth/login or renew
accounts. A Medical account session is managed by the separate clinic connector.

Endpoint URLs must use HTTPS or loopback HTTP, with no embedded credentials,
query or fragment. Probe paths are fixed and service-relative. Requests are GET
only, with a 4-second I/O timeout and 2 MiB response limit; redirects and inherited
HTTP proxies are disabled. Registry changes require a Hub restart:

```text
python -B scripts/projects.py restart
python -B scripts/connections.py check --project my-application
```

### Read the result accurately

- `source_ready`: an allowed source sample is readable. `source_partial` means
  the root has no readable sample; `source_unavailable` means inspection failed.
- Catalogue `source-only`: no runtime declared. `configured-probe` means a URL
  exists, not that its probe has passed. Select the project for the actual result.
- `compatible`: this specific runtime metadata contract passed at `checkedAt`.
- `not_configured`: supply `baseUrl`. `credentials_required`: the referenced
  environment key is missing; no HTTP probe was sent.
- `authentication_required`: the reachable endpoint returned 401 without a
  credential reference. `authentication_rejected`: it returned 401 with the
  configured credential supplied. `permission_denied` means HTTP 403.
- `contract_mismatch`: the returned metadata did not meet the declared shape.
  `endpoint_unavailable` records other HTTP errors; `unreachable` records a
  transport failure. Inspect `httpStatus`/`reachable` rather than treating every
  failed probe as an offline service.

## Data and implementation

- `project_hub/`: Python standard-library host service and dashboard.
- `project_hub/connections.py` and `config/connections.json`: validated adapter
  registry, clone discovery and runtime probes.
- `frontend/src/ConnectionCatalog.tsx`: searchable source/runtime catalogue.
- `operator/skills/projects/`: operational agent's source/connection tool.
- `plugins/jarvis-project-tools/`: native OpenClaw tool adapter.
- `workspace/skills/jarvis-projects/`: CLI bridge for inspection and diagnostics.
- `runtime/project-hub.sqlite`: connection metadata and local review execution records.
- `logs/project-hub.log`: host-service diagnostics without request bodies or credentials.

The source view excludes credential/config-secret paths, runtime databases,
binary files, generated/dependency directories, and files larger than 512 KiB.
Git owns ignore semantics for repositories; known local instruction files are
loaded explicitly even when Git ignores them. Source reads validate both the
requested path and the opened Windows file handle. Linked files/junctions are
not followed. Connected locations are trusted local projects; this service is
not an OS sandbox for hostile local processes or concurrent filesystem mutation.

The dashboard binds to loopback and uses a same-origin HttpOnly session cookie.
The assistant uses a separate project token for inspection endpoints. The local
operator interface owns connection management and coding/review launches.

Authenticated APIs are `GET /api/connections?q=&start=&limit=`,
`GET /api/connections/<project>?refresh=1` and the existing `POST /api/tool` with
`action:connections|compatibility`. Task-mode notebook access proxies only the
explicit source-read/connection actions and fields; it does not forward a generic
project command or management API.

## Commands

These are individual lifecycle/verification operations. Keep the Hub running for
the bridge and browser proofs.

```text
python -B scripts/dev.py up --open
python scripts/projects.py list
python scripts/projects.py status
python scripts/projects.py restart
python scripts/projects.py stop
python -B scripts/connections.py verify
python -B scripts/verify_projects.py --frontend
python -B scripts/verify_connection_bridges.py
node operator/scripts/prove-connections.mjs
node operator/scripts/prove-connections.mjs --notebook
```

`connections.py verify` reopens a source sample for every registered root and
checks its hash, then records every declared runtime probe. Its exit status
checks source verification; runtime failures remain explicit in `results.json`
and must be reviewed separately. It does not build all clones. The bridge proof
needs the retained operational Gateway; the notebook proof needs an active
private task link. The local browser proof also runs a real model-selected task.

Stopping/restarting reports active chat, review, or voice work and can be repeated
after that work finishes. Stop the host service separately from `docker compose down`.
Source/config changes in the host service require a host restart. Existing seeded
skill/plugin files are preserved; deploy intentional changes explicitly and reload
the plugin through OpenClaw's supported command.

`node scripts/deploy-connection-tools.mjs` performs the reviewed connection-tool
migration on the owned Project chat Gateway (`jarvis-workos-openclaw-1`, port
18789): it recognizes the expected installed action declarations, retains hashed
backups/file ownership, applies the bounded update and invokes supported plugin
reload. Other installed layouts are rejected.

## Verification history

The 2026-10-01 connection checkpoint verified all 44 projects, six runtime probes,
the authenticated host/Gateway/CLI bridges, local model-selected source access and
the notebook catalogue/source UI. **95 Hub/backend tests, 27 frontend tests and
57 operator tests plus one build guard passed.** Full dates, command exits and
retained failures are in [connection verification](docs/CONNECTIONS-VERIFICATION.md).

On 2026-09-26, the browser successfully connected a folder, searched Medical's
frontend, opened a matching source location, completed a project-aware chat,
and displayed a completed OpenCode review. The assistant returned React
`^19.2.8` from `medical/frontend/package.json:27` and SDK `10.0.302` from
`medical/backend/global.json:3`. These are verification observations, not a
substitute for reading the current project.

Twenty behavioral checks passed. Desktop and 390-pixel mobile views were checked;
the mobile page and chat composer fit the viewport. Detailed test logs are under
`logs/project-checks-*`.
