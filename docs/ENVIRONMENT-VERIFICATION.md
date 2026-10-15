# Environment and resource verification — 2026-10-01

Matko selected **development environment, assistant architecture and resource
efficiency**. This pass implemented one integrated setup/diagnostics/resource
workflow in JARVIS WorkOS. SportMedical application source was not part of this
implementation.

## Implemented boundaries

- `scripts/dev.py`: focused doctor, reproducible dependency/build setup, native
  startup, verification and local resource-management CLI.
- `scripts/build-stamp.mjs`: source/output identity; startup rejects stale builds
  and detects a running process with an older build.
- `scripts/setup_table_engine.py`, `operator/src/table-engine.ts`: source-bound
  image installation and runtime validation using `runtime/table-engine.json`.
- `operator/src/runtime-control.ts`: model-aware status, cached metadata queries,
  guarded standby/wake and persistent residency profiles.
- `operator/src/model-metrics.ts` and per-run performance: bounded numeric-only
  telemetry, with no model prose or reasoning copied into metrics.
- `operator/compose.model.yaml`: independently startable native model service,
  also reused by the retained full Gateway compose definition.
- Actual Tasks sidebar **Runtime & resources**; private management operations
  remain outside the Hub/notebook proxy's writable routes.

## Actual checks

All paths below are relative to `C:/Users/Matko/Jarvis-WorkOS`.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -B scripts/dev.py setup` | Both `npm ci` installs, pinned Python install/`pip check`, source-labelled container build and both application builds passed | `logs/environment-setup-20261001T082836465893Z/` |
| Operator build/tests | **57 tests passed**, zero failures/skips; **1 additional build-identity guard test** passed | `logs/operator-check-2026-10-01T08-49-03-965Z/` |
| Hub/frontend checks | **83 Python tests**, **27 frontend tests**, frontend build and listed syntax checks passed | `logs/project-checks-20261001T085547Z/` |
| Native startup with speech | Model/speech services, speech warmup, actual inference warmup and owned operator startup passed | `logs/native-start-20261001T085548083920Z/` |
| Actual runtime UI | Model panel, authenticated diagnostics, blocked management proxy, actual calculator1081, timing data and content-free telemetry passed | `logs/runtime-ui-2026-10-01T08-49-26-384Z/results.json` |
| Selected-model/privacy proof | Actual clock, encrypted memory/restart, active model log policy and marker scan passed | `logs/operator-live-2026-10-01T08-57-58-975Z/results.json` |
| Renewed notebook task access | Unauthorized access/management rejected; actual PDF downloaded; exact relative reminder actually fired | `logs/notebook-tasks-2026-10-01T08-58-10-251Z/results.json` |

The final doctor reported valid builds, matching running build, complete private
configuration, pinned document dependencies, verified table-image provenance and
available services/model. Its warm/cold field is a point-in-time observation;
model availability does not require keeping GPU allocations resident forever.

## Resource measurements

The selected model stayed **Qwen3.8-27B**, native **xhigh**, context32768 and output
allowance8192 throughout the profile/standby checks.

- Balanced profile set a900-second lease with a corresponding model expiry:
  `logs/resource-operation-20261001T084219257083Z/`.
- Standby changed the selected model state to **cold**, while it remained installed
  and available for a future task. NVIDIA memory usage fell from **14,293 MiB to
  883 MiB**: **13,410 MiB released**.
  `logs/resource-operation-20261001T084220360063Z/`.
- Actual inference wake restored the same model/context/GPU assignment:
  `logs/resource-operation-20261001T084315894306Z/`.
- The final profile was restored to **interactive**. After the reload correction
  below, profile changes took **0.344s** and **0.366s** and did not change device
  memory use: `logs/resource-operation-20261001T084925590089Z/` and
  `logs/resource-operation-20261001T084926165989Z/`.

These are individual device snapshots, not an energy-efficiency benchmark. Power
draw was recorded but varies with recent load and other desktop activity. Ollama
GPU-assignment bytes are distinguished from physical device memory usage.

## Failures found and corrected

### Profile changes originally forced a runner reload

The first runtime UI proof passed functional checks but took **52.946s**. New
per-run metrics identified **46.916s** of model loading, despite a preceding wake:
`logs/runtime-ui-2026-10-01T08-44-04-014Z/results.json`.

Source inspection of pinned Ollama `server/sched.go` showed that
`runnerRef.needsReload` reloads when `contextShift` changes. The empty lease-refresh
request inherited the default `shift=true`, while normal native chat explicitly
uses `shift=false`. The refresh now uses the same `shift=false` /`truncate=false`
policy. The regression test checks this wire contract.

After correction, the same runtime UI qualification completed its checked task in
**2.203s**, including **63ms model-load overhead**, approximately472ms prompt
evaluation and1.630s generation. This demonstrates eliminating this specific
reload; it is not a claim that every assistant workflow is24 times faster, nor an
end-to-end spoken-answer measurement.

### Windows could reset a denied POST before its HTTP status was read

The initial combined verification retained a `WinError10053` in a notebook relay
management-denial test:
`logs/project-checks-20261001T083052Z/behavior-tests.log`.

The relay could close with a small unread request body. It now discards only a
bounded declared body on early rejection, with a short timeout, and explicitly
closes the HTTP connection. It never parses or forwards rejected input. A split
header/body test and the full subsequent suite passed; failures were not hidden
by adding retries to the verifier.

Reference: Microsoft's
[Winsock connection shutdown guidance](https://learn.microsoft.com/en-us/windows/win32/winsock/graceful-shutdown-linger-options-and-socket-closure-2)
and [unread-data abort tracing](https://learn.microsoft.com/en-us/windows/win32/winsock/winsock-tracing-event-details#afd-initiated-abort).

## Installed table-engine provenance

Current machine record: `runtime/table-engine.json`.

- Image: `sha256:b8c4025aee1f6b200dba7a7f3a5e852aaeddc01d62d3539a2091bbd0f4a74b08`.
- Source identity: `8f8c29d6f6a3f5bace88ad7c9ec7a495fa98aca229de10b2687e566aabf9025a`.
- DuckDB1.5.6 and pinned Python base retained.
- An unchanged repeat `install` verified/reused the existing image.

Run guide: [DEVELOPMENT.md](../DEVELOPMENT.md). The remaining business-account,
Medical API/build and production qualification gates remain separate; infrastructure
checks do not establish clinical correctness or a completed production rollout.
