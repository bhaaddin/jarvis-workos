# Live activation requirements

**Addendum, 2026-10-12:** Telegram bridge is live (@Bahaoanabot, allowlisted
owner chat, tap-approve buttons). WhatsApp follows Meta's Business Calling
API — adapter scaffold implemented/tested, live calls need the owner Meta
checklist, stable ingress, and the WebRTC media bridge:
[WHATSAPP-CALLING.md](../WHATSAPP-CALLING.md). Coding from messaging apps
uses `jarvis_code`/`jarvis_code_read` (12 working clones, approval-gated
writes). The rows below remain the 2026-09-30 snapshot otherwise.

Current update, **2026-09-30**: [TASKS.md](../TASKS.md) records implemented IMAP/SMTP
and SportMedical read adapters. The deployed status still reports no connected
mailbox, SMTP configuration or clinic session. **Medical API5092 is offline**;
an isolated Sept6 DLL failed the anonymous-protected-read check, and committed
backend HEAD5e2afde failed a clean build on CA1711 in `Permission`/`RolePermission`.
Exact commands, binary hash and retained failures are in
[model/Medical qualification](OPERATOR-MODEL-QUALIFICATION.md). Login now requires
a healthy recognized API contract that rejects anonymous protected reads. The
connector is read-only; account sign-in does not add appointment writes.

OAuth-only mail providers, Google/Outlook calendar, telephony and messaging still
require their actual activation work. Production APIs without public OpenAPI need
a reviewed pinned-contract discovery mechanism; that path is not implemented yet.

Presence-only check, 2026-09-27:
`logs/operator-credentials-20260927T151617Z/presence.json`.
The project environment and current process have no JARVIS-specific credentials
for the live integrations below. Existing coding/assistant subscriptions and the
Claude supervisor's Telegram pairing are not interchangeable credentials.

| Integration | Required access/configuration | Impact |
| --- | --- | --- |
| Business calendar/mail | Confirm business provider, then Microsoft Graph tenant/app/authorized mailbox credentials or Google OAuth client + authorized refresh token | Actual inbox/calendar read/write and live digest proof blocked |
| Czech hosted speech | Azure Speech resource key/region (or explicitly chosen supported hosted provider) | Native Czech voice and hosted pitch/voice-list proof blocked |
| Telegram | Dedicated JARVIS bot token and webhook secret; authorized user mappings | Live messages/voice notes/buttons blocked |
| WhatsApp/telephone | Twilio account/auth credentials, approved WhatsApp sender and voice number | Live messaging and calls blocked; no number purchase made |
| Production identity/ingress | OIDC issuer/audience and stable approved HTTPS origin | Production staff login, durable webhook hosting and real medical access blocked |
| SportMedical services | Current API contracts, authorized service URLs/tokens and test tenant | Real Booking/Billing/Diagnostics proof blocked; no direct clinic DB access |
| Other monitored machines | Installation/access to each named machine and per-device enrollment | Remote installation and heartbeat/restart proof blocked |

Staging and local implementation can proceed independently. Credentials must be
entered through local environment/secrets configuration, never pasted into logs,
public documentation, worker snapshots or persistent project-memory notes.
Provider selection/configuration is a documented activation decision; simulated
fixtures must remain visibly identified and cannot count as a connected account.
