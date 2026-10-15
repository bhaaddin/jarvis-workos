# Agent army: plan first, load only what the task needs (2026-10-13)

Owner directive: specialists (analyzer, researcher, coder, mailer, …) coordinated
by the main agent; nothing loads until the plan assigns it; no wasted
tokens/time/energy; 24/7 operation; trading/market work included.

## What exists today (no new code needed to use)

- **Domain tool groups** (`operator/src/tool-window.ts`): documents, projects,
  web, tasks, mail, clinic, computer, code (+ new: czech/finance groups to add).
  The model explicitly loads a domain before working. Keep `toolDiscovery`
  off: the 2026-09-30 qualification failed the auto-discovery prototype, so
  selection stays model-explicit, not automatic.
- **Plan-then-run**: the agent already plans multi-step work; approvals show
  the exact action before it runs. Every run is bounded (max steps/calls/ms).
- **Background execution**: runs, scheduler, action queue run 24/7 while the
  PC is awake. PC sleep is the real limit, not the software.
- **Market analysis (read-only)**: Finance briefs, OpenBB data, CNB rates,
  ARES company checks. Live trading with real money is NOT enabled: standing
  rule is paper/virtual only, no exchange credentials. Changing that needs an
  explicit rule change + credentials, not a skill install.

## Designed next (not built yet)

- **Orchestrator pattern**: main run writes a short plan, spawns one child
  run per specialty in its own conversation, polls them, merges bullets.
  Child runs reuse the existing `/api/chat` + run-polling machinery; no new
  runtime needed, but admission/concurrency guards must be proven first.
- **Specialist prompts**: per-area system slices (analyzer, deep researcher,
  coder, mailer, calibrator) as versioned prompt files, not code.
- **Lazy skill weights**: track tool use per task type; suggest disabling
  never-used skills to slim prompts. Manual step, reported in reviews.

## Honest limits (do not promise otherwise)

- Telegram/WhatsApp live calls: platform-blocked (bots can't call). One-click
  browser call is the real path.
- 24/7 means 24/7-awake-PC. Overnight Windows sleep/hibernate kills the bot,
  the tunnel, and warm models alike.
- Real-money trading: refused until the research-only rule is explicitly
  lifted by the owner.
