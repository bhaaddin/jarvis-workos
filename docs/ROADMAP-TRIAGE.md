# Roadmap triage (2026-10-13)

Owner spec: `ROADMAP.md`. Status per section against the live system.
Legend: DONE · PARTIAL · NEW (accepted, to build) · BLOCKED (needs owner/external)
· CONFLICT (spec line vs standing rule — needs design decision, not silent build).

- **A free-tier model router: CONFLICT.** Standing rules keep the selected
  local Qwen3.8-27B/xhigh and patient data local-only. A cloud free-tier
  router would punch holes in both. Accepted slice: local fast-lane routing
  (qwen3.5:9b installed) per question — needs owner's explicit speed/quality
  tradeoff approval first. API keys, quota dashboards, Cloudflare/HF tiers:
  NEW, only with owner approval per provider.
- **B agent brain: DONE** (loop, JSON-schema tools, guards, idempotency,
  approvals, interrupt/cancel). Sub-agent specialists: NEW.
- **C memory: PARTIAL.** SQLite FTS + encrypted store DONE. Vector/hybrid
  search, auto-extraction, per-area spaces: NEW (mem0 parked as reference).
- **D voice input: PARTIAL.** Local Whisper/Silero VAD/barge-in DONE. Wake
  word, diarization, speaker ID, 300ms target: NEW.
- **E voice output/personality: PARTIAL.** Kokoro + captions + mute DONE.
  Czech voices NOT configured (English-only) — biggest girlfriend-call gap
  after speed. Persona presets: NEW.
- **F conversation: PARTIAL.** Grounding/citations DONE. Humor sliders,
  proactive suggestions: NEW.
- **G UI: PARTIAL.** Hacker call theme DONE 2026-10-13. Orb, settings pages,
  PWA, onboarding: NEW.
- **H channels: PARTIAL.** Telegram bot DONE (text/voice/buttons/menus, no
  live calls possible — platform limit). WhatsApp scaffold DONE, live needs
  owner's Meta setup + ingress + WebRTC bridge. Phone numbers: BLOCKED
  (Twilio/Meta purchase). Others (SMS/Signal/webchat/API): NEW.
- **I email: PARTIAL.** IMAP/SMTP + tap-approve sends DONE. Gmail API/OAuth,
  classification, digests, follow-ups: NEW/BLOCKED (OAuth).
- **J calendar: NEW.** No calendar integration exists; Graph/Google both need
  owner's OAuth setup.
- **K finance: PARTIAL.** Paper/research/study DONE. Invoicing/bank/QR:
  NEW (bank stays read-only by rule).
- **L coding: PARTIAL.** jarvis_code read/edit/run/scan + tap-approve DONE
  for 12 repos. Commit/push allowed, --force refused. PRs, CI watch,
  parallel agents: NEW.
- **M monitoring: PARTIAL.** computer.read DONE. Agents/heartbeats/incidents:
  NEW.
- **N browser/computer: PARTIAL.** web.read, browser.run, computer.read
  DONE. Credential vault logins, desktop control: NEW.
- **O documents: DONE** (create/read/OCR-flag/search).
- **P research: PARTIAL.** web.read + ddgs skill DONE. SearXNG/ARES/CNB
  monitors: NEW.
- **Q1–Q7 SportMedical: PARTIAL.** Read-only clinic + booking reads DONE.
  Writes, billing, productization: NEW, clinical decisions never.
- **R safety: DONE** and non-negotiable; free-tier auto-send ideas from the
  spec CONFLICT with it.
- **S proactive: PARTIAL.** Schedules/reminders/Finance briefings DONE.
  Morning brief assembly: NEW.
- **T skills/GitHub: PARTIAL.** Catalog + install/enable flow DONE (8 live).
  Self-extension loop: NEW.
- **U–V personal/business/social: NEW** except reminders/tasks.
- **W learning: NEW** (feedback loop, eval set, prompt versioning).
- **X observability: PARTIAL.** Numeric-only telemetry DONE; SLOs/tracing:
  NEW.
- **Y testing: DONE** (89 operator + 39 frontend + 100 Python tests,
  live proofs).
- **Z infra: PARTIAL.** Compose DONE; stable ingress BLOCKED.
- **Z2–Z5: NEW** (settings UI, GDPR tooling, Czech localization beyond
  replies, smart home).

Reference adoptions 2026-10-13: mem0 (memory upgrade candidate, parked),
nanoclaw (channel/scheduler ideas, evaluating), semgrep (adopted as tool),
smolagents (rejected — duplicates tested loop), Gmail MCPs (rejected — same
OAuth wall, zero gain).
