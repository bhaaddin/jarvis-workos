# JARVIS operational core

**Current environment workflow:** [DEVELOPMENT.md](../DEVELOPMENT.md) covers the
unified setup/doctor, source/output build checks, runtime metrics, resource
profiles and the source-bound `runtime/table-engine.json` installation record.
Latest infrastructure evidence: [environment verification](../docs/ENVIRONMENT-VERIFICATION.md).

**Current task interface:** <http://127.0.0.1:18791/#operator>.
The practical task pack, account connection cards, approval/download UI and voice
connection are now integrated. See [TASKS.md](../TASKS.md) for real jobs, activation
steps and measured evidence. The sections below retain the core contracts.

**Voice reliability, 2026-10-06:** thinking-time interruption, request-bound
cancellation, pre-admission cancellation records and recoverable history notices
are verified through the public browser path. Model telemetry distinguishes user
cancellations from failures. [Evidence](../docs/VOICE-INTERRUPTION-VERIFICATION.md).

The selected operational model is **Qwen3.8-27B UD-Q3_K_XL**,32K context/xhigh
reasoning, with all layers reported as GPU-assigned on the RTX5080. Physical
residency is measured separately on Windows. Selection is in `config/model.json`;
`model-factory.ts` now uses the direct native Ollama transport. See
[quality qualification](../docs/OPERATOR-QUALITY-UPGRADE.md) for harder real jobs,
checked table analysis/exports, exact latency and Medical access/build blockers.

TypeScript control service for the [approved build contract](../docs/OPERATOR-BUILD-SPEC.md).
Current deployment is a single-owner operational workspace with protected memory,
structured model/tool turns, durable actions, scheduled reads and notifications,
plus practical document, file, computer, project, GitHub, browser, code and account
adapters. Production staff identity and the remaining external channels still
require their corresponding qualification/activation work.

## Run and verify

Requirements: Node24.16–24.x, installed package-lock dependencies, the qualified
local model service, and the pinned table-analysis image for CSV/XLSX queries.
The retained compose project manages both the model and legacy Gateway. From WorkOS:

```text
python -B scripts/operator_brain.py up
python -B scripts/warm_operator_model.py
```

This generates missing operator keys in the private WorkOS `.env`, starts the
dedicated Gateway/model service, and exercises the selected model. The current
machine-specific model volume is `D:/AI/OllamaModels`; install the qualified model
before warmup. Normal desktop startup uses `scripts/start.py --gpu --voice`.
From `Jarvis-WorkOS/operator`:

```text
npm ci
npm run check
npm run probe
npm start
```

- `check`: TypeScript build and all tests; full stdout/stderr and actual exit
  codes are retained under `../logs/operator-check-*/`.
- `probe`: requires a successful build and the selected live model service. Starts temporary
  loopback HTTP listeners against an isolated synthetic database, verifies the
  real model-selected tool loop, memory restart/encryption and active native-persistence
  checks, then closes those listeners. Results: `../logs/operator-live-*/`.
- `start`: launches the compiled service at `http://127.0.0.1:18801`. One operator
  process per database is supported. Run `check` after source edits before starting.
  No unattended Windows service/automatic restart installer has been deployed.

Staging login: `matko`; password is `JARVIS_OPERATOR_ADMIN_PASSWORD` in the
private environment. HTTP API login uses the configured `Origin`. Subsequent
mutations require both the HttpOnly session cookie and returned `x-csrf-token`.
Unknown request fields and type coercions are rejected; API responses are not cached.
Do not put passwords, cookies or model-Gateway credentials into browser bundles.

Production requires a stable HTTPS origin and configured identity provider.
The OIDC verification helper is **not** a completed production login/enrollment
flow. See [live blockers](../docs/OPERATOR-LIVE-BLOCKERS.md).

## Ownership and data

| Component | Responsibility |
| --- | --- |
| `src/agent.ts`, `model.ts`, `working-memory.ts` | Bounded structured tool loop, incognito Gateway transport, valid bounded working history |
| `src/ollama-model.ts`, `model-factory.ts`, `config/model.json` | Selected stateless native inference, terminal/tool validation and ephemeral thinking continuation |
| `src/table-analysis.ts`, `table-sandbox/` | Bounded read-only DuckDB container and data-only input |
| `src/registry.ts`, `skills/*` | Manifest/schema/code validation, version fingerprints, startup health |
| `src/tool-owner.ts`, `services.ts` | Current actor/conversation policy admission and declared service capabilities |
| `src/store*.ts`, `migrations.ts` | Worker-thread SQLite/WAL, encrypted private payloads, authoritative transactions |
| `src/actions.ts`, `store-actions.ts` | Approval, queue, fenced dispatch, receipts, uncertain outcomes |
| `src/runs.ts` | Durable chat request IDs, cancellation and idempotent finalization |
| `src/scheduler.ts`, `store-schedules.ts` | Persisted read-only schedules and leased occurrences |
| `src/events.ts`, notification records | Scoped live events and durable references for reconnect/replay |

