# WhatsApp calling with JARVIS (Meta Business Calling API)

**Status, 2026-10-12:** adapter scaffold implemented and unit-tested
(`project_hub/whatsapp_calling.py`, 7 tests; webhook routes live on the Hub).
No Meta account, number, or webhook is connected — live calls are blocked
until you complete the checklist below. This supersedes the old
"Twilio-only" note: Meta's own Cloud API is the selected route.

## Why this route

Telegram bots can never place or receive live calls (official Bot API has
voice *messages* only — confirmed against the current API reference). Meta's
[WhatsApp Business Calling API](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling)
explicitly supports business-initiated and user-initiated VoIP calls, raw
media streams, and AI voicebots answering calls. That is the only
provider-supported path to "call JARVIS inside WhatsApp".

## What is built

- Webhook verification handshake (`GET /api/whatsapp/webhook`, challenge echo,
  constant-time token check) and `X-Hub-Signature-256` validation on every
  inbound event. Forgery fails closed with 403; secrets never appear in
  errors or logs.
- Inbound projection: text, audio, tap payloads, and call signalling events
  (RINGING / ACCEPTED / REJECTED / terminate, direction, call id).
- Outbound: text messages, call-permission status checks, permission
  requests, and the full call lifecycle (`connect` with SDP offer,
  `pre_accept`, `accept`, `reject`, `terminate`, `media_update`).
- Presence endpoint (`GET /api/whatsapp/status`): booleans only.
- All validation happens before any network call; phone numbers and call ids
  are format-checked.

## Your Meta checklist (owner side, I cannot do these for you)

1. Create a **Meta Business account** and a **WhatsApp Business app**.
2. Attach a **business phone number** on the **Cloud API** (not the
   WhatsApp Business app) and grow its messaging limit to **2000+**.
3. **Enable Calling** on that number (call settings endpoint).
4. In the app dashboard, subscribe the webhook field **`calls`** (plus
   `messages`) to your public webhook URL (see ingress note below).
5. Save locally on the PC (never in chat): `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
6. **Grant the business call permission from your WhatsApp**: call the
   business number once, or approve its permission request — Meta requires
   the user's opt-in before the business may call them.

## Still blocked (honest list)

- **Stable public ingress.** Meta must reach our webhook over permanent
  HTTPS. Today's Cloudflare tunnel is temporary test access; a stable
  approved origin is the recorded production blocker.
- **WebRTC media bridge.** Signalling is built; call *audio* still needs a
  media stack (aiortc is not installed) bridging Meta's RTP/WebRTC stream to
  the local Whisper/Kokoro pipeline and the operator brain. That is the next
  implementation step after your Meta setup, and it decides real latency.
- **Call pickup discipline.** Meta hides the call button if we miss calls —
  the bridge must answer promptly once live.

Until then: Telegram voice notes + the one-tap browser call page remain the
working voice path, and every coding/mail/action power below works over them.
