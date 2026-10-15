# Instagram and TikTok contact research

Implemented 2026-10-06 in **JARVIS Tasks → Social contacts**.

The agreed first search is **20 fitness creators in Prague, Czech or English,
for a paid collaboration**. All criteria are editable for subsequent searches.
Messages are drafted for you to review, copy and send yourself.

## Connect the accounts

1. Open JARVIS Tasks on the PC or through the current private notebook link.
2. Select **Social contacts** beside **Assistant**.
3. Select **Sign in to Instagram** and **Sign in to TikTok**. Separate browser
   windows open on the powerful PC; use TeamViewer to reach them from the notebook.
4. Enter credentials and complete verification directly on each platform.
5. JARVIS saves the session automatically once the platform's sign-in state is
   ready and stable, then closes that dedicated window. The manual **Save
   connection** button remains available as a fallback.

Sign-in windows expire after 20 minutes. **Close sign-in** closes only that pending
window; **Disconnect** also removes the saved connection. A saved session is not
a promise that all searches will be accessible: the actual platform read checks
for login, verification, unavailable pages and visible results.

**Updated 2026-10-09:** automatic capture checks current owner permission,
first-party session cookies, the platform origin and visible login/verification
controls. It does not read entered credentials, private feed text or inbox content
for this readiness check. Two consistent checks are required before automatic
capture. A closed/expired attempt cannot save late or close its replacement;
concurrent manual/automatic completion saves the same attempt once.

Sessions are private to the signed-in JARVIS account. Saved first-party cookies
and local storage use the existing record-bound encryption. The application does
not ask for platform passwords, reuse your ordinary browser profile, or return
session secrets to the model/UI. Supported platform/CDN hosts are explicit.

## Find, review and message

1. Fill in **Niche / keywords**, **Location**, **Languages**, **Outreach purpose /
   offer**, platforms and a target count from 1 to 20.
2. Optionally paste known profile URLs to inspect those accounts directly.
3. Select **Find and save profiles**. The assistant uses the structured social
   research tool, saves observed candidates, and reviews their source evidence.
4. Inspect each profile's bio, source state, observation time, public contact
   details and quoted match evidence. Unknown criteria stay unverified.
5. Use **Generate draft** for one profile, or select up to five and choose
   **Draft selected**. A draft uses your stated offer and saved profile evidence.
6. **Review / edit** lets you edit the draft, notes and tracking stage. **Copy
   draft** copies text; open the profile or public email to send it yourself.
7. Mark **Contacted** after you actually reach out. Export the saved list with
   **Export CSV** when needed.

Researching an existing profile updates its observations while retaining your
notes, draft and contacted state. An assessment is flagged stale if its underlying
source text changed. Revision checks prevent a stale edit overwriting newer work.

The workspace shows the most recent 100 saved profiles and 20 search summaries.
Results can be filtered by text and tracking stage. Native social-site results
are candidates, not guaranteed matches or a complete directory of all creators.
Profiles, emails, phone links and follower text are recorded only when observed;
unavailable fields are not inferred. A grounded match explanation requires an
exact quotation from the saved source text.

## Platform access and current qualification

**Live signed-in profile discovery is still awaiting account sign-in.** At the
2026-10-06 deployment check, both platform sessions were `awaiting_login`, with
no real contacts saved. Instagram's unauthenticated page required login. TikTok's
unauthenticated search displayed a platform/server error. Neither was reported as
zero matching creators or as successful discovery.

The 2026-10-09 continuation restored stopped application services and again found
no saved social sessions. Automatic handoff was deployed and new dedicated sign-in
windows opened. The live search runner submitted no search while either selected
platform lacked a completed connection.

The end-to-end workspace was verified with **20 explicitly synthetic profiles**:
save, draft, copy-button wiring, contact tracking, filtering, actual CSV download,
reload persistence and mobile layout. Separately, the actual configured local
model read a saved synthetic profile and saved a source-quoted match explanation
and outreach draft. These checks qualify the application workflow, not access to
your social accounts or a real list of 20 creators.

After sign-in, run the agreed real search and check the observed profiles before
treating the live discovery step as qualified. If a platform requires verification
or refuses a search, complete its normal account steps or inspect supplied profile
URLs; the application reports the actual partial/access state.

