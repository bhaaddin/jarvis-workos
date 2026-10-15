# Connection and cloned-project verification

**Verified 2026-10-01.** Workspace: `C:/Users/Matko/Jarvis-WorkOS`.
Usage, adapter definitions, setup and state meanings: [PROJECTS.md](../PROJECTS.md).

## Result and scope

- **42 managed clones registered**, plus existing Medical and JARVIS WorkOS:
  **44 projects / 45 source roots**. A source sample from every root was reopened
  through the normal source tool and its hash matched the inspection result.
- **Six runtime metadata contracts passed out of eight configured endpoints.**
  Medical returned anonymous HTTP 401; the paused evaluation app was unreachable.
  Two additional FHIR declarations have no endpoint configured.
- Authenticated host, actual Project chat Gateway tool on port 18789 and its
  installed CLI bridge passed. The separate port 18809 operational boundary is
  checked by the runtime registry.
- Local and notebook browser checks displayed all projects, searched the catalogue,
  checked a runtime, opened real Go source and fit a mobile viewport with no browser
  errors. The local check also completed an actual model-selected source/tool task.

This verifies the declared source/runtime adapter surface. It does not establish
universal protocol support, compile/install the 42 applications, activate their
accounts or qualify all advertised business operations. Each checkout remains
under its existing repository instructions and ownership.

## Registered inventory

Existing projects are **`medical`** (backend/frontend roots) and **`jarvis-workos`**.
Every imported clone below uses root **`source`**. IDs are the stable identifiers
accepted by `jarvis_projects`, the UI and `scripts/connections.py --project`.

| Collection | Count | Registered project IDs |
| --- | ---: | --- |
| `vendor/` runtime sources | 7 | `upstream-clawhub`, `upstream-faster-whisper`, `upstream-kokoro-onnx`, `upstream-n8n`, `upstream-ollama`, `upstream-openclaw`, `upstream-speaches` |
| `../Jarvis-Evaluation/` | 4 | `evaluation-leon`, `evaluation-openjarvis`, `evaluation-open-llm-vtuber`, `evaluation-open-llm-vtuber-web` |
| Reference libraries, `../GitHub-Reference-Library/repos/` | 12 | `reference-cal-diy`, `reference-cap`, `reference-firely-net-sdk`, `reference-fullcalendar`, `reference-fullcalendar-react`, `reference-medplum`, `reference-pdfme`, `reference-polly`, `reference-quartznet`, `reference-questpdf`, `reference-react-hook-form`, `reference-react-jsonschema-form` |
| Development tools, `../GitHub-Reference-Library/tools/` | 10 | `tool-ccusage`, `tool-context-mode-reference`, `tool-laya-node-reference`, `tool-laya-reference`, `tool-opencode-mcp-reference`, `tool-opencode-source`, `tool-rtk`, `tool-rtk-v0-50-0-source`, `tool-serena`, `tool-spotify-portal-reference` |
| Skill sources, `../GitHub-Reference-Library/skill-sources/` | 6 | `skill-anthropic-skills`, `skill-dotnet-skills`, `skill-obsidian-skills-reference`, `skill-prompt-master-reference`, `skill-superpowers`, `skill-vercel-agent-skills` |
| Explicit temporary Bookio references | 3 | `reference-konsulin-api`, `reference-imhotep`, `reference-openemr` |

The temporary paths are explicitly listed in `config/connections.json`; they are
not durable installation locations. The binary-only `rtk-bin` is excluded from
Git-source discovery. Importing again returned all 42 as `already_connected`,
with no conflicts or skipped candidates; existing project identities were retained.

## Actual runtime probes

Latest complete check: **2026-10-01, approximately 12:11 UTC**. Recheck current
state before relying on availability. All these probes are metadata-only GETs.

| Project / connection | Endpoint/contract | Observed state | Meaning / remaining requirement |
| --- | --- | --- | --- |
| `jarvis-workos` / `operator` | `18801/health/ready`, expected `ready:true` | `compatible` | Model-aware readiness contract passed; this check alone is not completed inference. |
| `jarvis-workos` / `project-hub` | `18791/health`, expected service `jarvis-project-hub` | `compatible` | The host-side source/connection service responded with its expected identity. |
| `upstream-ollama` / `local-inference` | `11436/api/version` and `/api/tags` | `compatible` | Deployed model service advertised the expected catalogue shape; source checkout was not executed. |
| `upstream-speaches` / `speech` | `18902/v1/models`, private bearer reference | `compatible` | Both required Whisper Small and Kokoro ONNX model IDs were available in the catalogue; no audio task was run by this probe. |
| `upstream-openclaw` / `operator-boundary` | `18809/jarvis/operator-boundary`, private bearer reference | `compatible` | Boundary version 2 and disabled native logs matched; operational Tasks still uses native Ollama inference. |
| `upstream-n8n` / `workflow-service` | `5679/healthz/readiness` | `compatible` | Service health endpoint passed; workflow/provider-account configuration is separate. |
| `medical` / `medical-api` | `5092/openapi/v1.json`, anonymous request | `authentication_required`, HTTP 401, `reachable:true` | Endpoint reachable; no contract document obtained. An authorized metadata-access configuration is needed. Clinical sign-in/record access remains a separate reviewed connector. |
| `evaluation-open-llm-vtuber` / `voice-evaluation` | `18901/openapi.json` | `unreachable`, `reachable:false` | Optional evaluation app is paused. Its source is readable; the verifier does not start it. |
| `reference-medplum` / `fhir-endpoint` | No `baseUrl` | `not_configured` | Supply an explicit FHIR server and any required authentication. |
| `reference-firely-net-sdk` / `fhir-endpoint` | No `baseUrl` | `not_configured` | The SDK source is readable; no FHIR service has been supplied. |

