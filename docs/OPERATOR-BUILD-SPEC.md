# JARVIS operational assistant — approved build contract

Source: Matko's complete numbered request, 2026-09-27. This supersedes the
temporary demo's scope and its regex-based fast intent routing. Work through the
phases in order, make reversible implementation decisions autonomously, record
decisions and evidence, and distinguish working live integrations from staging
proof and missing credentials/contracts. Do not purchase services or fabricate
connected accounts. Preserve current work and repository ownership boundaries.

## 1. Core architecture

1. Agent loop: perceive → plan → structured tool call(s) → observe → continue/respond.
2. Proper function/tool-calling framework; no hardcoded natural-language intent matching with if/else or regex.
3. Separate orchestrator/brain, tool/skill registry, and channel adapters.
4. Persistent memory for preferences, conversations, names/vendors and standing instructions.
5. Separate short-term/session working memory.
6. Durable action queue: approval admission before execution admission.
7. Scheduler for autonomous background checks (email every 10 minutes, process checks every 5 minutes, etc.).
8. Discover skills from manifest + handler files on restart.
9. Internal event/pub-sub system separating channels, scheduling and core.
10. Structured tool-call inputs, outputs, decisions and latency, with the sensitive-data rules below.
11. Uncertain or unsafe actions go to approval rather than autonomous execution.
12. Environment configuration for enabled tools in dev/staging/prod.
13. Secrets only through environment variables/secrets management.
14. External API retry with exponential backoff; consequential ambiguous writes must not be blindly duplicated.
15. Integration circuit breakers isolate failures.

## 2. Voice and personality

16. Multi-voice TTS provider integration (ElevenLabs, OpenAI or Azure) with selectable voice list.
17. Settings for previews, voice, speed and pitch.
18. Formal-butler, casual and terse-ops personas.
19. Streaming TTS before the entire answer is generated.
20. Speech interruption stops output and resumes listening.
21. Wake word/call trigger or telephone call entry.
22. Reactive waveform/orb for idle, listening, thinking and speaking.
23. Natural spoken summaries of grounded data, not raw reports.
24. Professional small talk and rapport without filler/fake enthusiasm.
25. Consistent JARVIS identity and known user's name.
26. Czech/English at minimum, matching spoken language.

## 3. Messaging and phone channels

27. WhatsApp Business channel via a real supported API.
28. Telegram Bot API channel.
29. Unified normalized channel interface.
30. Voice-note transcription and text/voice-note responses.
31. Interactive approval/denial buttons.
32. Explicit 👍 executes the eligible pending action; 👎 cancels/skips; log the decision.
33. Real telephone channel (Twilio Voice or equivalent).
34. Proactive notifications on the user's active/preferred channel.
35. Persistent per-user channel preference.
36. Authorized cross-channel conversation/session continuity.

## 4. Calendar and scheduling

37. Google/Outlook Calendar read/write integration, configured for the actual business account.
38. Tomorrow's appointments: count, grounded total value, first and last time.
39. Create, move and cancel via natural-language tool selection.
40. Detect scheduling conflicts.
41. Proactive daily/weekly schedule digests.
42. Obtain appointment values from billing/pricing data; never guess.
43. Recurrence and appointment reminders.

## 5. Email and documents

44. Business email read integration (Gmail, IMAP or Microsoft Graph).
45. Classify invoice, bank notification, official/legal, spam, client inquiry, other.
46. OCR/PDF + structured extraction of vendor, amount, due date.
47. Detect missing expected invoices/vendors/services.
48. Generate outgoing invoice drafts and hold sending for approval.
49. Daily good-news/bad-news inbox digest with overdue/action items.
50. Bounded attachment download, protected storage and references.
51. External email/invoice sending always requires explicit approval unless explicitly whitelisted in settings.
52. Sender verification/phishing flags; official/bank/government messages receive human review.

## 6. Monitoring

53. Named process/application running status via real OS inspection.
54. Claude/OpenCode status and latest configured activity/log timestamp.
55. Authenticated machine agents reporting heartbeat and process state.
56. Proactive unexpected-stop/crash alerts.
57. Approved or explicitly whitelisted restart of configured processes.
58. CPU, memory, disk and API health summaries.
59. Bounded log tail/search, including errors in a time window.

## 7. SportMedical (eventual operational integration)

60. API adapters for Booking, Billing, Diagnostics and App; no direct access to their databases.
61. Query bookings by date/status/value.
62. Query paid, unpaid and overdue billing records.
63. Query diagnostics status/results with strict authorization.
64. Verified caller identity and role-based access control.
65. Audit every SportMedical read/write.
66. Front-desk flows: check-in, rebooking, payment reminders, result-availability notices. Diagnosis content requires explicit authorization.
67. PII/PHI-safe logs and external messages; sensitive medical details stay on secure channels.

## 8. Approval/trust

68. Money-moving and externally visible actions default to propose/confirm unless explicitly whitelisted.
69. Permission settings per action type: automatic versus always ask.
70. Approval history distinguishes manual and automatic decisions.
71. Undo only where reversible/provider-supported; never claim a sent message was recalled if it cannot be.
72. Rate-limit autonomous actions and message bursts.

## 9. Extensibility

73. `/skills/<name>/manifest.json` + handler convention independent of core code.
74. Reuse proven OSS patterns/integrations; assess licenses.
75. Code/shell execution only through a sandboxed, permissioned executor.
76. Startup skill health checks; missing config/credentials visibly disable skills.
77. Version skills and guard incompatible updates.
78. Document structured tool inputs/outputs for model selection and validation.

## 10. Reliability/operations

79. Meaningful unit and end-to-end/integration tests for tools and user flows.
80. Explicit staging environment with synthetic calendar, inbox and SportMedical data before production connections.
81. Useful structured errors and truthful retry/recovery messages.
82. Monitor the assistant itself and notify someone if it is unavailable.
83. Version and roll back prompts/configuration.
84. Concurrent voice load qualification if serving more than one person.

## 11. Build order

85. Phase 1: core, structured tool calling, memory, registry (sections 1, 9).
86. Phase 2: voice, streaming, interruption, personas, orb (section 2).
87. Phase 3: WhatsApp/Telegram/phone and approval buttons (section 3).
88. Phase 4: calendar/email/documents/invoices/digests (sections 4–5).
89. Phase 5: system/process monitoring (section 6).
90. Phase 6: SportMedical API read-only first, then authorized writes (section 7).
91. Phase 7: approval/settings/audit UI (section 8).
92. Phase 8: staging, tests, self-monitoring, load tests, rollback (section 10).

Implementation preference: Node/TypeScript orchestrator/channel adapters; Python
ML/NLP services over internal REST/gRPC. Solid core first; do not invent
SportMedical endpoints or direct database integrations to fill missing APIs.
Every vendor selection and consequential design choice belongs in the decision
log. A credential-blocked live provider is not an implemented-and-verified live
connection, even if its staging/contract tests pass.
