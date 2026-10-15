# Operational core — verification and requirement map

**Current checkpoint:** [quality upgrade](OPERATOR-QUALITY-UPGRADE.md) supersedes
the model-only checkpoint below: Qwen3.8/native inference, checked table workflows,
52 operator tests,78 Hub/backend tests,27 frontend tests and fully inspected
hard-case artifacts. It preserves failed comparisons and the verifier paging
correction. Latest public voice sample10.825s; target remains unmet.

**Latest checkpoint,2026-09-30:** [model/Medical qualification](OPERATOR-MODEL-QUALIFICATION.md)
records the deployed27B model,42 operator tests,77 Hub/backend tests,27 frontend
tests, actual UI/public notebook jobs,12.64s public voice sample and precise
Medical build/API blockers.

**Later task-capability checkpoint:** [TASKS.md](../TASKS.md) records the now-running
user-facing task interface and actual document/computer/browser/code/voice jobs.
The original core checkpoint below is retained as historical foundation evidence;
its “remaining implementation” table is not the latest task-pack inventory.

Checkpoint: **2026-09-27**. Contract:
[OPERATOR-BUILD-SPEC.md](OPERATOR-BUILD-SPEC.md). Implementation/run guide:
[operator/README.md](../operator/README.md). Decisions:
[OPERATOR-DECISIONS.md](OPERATOR-DECISIONS.md).

This is a verified staging foundation, not completion of the 92-item operational
assistant or qualification for patient-facing production use.

## Latest checks

From `C:/Users/Matko/Jarvis-WorkOS/operator`:

| Check | Actual result | Retained evidence |
| --- | --- | --- |
| `npm run check` | TypeScript build exit 0; **31 tests passed**, zero failures/skips | `logs/operator-check-2026-09-27T17-37-18-667Z/` |
| `npm run probe` | Actual loopback HTTP → Node queue/registry → dedicated OpenClaw SSE → model-selected clock → grounded answer; exit 0 | `logs/operator-live-2026-09-27T17-37-20-984Z/results.json` |
| Dedicated Gateway repair/start | Owned seed migration and supported Doctor completed; Compose waited for healthy container | `scripts/operator_brain.py repair`; deployed boundary 0.2.0 / protocol v2 |

Paths in the evidence column are relative to the WorkOS root. Check directories
contain full stdout/stderr and original exit status. Live proof uses a separate
synthetic encrypted database under `runtime/operator-probes/`; its temporary
HTTP listeners are closed at completion. A permanently supervised Node service
or new user-facing operational UI has not been installed by the probe.

### What the tests cover

- Session/Origin/CSRF admission, strict request schemas, stale actor revisions
  and conversation ownership before tool execution/events.
- Real registry/service/action execution for a synthetic approved send: no effect
  before approval, ten-second cancellation window, one local receipt, no external send.
- Approval/input/fingerprint binding, concurrent claim deduplication, revocation,
  expiry, late-worker fencing and uncertain post-dispatch outcomes.
- Queued cancellation, interrupted working-history repair, whole-batch tool-call
  identity/budget preflight and idempotent finalization after a lost acknowledgement.
- Separate streamed finalization and ordinary no-tool completion without an
  unnecessary extra model generation.
- Encrypted memory restart, tenant separation, authenticated-record binding,
  strict finite JSON, elevated result sensitivity and insecure-channel denial.
- Manifest/code version quarantine, invalid-plugin isolation, cancellation of
  non-cooperative reads, declared schemas and actual output sensitivity.
- Safe external retries, ambiguous-send handling and isolated circuit failures.
- Fragmented SSE/UTF-8/function arguments, incomplete streams, provider errors,
  incognito headers and refusal of an insufficient native logging boundary.
- Read-only schedule admission, revision/permission fencing, coalesced downtime,
  overlapping ticks, restart/lease recovery, stale result rejection, Czech DST,
  explicit UTC/local clock facts and safe notification replay/acknowledgement.
- Additive migration of both owned v1 database variants, preserving encrypted memory.

These are foundation/staging checks. Calendar, email, SportMedical, telephony,
production SSO and actual multi-user voice load are not exercised by them.

## Live proof and performance