All listed ports are on `http://127.0.0.1`. Registry keys reference private
credentials; neither this report nor returned metadata contains their values.
Medical was unreachable earlier in the audit and later began returning 401.
The latest result supersedes that availability observation, not the preserved
Sept30 source/build qualification evidence.

## Verification evidence

Paths below are relative to the workspace. Each retained directory contains the
original report/logs rather than a replacement success record.

| Verification | Result | Evidence |
| --- | --- | --- |
| First clone import | 42 connected, no conflicts/skips | `logs/connections-import-clones-20261001T112726888677Z/results.json` |
| Idempotent second import | 42 already connected, no conflicts/skips | `logs/connections-import-clones-20261001T115821244081Z/results.json` |
| Final all-project source/runtime check | 44/44 source-verified; 6/8 configured runtime probes compatible; command exit 0 | `logs/connections-verify-20261001T121148194576Z/results.json` |
| Final focused Medical probe | Reachable anonymous 401 correctly classified as `authentication_required` | `logs/connections-check-20261001T120613100986Z/results.json` |
| Final authenticated host/Gateway/CLI proof | All three passed; CLI exit 0 | `logs/connection-bridges-20261001T120613510720Z/results.json` |
| Operator regression/build checks | 57 tests + 1 build guard; build/check exit 0 | `logs/operator-check-2026-10-01T11-48-47-954Z/` |
| Final Hub/frontend regression/build checks | 95 Python tests, 27 frontend tests, frontend build and syntax checks passed; exit 0 | `logs/project-checks-20261001T120555Z/` |
| Local UI and real model-selected clone task | Completed; 44 projects / 42 clones; source/runtime tools used; mobile fit; no browser errors | `logs/connection-ui-2026-10-01T11-41-54-299Z/results.json` |
| Final notebook HTTPS UI/source proof | Authenticated catalogue, search, connection panel and source read after the final Hub restart; mobile fit; no browser errors | `logs/connection-ui-2026-10-01T12-16-21-697Z/results.json` |
| Installed Gateway migration | Narrow plugin/CLI update, ownership/backups retained, supported reload exit 0 | `logs/connection-tools-2026-10-01T11-41-50-213Z/` |

The browser checks read `upstream-ollama/source/go.mod`, module
`github.com/ollama/ollama`, declared Go **1.26.0**. Source SHA-256:
`cfe925cbbb2b77460c4dd96a3f81ea908e613db883c78c5b08b61631327fbc71`.
The local native-agent job completed in **140.966 seconds**. That is an observed
source/compatibility task duration, not a low-latency or broad-quality benchmark.

### Retained failures and corrections

- Installed plugin migration initially failed with `EACCES` because the existing
  deployed files were root-owned. The narrowly scoped deployment now writes as
  container root while retaining the original uid/gid/mode and hashed backups.
  Failure: `logs/connection-tools-2026-10-01T11-40-04-521Z/migration.log`.
- The initial notebook UI proof could not reach Projects because notebook CSS
  hid the sidebar. Explicit **JARVIS Tasks / Projects & connections** navigation
  fixed access while keeping local-only actions out of notebook views. Failure:
  `logs/connection-ui-2026-10-01T11-49-12-905Z/`. The first successful correction
  remains at `logs/connection-ui-2026-10-01T11-53-16-870Z/results.json`; the table
  above links the later recheck against the final restarted Hub.
- An earlier anonymous Medical 401 was labelled `authentication_rejected`.
  Probe semantics/tests now distinguish missing authorization from a supplied
  rejected token. The Hub was restarted and the corrected live result retained
  separately in the focused/full reports above.

## Repeat the checks

Run from `C:/Users/Matko/Jarvis-WorkOS` with the existing private environment and
owned services. The notebook proof additionally requires an active task-mode link;
the bridge proof requires the Project chat Gateway on 18789 and its installed
bridge in `jarvis-workos-openclaw-1`.

```text
python -B scripts/connections.py discover
python -B scripts/connections.py import-clones
python -B scripts/connections.py verify
python -B scripts/verify_connection_bridges.py
python -B scripts/verify_projects.py --frontend
npm --prefix operator run check
node operator/scripts/prove-connections.mjs
node operator/scripts/prove-connections.mjs --notebook
```

`connections.py verify` exits nonzero for source verification failures. Its exit
0 does **not** require every runtime probe to pass: review `runtimeCompatible`,
`runtimeConfigured` and each connection's state/required fields in `results.json`.
Connection discovery/import/checks create retained `logs/connections-*` evidence.
The local UI proof runs a model task; avoid treating its elapsed time as a pure
HTTP-probe measurement.

Protocol behavior tests cover metadata validation, idempotent/conflicting imports,
external Git directories, source-format access, expected JSON/model/OpenAPI/FHIR
shapes, missing/rejected credentials and redirects. Live verification above is
the evidence for actually deployed endpoints. A new protocol, clone build or
business operation needs its own applicable contract and verification.
