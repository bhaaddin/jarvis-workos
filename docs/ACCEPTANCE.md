# Acceptance runs (owner's real failures)

Runner: `scripts/acceptance.py`. Raw JSON per run under `logs/acceptance-*/`.

## 2026-10-14 — 8/8 passed (evidence: logs/acceptance-20261014T141955)

- bus-tool 0.4s: real departure (BUS 650 Slaný→Kladno 14:20→14:49).
- bus-agent 66.3s: Czech answer with real times via jarvis_transit.
- skills-live: 38 ready. opencode-status 0.3s. approval-deny clean.
- mail-honest: MAIL_CONNECTION_REQUIRED (mailbox still unconnected).
- owner-todo: 8 credential steps. unknown-fast 40.1s completed.

## 2026-10-14 earlier — 6/8 (root cause found, fixed)

bus-agent + unknown-fast hit 171s empty: every model call died at exactly
180s (INTERNAL_ERROR). Diagnosis: GPU showed 14.3GB used with NO process
attached (P8 idle) — five days of uptime (boot Oct 9) left ghost model
state; runners thrashed (8 tokens in 72s, empty). Fix without touching the
service: model unload (`keep_alive: 0` → 880MB) + reviewed warmup reload
(46.8s, all layers on GPU). Verified healthy: 39 tokens in 0.8s.
Lesson: weekly GPU-state check belongs in routine ops; a reboot or unload
cycle clears this class of wedge. No config was changed.
