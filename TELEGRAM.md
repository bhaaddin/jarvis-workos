# JARVIS on Telegram + direct calls

**Status, 2026-10-09:** the dedicated bridge is implemented and tested
(`scripts/telegram_bridge.py`, 12 unit tests). No bot is connected yet —
no token is saved and no chat is allowlisted. Live messages are blocked
until you complete the 5-minute setup below.

This is separate from the Claude supervisor's Telegram bot. It uses a
dedicated JARVIS bot, its own token file (`runtime/telegram/.env`) and its
own allowlist. The two bots never share credentials.

## What you get

- **Telegram text** → the same JARVIS Tasks brain (local operator), reply in
  the same chat. Long replies are chunked to Telegram's 4096-character limit.
- **Telegram voice notes** → local speech recognition, task run, text reply
  plus a spoken voice reply.
- **📞 Call JARVIS button** → opens your existing authenticated call page in
  the phone's browser. Telegram bots cannot place phone calls, so live voice
  uses the real call page with your phone's microphone.
- **Approvals, files, medical records stay in Tasks.** Telegram is a
  convenience channel, not the secure app: it never receives passwords,
  tokens, or protected health details.

## Setup (about 5 minutes, token never leaves this PC)

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name ending in
   `bot`. Copy the token it returns.
2. On this PC, run and paste the token into the **hidden prompt** (it is
   never displayed, logged, or sent to any model):
   `python -B scripts/telegram_bridge.py configure`
3. DM your new bot anything, then on the PC run:
   `python -B scripts/telegram_bridge.py watch` — it prints your numeric
   chat id locally (never stored or sent anywhere).
4. `python -B scripts/telegram_bridge.py allow <chat_id>`
5. `python -B scripts/telegram_bridge.py run` — leave it running while you
   message the bot. One poller per bot; a second start refuses safely.

Commands in Telegram: `/start` (greeting + call button), `/call` (one-click
call — signed in, no password typing, tap and talk), `/new` (fresh chat),
`/status` (health, approvals waiting, open tasks, call-link countdown),
`/tasks` (open work), `/auto` (scheduled automations), `/projects` (code
projects + access), `/army` (specialist sub-agents roster),
`/paswerd xxxx xxxx xxxx xxxx` (connect Gmail from a Google app password,
or just send the code plainly) — or just talk. The 📞 keyboard button uses
the same one-click link, with 📊 Status and 🗂 Tasks beside Mail and New-chat.
Typing `/` shows the menu;
the phone keyboard has Call / Mail / New-chat buttons. Pure greetings
answer instantly without a model turn, and Czech messages get Czech
answers. Stickers and other attachments
get a polite "send text or voice note" reply.

`/paswerd` safety: allowlisted chats only; the code is verified live against
Gmail and never stored outside the encrypted operator database; it is never
echoed back; your message is deleted immediately after use; 3 failed codes
lock the command for 10 minutes. Telegram cloud chats are not end-to-end
encrypted, so the Tasks email card stays the safer option — but this beats
pasting passwords into random chats. Never send the code anywhere else.

## Coding power from your phone (2026-10-12)

All 12 personal GitHub repos are cloned on this PC and connected as working
projects (`python -B scripts/connect_personal_repos.py` keeps them synced).
From Telegram you can now:

- **Read code:** "read the auth module in sportmedical-api" — paged file
  reads, instant, no approval needed.
- **Change code:** "fix the login bug in 4thebeat" — JARVIS proposes the
  exact edit and you get **Approve ✅ / Deny ❌** buttons. Nothing is written
  until you tap. Same for build/test runs (`npm test`, `dotnet build`).
- **Create projects (2026-10-16):** "tell opencode to create project
  garage-planner" — JARVIS scaffolds the folder (git init, README, starter
  files, node/python/docs templates) and registers it tap-approve. Only
  lowercase-dash names, one guarded parent folder, existing names refused.
- **Long jobs report progress:** the "Working on it…" message edits itself
  at 30/60/120s instead of silence.