The model proposes tool names/arguments; it cannot grant permissions or approve
actions. External writes default to approval. Fixture sends create only a
synthetic local receipt with `externallySent: false`. Plugin code is trusted
installed code, not a sandbox for email attachments or generated scripts. No
host shell executor is exposed. Generated JavaScript uses an approval-controlled,
bounded Docker executor without host mounts or network access.

Private JSON is AES-GCM encrypted with record-bound authenticated data. SQLite
IDs/index/state metadata are not full-database encryption. Data and callback keys
are environment-held and must be retained to recover the database. Raw model
reasoning, patient payloads and credentials do not belong in operational logs.

The dedicated Gateway uses incognito sessions, disabled native file logging and
Docker's `none` logging driver. Boundary protocol v2 checks the logging policy;
the live probe also inspects the actual Docker driver and exercises private model
output. Console-level filtering alone did not suppress native assistant prose.
After updating an existing owned deployment, run
`python -B scripts/operator_brain.py repair` from the WorkOS root; it waits for
the dedicated Gateway to become healthy. Keep diagnostics in the protected Node
audit/error path. See decision D020 for the observed leak and verification scope.

Schema version **2** additively migrates both known v1 variants, including the
earlier variant without `runs`. Environment/key/ownership checks precede
migration. Future unsupported schemas fail rather than being rewritten. Tested
migrations preserve encrypted memory; this is not a complete backup/restore or
rollback operator interface.

## Scheduling and notifications

Authenticated routes:

- `PUT /api/schedules/:uuid`: `expectedRevision`, `tool`, `input`, five-field
  `cron`, IANA `timezone`, `enabled`.
- `GET /api/schedules`, `GET /api/schedules/:uuid/jobs`.
- `GET /api/notifications?after=<sequence>`, `POST /api/notifications/:uuid/ack`.

Creation uses `expectedRevision: 0`; edits require the current revision. Input
passes the skill's schema. Only installed authorized **read** tools can be
scheduled; configuring a schedule cannot whitelist a write. Definitions bind
the actor revision and tool/config fingerprint. Authority/skill changes pause
future execution; editing or disabling fences old occurrences/results.

The scheduler polls every second. Cron has minute resolution and timezone/DST
handling from `cron-parser`; missed intervals coalesce into one check, and an
unfinished check prevents overlap. Read-worker leases can recover up to three
attempts. Stale workers cannot overwrite the current result. Per-account
schedule limit: 25. Results remain protected; notifications carry only controlled
status/reference fields. Acknowledgement is idempotent. Sequence replay is scoped
to the authenticated owner/tenant and bounded to 100 records per page.

Live pub/sub events are process-local. Durable notification replay does not
constitute a connected Telegram/WhatsApp/email delivery service. Future channel
adapters need verified identity, signature/replay checks and provider receipts.

## Skill contract

`skills/<folder>/manifest.json` plus a self-contained `.mjs` exporting
`execute(input, context)`. The handler calls declared `context.services.invoke`
operations. Relative handler imports are not supported: exact fingerprinted bytes
are imported to avoid a disk-read/import race.

Manifests declare version, environments, permissions, risk, sensitivity, required
environment names, timeout, input/output schemas and service operations. Input
schemas are closed objects. `_confidence` is reserved orchestration metadata;
async validation schemas are rejected. Missing configuration, invalid files and
handler load failures visibly disable the affected skill. Duplicate identities
are invalid. Code/schema changes under an unchanged version stay quarantined.

Actual output sensitivity may be higher than declared input sensitivity; that
higher classification must be retained in action/audit state and checked before
channel delivery. An uncertain write outcome is not retried automatically.

## Remaining qualification

See [verification and requirement map](../docs/OPERATOR-VERIFICATION.md). The
current real text-loop latency is not a voice acceptance result. Production
identity, business APIs, messaging/telephony, medical authorization, deployment
supervision, concurrent-user load, complete reconciliation/undo, and configuration
rollback still require their implementation/qualification phases.