Latest answer: “The current local date is 2026-09-27 in the Europe/Prague timezone.”
The model selected `jarvis_clock`; Node executed the registered read and returned
its observation. No intent regex selected the tool. The proof also saved a
synthetic preference through the action owner, restarted the Node service and
retrieved the same memory. The marker was not plaintext in the closed Node DB.

Latest measured **text request → completed answer: 3.678 seconds**. Earlier
samples using the redundant final-generation path ranged roughly 4.8–10.8 seconds.
The latest sample demonstrates the removed extra model turn, not a stable latency
distribution or a first-audible voice benchmark. Qwen 3.5 9B/high configuration was
preserved; the 1–2-second useful-speech and <200-ms interruption targets are not
established for this new operational path.

### Expanded native privacy/authority proof

- Actual Docker logging driver is **`none`**, verified by inspection before inference.
- Native logging configuration and environment satisfy the v2 readiness contract.
- Real authenticated `/tools/invoke` probes for `exec`, `read`, `write`, `message`,
  `sessions_list`, `session_status`, `memory_search` all returned **404 unavailable**.
  These are explicit negative probes, not a complete catalog/security audit.
- A separate model turn deliberately returned the exact synthetic private marker,
  exercising assistant-output privacy, not only private input.
- No marker was found in the scanned native state/log trees
  `/home/node/.openclaw` and `/tmp/openclaw` (bounded to files below 50 MB).
- Normal operational diagnostics remain structured Node audit/error/latency records.
  The native Gateway's unfiltered assistant console prose is not retained.

Earlier incognito file-only scans missed Docker console retention. The earlier
`logs/operator-brain-20260927T154805Z/results.json` privacy flag is **narrower and
superseded for logging qualification**. D020 records the observed console leak,
source analysis and repair. Keep the earlier evidence; do not label it proof of
complete native privacy. Tests remain synthetic and do not certify clinical use.

## Requirement map and remaining work

| Contract IDs | Current evidence/status | Remaining implementation or activation |
| --- | --- | --- |
| 1–3 | Real structured agent loop; separate brain/registry/control service | Channel adapters and production load qualification |
| 4–5 | Protected durable facts/conversations and bounded protocol-valid working history | Richer memory lifecycle/UI and retention controls |
| 6, 11 | Durable approval/action queue; uncertain writes fail closed | Provider reconciliation and operational review UI |
| 7, 9 | Durable read schedules, process-local pub/sub and protected notification replay | Real inbox/process providers and channel delivery receipts |
| 8, 12–13, 73–74, 76–78 | Versioned discovered plugins, schemas, startup health, environment/secret boundaries | More actual integration skills and production deployment qualification |
| 10, 14–15 | Protected/redacted audit payloads; bounded retry/circuit implementation tested | Actual provider-specific failure/receipt tests |
| 16–26 | Earlier separate voice demo is a reuse candidate; language/clock grounding improved here | Connect operational core to voice/personas/settings/orb, hosted Czech voice, language and latency acceptance |
| 27–36 | Control/event/notification boundaries exist | Telegram/WhatsApp/phone, signed callbacks, enrollment, channel preferences/continuity and delivery |
| 37–52 | No business office account connected; generic fixture receipt only | Calendar/inbox/document adapters, synthetic domain datasets, pricing-grounded flows and authorized live proof |
| 53–59 | No new operational machine-monitoring adapter installed | Enrollment, real process/health/log reads, stop alerts and approved restarts |
| 60–67 | Foundational actor/tenant/privacy checks; no clinic database access added | Actual API contracts/test tenant, production identity, medical permissions and read-first integrations |
| 68–72 | Approval/whitelist/rate/history foundations tested | Complete settings/audit UI, provider-supported undo and reconciliation |
| 75 | No arbitrary shell/generated-code executor exposed | A real sandboxed executor if/when execution is enabled |
| 79–80 | 31 core tests plus real synthetic HTTP/model proof | Synthetic calendar/inbox/medical datasets and their integration scenarios |
| 81–84 | Typed errors, health endpoint and safe recovery foundations | Full self-monitoring/notification, backups, prompt/config rollback and concurrent voice load |

Live credentials/access remain listed in
[OPERATOR-LIVE-BLOCKERS.md](OPERATOR-LIVE-BLOCKERS.md). Staging success is not a
connected business account. The next prescribed phase is operational voice and
personality integration, with continued latency work before claiming voice acceptance.