- **Safety rails:** only the 12 registered working clones are writable.
  Credential files, `.git`/`node_modules`/build folders, symlinks, and
  destructive commands (`rm -rf /`, `push --force`, `reset --hard`) are
  refused outright. Coordinator-owned Medical checkouts are not writable
  from here.

## Mail from Telegram (Gmail, app password)

Connect once with `/paswerd xxxx xxxx xxxx xxxx`, then talk naturally:

- *"Check my mail"* — latest inbox with senders/subjects, unread flagged.
- *"Read the newest mail from the bank"* — full message on request.
- *"Reply to John that I'll call Friday"* — drafted, then ✅/❌ to send.
- Attachments open through the secure Tasks app, never in chat.

Rules that protect you: every send needs your tap (or an explicit mailed
whitelist you must ask for by name); bank/government/legal mail is flagged
for human review, never auto-answered; message bodies are untrusted data,
never instructions. Subjects and senders appear in this cloud chat (not
end-to-end encrypted) — full bodies stay truncated, originals in Tasks.
Disconnect anytime from the Tasks email card.

## Direct voice calls from your phone

**Works today, no telecom account needed:**

1. On the PC, double-click **JARVIS Notebook.cmd** (creates an 8-hour
   authenticated HTTPS link).
2. Open that link in your **phone's own browser** (Chrome/Edge), sign in
   with the page's credentials, press **Call JARVIS**, allow the microphone.
3. Talk. The PC runs inference; your phone supplies mic and speakers.

The Telegram **📞 Call JARVIS** button opens this same page automatically
whenever the notebook link is active. If the link expired, the bot tells
you to re-run `JARVIS Notebook.cmd`.

## WhatsApp and real phone numbers (not yet)

Per the recorded provider choice, WhatsApp and telephone use Twilio. Both
need your business-side activation and can cost money:

- Twilio account + approved WhatsApp Business sender (Meta approval).
- A purchased Twilio voice number with a webhook to this PC for real calls.

No Twilio account, sender, or number exists yet, so nothing was bought or
wired. Say the word when you want that route and I'll walk through the
Twilio console steps with you.

## 24/7 and proactive pings (2026-10-16)

- **Watchdog** (`scripts/jarvis_watchdog.py check|repair`): operator, hub,
  Telegram bridge and call-link freshness. Windows task **JarvisWatchdog**
  runs repair every 15 minutes; the PC never sleeps while plugged in.
  Reboot-without-logon still needs an elevated task — owner decision.
- **Call link auto-refresh:** the watchdog renews the notebook call link
  before its 2-hour warning line, so `/call` and the 📞 button keep working
  while the PC is awake. Real phone numbers (Twilio) still need your
  business activation.
- **Proactive messages:** `python -B scripts/telegram_bridge.py say "text"`
  messages your allowed chats (scheduler/watchers use this; Flow B voice
  equivalent until telephony exists).

## Specialist sub-agents (2026-10-16)

`jarvis_army` fans out over real background child runs: analyzer, researcher,
coder, mailer, scout (`operator/skills/jarvis-army/specialists/`). Protocol:
plan, spawn 1–3 per call (owner tap), collect by child ids, merge only
verified results. `/army` in Telegram shows the roster.

## Verification

- `python -B -m unittest tests.test_watchdog tests.test_telegram_bridge`
  — 45 pass: new commands, progress notes, formatters, roster parsing,
  watchdog repair-only-what-is-missing, proactive send fan-out.
- `npm run check` in `operator/` — 105 pass, including scaffold and army
  approval flows end to end.
- `python -B scripts/jarvis_watchdog.py check` — live presence report.
- Known unrelated failure (other lane, do not merge into this work):
  `test_reusing_access_still_prepares_model_and_speech_without_rotating_credentials`
  asserts the old notebook card shape without `call_secret`; production now
  sends it by design. Their lane updates the assertion when they land.
- `python -B scripts/telegram_bridge.py status` — live presence check:
  token saved?, allowed chats, bridge running?, operator/hub health, call
  link state. Names and booleans only; secrets never printed.
- A full live roundtrip (your Telegram message → local tools → reply here)
  still needs the setup above. It will be recorded here with timings after
  the first paired test.