## Implementation and verification

- Tools: `jarvis_social_research`, `jarvis_social_contacts`,
  `jarvis_social_contact_update`.
- Search and contact updates are admitted internal actions; this feature has no
  DM/email-send operation. Search reads use a separately authorized platform session.
- Research is bounded to 20 profiles and a 100-second browsing budget. Results
  identify partial completion; the assistant's existing run budget still applies.
- Compact result identities keep the complete candidate list available to the
  model; full source reads use batches of up to five contacts.
- `operator/src/social-{model,browser,store}.ts`, `social.ts`: parsing, browser
  sessions, research and encrypted persistence.
- `frontend/src/SocialContacts.tsx`, `social.css`: connected workspace.
- `project_hub/operator_client.py`: explicit account/contact route proxy.

Commands from `C:/Users/Matko/Jarvis-WorkOS`:

```text
npm --prefix operator run check
python -B scripts/verify_projects.py --frontend
node operator/scripts/prove-social-contacts.mjs --native-draft
node operator/scripts/probe-social-platforms.mjs
node operator/scripts/social-connect.mjs status
node operator/scripts/social-connect.mjs open
node operator/scripts/prove-social-access.mjs
node operator/scripts/run-social-example.mjs --run
```

The workspace proof uses an isolated tenant/database, synthetic platform data and
a local test HTTP bridge; it does not populate the real contact list. The copy
test uses an isolated clipboard stub to preserve the PC's clipboard. The public
access proof uses the current private notebook card internally; no credentials
are retained in its report.

### Retained evidence

| Check | Evidence relative to the workspace |
| --- | --- |
| Final 72 operator tests, one build guard and build | `logs/operator-check-2026-10-06T21-42-50-884Z/` |
| Final 99 Python/Hub tests, 39 frontend tests and frontend build | `logs/project-checks-20261006T214250Z/` |
| Full synthetic workflow and actual-model draft | `logs/social-workspace-2026-10-06T21-20-41-659Z/results.json` |
| Repeated full synthetic UI/API/store workflow | `logs/social-workspace-2026-10-06T21-36-45-081Z/results.json` |
| Actual unauthenticated platform responses | `logs/social-platforms-2026-10-06T21-42-58-862Z/results.json` |
| Actual deployed notebook UI, scoped status and mobile layout | `logs/social-access-2026-10-06T21-47-32-817Z/results.json` |

The real-model draft test took **55.392 seconds**. It produced a generic paid
collaboration invitation using the saved Prague fitness bio, without inventing a
brand/budget or marking the contact as contacted. It did not send any message.

Retained corrections: initial compile/count typing and an assertion expecting the
wrong failed-action shape; a contact-stage accessible label; a fixture download
interception replaced by a real local HTTP test bridge; delayed Instagram login
rendering; and missing TikTok European CDN/service hosts identified from actual
first-party page requests. Guest TikTok search still returned its own error after
those host fixes; this is an outstanding live-access qualification, not a passed
search.

### Automatic sign-in handoff — 2026-10-09

- Regression evidence before the repair: `logs/social-auto-login-before.log`
  records the missing automatic save and the late-save/replacement-window race.
- `logs/operator-check-2026-10-09T07-34-43-499Z/`: **84 operator tests and one build
  guard passed**, including the existing Finance integration checks. New coverage
  verifies automatic persistence, once-only completion, closed-window fencing,
  permission rechecks and actual browser readiness gates for password, verification,
  challenge and wrong-origin states using isolated synthetic pages.
- `logs/project-checks-20261009T073150Z/`: **112 Python/Hub tests, 39 frontend tests,
  syntax checks and frontend build passed**.
- `logs/social-access-2026-10-09T07-42-40-148Z/results.json`: the deployed public
  interface passed, with both accounts still awaiting login and no session secrets
  exposed in status responses.
- `logs/social-live-2026-10-09T07-42-39-976Z/results.json`: real-search admission was
  blocked before submission because both platform sessions were still missing.

The search runner checks saved-connection readiness first and retains numeric/state
evidence rather than logging lead/profile payloads. `--run` is the explicit command
for the already agreed first search; a missing session is not a successful empty
result. Real signed-in discovery remains unverified until account activation.
