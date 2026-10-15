# Operational assistant decisions

Approved contract: [OPERATOR-BUILD-SPEC.md](OPERATOR-BUILD-SPEC.md).
Decisions below are implementation choices and constraints, not completion
claims. Verification and live blockers are recorded alongside actual evidence.

## D001 — 2026-09-27 — Reuse the existing agent framework

Use a TypeScript operational control layer with OpenClaw's supported structured
HTTP function-tool/follow-up interface. This preserves the existing framework
and selected Qwen 3.5 9B/high configuration instead of adding a competing model
router. The operational request path must not call the demo's regex/intent
shortcuts. Model-selected tool names/arguments are schema-validated, policy-checked
and observed before another model step. Bound steps, calls and deadlines.

Evidence: pinned OpenClaw 2026.9.6
`docs/gateway/openai-http-api.md` documents caller-supplied function tools,
`tool_calls`, `role: tool` follow-ups and cancellation; `docs/plugins/tool-plugins.md`
and `docs/plugins/hooks/tool-policy.md` document tool authority and persistence hooks.

## D002 — 2026-09-27 — Isolate operational authority

Use a dedicated operational Gateway state/configuration/secret with no ambient
host filesystem, shell, messaging or developer tools. The existing coding
workbench and experimental voice app remain separately identified services during
cutover. A shared Gateway token is full operator authority, not per-user RBAC;
never expose it to browsers or messaging users. The TypeScript service resolves
verified identity and current roles and is the sole business-tool/action owner.

## D003 — 2026-09-27 — Structured durable state, explicit working context

Use a dedicated SQLite/WAL store for the initial single-host deployment, with
versioned migrations and database work off the request event loop. Persist
principals/bindings, conversations, facts, action/approval state, schedules,
delivery receipts, audit events and prompt/config versions. Encrypt private
payloads with an environment-held key. Working context is bounded and selected
for the caller/channel; long-term facts are separately scoped and provenance-tagged.
Standing-instruction memory is data, never permission to bypass the policy owner.

## D004 — 2026-09-27 — Approval is an authoritative state transition

Approval is actor-bound, tenant-bound, expiring, and tied to immutable arguments,
tool/version fingerprint and policy revision. The model cannot approve itself.
Recheck live authority immediately before dispatch. Lease/idempotency/recovery
state belongs in the same durable action owner. Unknown external write outcomes
require reconciliation, not an assertion of success or automatic duplicate sends.

## D005 — 2026-09-27 — Retry only when repetition is safe

Apply bounded deadlines, exponential backoff/jitter and circuit breakers to
external integrations. Read requests and provider-idempotent writes may retry.
After an ambiguous non-idempotent send/payment failure, retain an uncertain action
for review/reconciliation. Requirement 14 does not justify violating requirements
51/68/70/72 by repeating a consequential action whose first outcome is unknown.

## D006 — 2026-09-27 — Stage truthfully; credentials are activation gates

Staging uses explicitly marked synthetic providers and separate data. Production
must never silently fall back to fixtures. Skill health distinguishes missing
credentials, configured-but-unverified, verified, disabled and unavailable states.
Presence checks report only names/booleans, never secret values. Real provider
and remote-machine proof remains blocked until the corresponding access exists.

## D007 — 2026-09-27 — Keep sensitive data out of operational logs/channels

Store needed private payloads in protected application state, and log bounded
redacted inputs/outputs plus identifiers, digests, decisions and latency. Channel
delivery receives an explicit safe projection; do not rely on regex replacement
alone to remove medical content from arbitrary model prose. Sensitive clinical
reads and approvals require authorized secure context. Public-channel continuity
does not authorize replaying protected history into that channel.

## D008 — 2026-09-27 — Reuse GPU speech; Azure is the preferred optional speech vendor

Retain verified GPU Whisper/Kokoro for local English voice while exposing provider
capabilities honestly. Prefer Azure Speech for the requested Czech/English neural
voices and native SSML pitch/rate controls; activation requires its actual region
and key. Do not pretend Kokoro's current voice is Czech-capable or claim hosted
TTS access through a coding subscription. Provider choice is configurable and
will be checked against official contracts before implementation.

## D009 — 2026-09-27 — Messaging/office provider choices

Use Telegram's Bot API and prefer Twilio for the initial WhatsApp Business plus
telephone adapters, sharing a supported vendor integration. Do not repurpose the
existing Claude supervisor's paired Telegram bot. For calendar/mail, support a
provider boundary for Microsoft Graph and Google; the actual business provider
and account must be configured, not inferred from the .NET stack. No paid account,
phone number purchase, or real outbound send is implied by choosing an adapter.

## D010 — 2026-09-27 — Preserve SportMedical ownership and API boundaries

JARVIS implementation seat: `C:/Users/Matko/Jarvis-WorkOS`, branch `main`, currently
unborn/uncommitted. Preserve existing files/work. Medical main is a coordinator
seat; inspect actual API contracts and assigned lanes before proposing changes.
No clinic database access from JARVIS. Unknown/missing Booking/Billing/Diagnostics
contracts are integration blockers, not permission to invent production endpoints.

## D011 — 2026-09-27 — Trusted plug-ins versus untrusted code execution

Auto-discovered handler files are trusted installed application code, constrained
by environment enablement, schemas, version/hash checks and policy admission.
Email/attachments/model output cannot install plug-ins. Model-provided code runs
only in a bounded OS/container sandbox through an authorized executor; a JavaScript
VM or subprocess by itself is not a security boundary. Process restart accepts
configured application identities and fixed commands, not arbitrary shell strings.

## D012 — 2026-09-27 — Existing implementation evidence

Existing: OpenClaw native agent/tool calls, project source tools, calculator/weather,
React command center, local speech, native conversation history with SQLite
metadata, and basic durable operation receipts. Existing operation receipts are
not a policy-gated approval queue; source connections are not connected work
accounts. Reuse useful components while giving operational state one owner.
The old temporary notebook URL is expired; the separate optimized demo's status
was verified live. Temporary tunnels are test access, not stable production
webhook hosting.

## D013 — 2026-09-27 — Review-driven authority refinements

Independent bounded reviews are retained at
`C:/Users/Matko/.claude/automation-logs/opencode/20260927T152104Z-56dg3bno/`.
Apply their concrete invariants: sensitive-read authorization is not granted by
a public-projection flag; approval records need current proposer/approver authority;
dispatch is a fenced durable transition immediately before the external request;
callback/submission deduplication and rate reservations are transactional. A
revocation cannot retroactively retract an already-sent request. Private native
transcript suppression must be proven on the actual HTTP loop, not inferred
from successful hook registration.

## D014 — 2026-09-27 — Incognito native execution, protected application memory

The real HTTP function-tool/follow-up loop passed. Ordinary native execution
retained a synthetic private marker in the agent SQLite WAL despite a registered
transcript hook; a Gateway-process hook counter was not authoritative across
worker instances. Use the supported incognito session-key contract for each
model request instead of assuming a persistence hook is sufficient. The same
structured loop plus a plain turn then passed with no raw marker in native disk
state/logs. Evidence: `logs/operator-brain-20260927T154805Z/results.json`;
source contract: pinned `packages/session-url-contract/src/session-key.ts` and
`src/config/sessions/incognito-session-transcript.test.ts`. Durable context remains
owned by the protected Node store. Do not silently fall back to ordinary sessions.

Windows bind-mount file modes also required explicit 0644/0700 permissions in
the owned Linux plugin copy before OpenClaw admitted the boundary plugin. The
isolated runtime was repaired through its supported Doctor command; unrelated
Gateways were not restarted.

## D015 — 2026-09-27 — Strict admission and interruption-safe working context

Fastify defaults removed unexpected request fields; a failing HTTP regression
demonstrated that behavior. Disable schema mutation/coercion and reject unknown
fields. Bind direct reads to authenticated request cancellation and compare the
admission actor revision instead of silently adopting new authority. Validate
conversation ownership before tool execution/events.

Validate complete model call batches before executing any prefix. Reconstruct
missing historical tool observations as explicitly interrupted/unknown in the
working view only; preserve original durable evidence. Omit protected frames on
insecure channels instead of creating orphan tool roles. Durable cancellation
also cancels queued requests. An uncertain completion acknowledgement retries
the same stored outcome, not the agent or its effects.

Independent source reviews:
`C:/Users/Matko/.claude/automation-logs/opencode/20260927T170404Z-xsycr9js/`.
The lead applied and verified the corrections; worker reports alone were not proof.

## D016 — 2026-09-27 — Versioned state and bounded durable scheduled reads

Use additive schema v2 for leased scheduled occurrences, notification references
and migration history. Preserve both known owned v1 variants. Check environment
and decryption key before migration; reject future schemas. Test restart/migration
against retained encrypted records.

Phase 1 scheduling admits explicit structured **read-only** tools through the
same authority owner. Five-field cron, IANA timezone/DST, 25 schedules per actor,
coalesced missed intervals and no overlapping occurrence prevent catch-up bursts.
Owner/tool/config changes invalidate old authority; edits fence in-flight results.
Read leases recover at most three attempts. Writes continue to use their separate
approval/queue admission; a schedule is not an implicit write whitelist.

Persist controlled action/schedule notification references in the same transaction
as the state transition. Provide tenant/owner sequence replay and idempotent
acknowledgement. Private results remain in protected state. This local notification
store does not claim external-channel delivery before adapters/receipts exist.

## D017 — 2026-09-27 — Allow a natural model completion after tool observations

The first full Node/Gateway probe failed a streamed planning step. Its Gateway
log showed a structured clock call followed by a text-only completion. Pinned
`src/gateway/openai-tool-choice.ts` explicitly documents that `required` cannot
force all providers and rejects text-only results. Requiring a synthetic finish
call on every turn was therefore too strict.

Use the standard `auto` function-calling loop, with optional `jarvis_finish`.
A nonempty text-only planning completion ends planning. Business calls still
require validated structured arguments and the policy/action owner. Final text
is generated separately with tools disabled; speculative planning text is not
streamed as an executed outcome. No natural-language intent matching was added.
Retain synthetic-only protocol diagnostics and explicit incomplete-stream errors.

The live English fixture also exposed an unwanted Czech response despite an
English request. Make authenticated language preference explicit, while allowing
a clearly different user language; a Prague timezone does not select Czech.
The subsequent live fixture returned the correct English date sentence. Broader
Czech/English speech and persona qualification remains Phase 2.

## D018 — 2026-09-27 — Isolate invalid plugins and retain actual sensitivity

Reject reserved fields and asynchronous validators at startup. Bad manifests,
schemas or handlers disable the affected installed skill while healthy skills
remain usable; duplicate IDs invalidate the conflicting installation. Same-version
code changes remain quarantined. Trusted plugins are still trusted application
code, not a security sandbox.

Bound handler waiting with cancellation, then verify live authority. Check actual
output sensitivity, raise durable action/audit classification when needed, and
block protected results on insecure channels, including result replays. Do not
infer privacy from only a manifest's lower baseline sensitivity.

## D019 — 2026-09-27 — Distinguish UTC and business-local clock facts

A live response labeled a UTC time as Prague time when only the date/timezone
were requested. Clock skill 1.1.0 now returns explicit `localTime` alongside
`localDate`, `timezone` and UTC `iso`, with a manifest description distinguishing
them. The scheduler/API test verifies 17:05 UTC is 19:05 Europe/Prague on its
summer-time fixture. Calendar values should use observed provider/timezone data,
not require the language model to infer offset arithmetic.

The smoke harness also falsely rejected valid English because it required the
literal noun "date". Remove that pseudo-language detector, check the observed
date/timezone facts, and retain the actual response for language review. This
does not replace Phase 2's broader Czech/English conversational qualification.

## D020 — 2026-09-27 — Native console output is a separate persistence boundary

Extended inspection found the marker from
`logs/operator-brain-20260927T154805Z/results.json` in Docker console logs at
15:48:14 UTC, although the Gateway-state/file scan passed. That earlier
`privacy_verified` flag covered files only; it did not establish console privacy.
Preserve that evidence and do not reuse the narrower claim as full logging proof.

Pinned `src/runtime.ts` writes assistant replies through `console.log`, and
`src/logging/console.ts` deliberately forwards console calls even when console
filtering is configured. Setting `logging.consoleLevel` alone is insufficient.
Disable native file logging and set the **dedicated operational container** to
Docker's `none` logging driver. Structured errors, decisions, latency and protected
payload audits remain owned by Node. Native unfiltered prose is not an operational
log source. This sacrifices raw native console diagnostics in normal operation;
synthetic-only explicit protocol diagnostics remain available in the probe.

Boundary version 2 refuses model readiness without the disabled-logging config
and deployment-policy declaration. The live probe separately verifies the actual
Docker logging driver and deliberately generates a private synthetic marker in
model output before scanning native files. Environment/config changes cannot be
assumed safe based only on a successful incognito session.

## D021 — 2026-09-27 — Do not regenerate an already-final grounded response

Live core text turns varied from 4.8 to 10.8 seconds; the always-separate final
generation introduced under D017 discarded a valid no-tool final response and
asked the same high-reasoning model to generate it again. Remove that redundant
turn: an ordinary completed model response with no calls is the final answer.
Only explicit `jarvis_finish` requests use the separate no-tools streaming pass.

Continue buffering tool-bearing frames and validating the complete batch before
executing anything. Final-state/grounding/language instructions apply in the
initial system context too. Model, reasoning configuration and tool authority are
unchanged. This reduces orchestration work rather than lowering model capability;
measure the actual result and do not infer a 1–2-second voice guarantee.

## D022 — 2026-09-28 — Prioritize executable jobs in the existing interface

Matko rejected foundation-only progress and catalog counts as substitutes for
actual work. Audit demonstrated the operator was not running, most native catalog
skills were unavailable, and useful host connections already existed. Reuse the
existing Command Center, Project Hub, authenticated GitHub CLI and GPU speech;
make practical capabilities callable from the operational agent and its real UI.
Task cases, actual outputs and activation limits are in `TASKS.md`.

Independent bounded proposal/review artifacts:
`C:/Users/Matko/.claude/automation-logs/opencode/20260927T204125Z-dgvx4f9w/`.
The lead integrated the panel into existing navigation instead of adopting the
worker's separate outer shell, and verified real HTTP/browser paths afterward.

## D023 — 2026-09-28 — Real document and host adapters, bounded authority

Use fixed read-only Windows process/CIM operations, existing authenticated source
inspection, the existing `gh` account, and Python document libraries (pypdf,
python-docx, openpyxl, ReportLab). Pin the installed dependencies. File roots are
explicit; personal roots require their own permission. Uploads/artifacts are
owner-scoped. Writes create action-owned files without overwriting personal files.
Artifacts have content digests and durable effect receipts; downloads check both
ownership and the digest. Source inspection does not confer clinic source ownership.

Generated JavaScript runs in the existing pinned container image with no network,
host mounts, personal profiles, or credentials; UID65534, dropped capabilities,
read-only root, bounded temporary storage, memory/CPU/PIDs/output and execution
deadlines. GNU timeout supplies an in-container deadline and the host retires only
the action-specific container. An exit error is a failed result, not successful code.

## D024 — 2026-09-28 — Public browsing through a fresh, constrained browser

Reuse Playwright. Check redirects/subrequests, block private/metadata targets and
websockets/service workers, and pin actual outbound connections to validated DNS
addresses. A pre-check followed by a second Chromium DNS lookup was insufficient.
Read/search produces observed text/links/form selectors. Mutating form steps use
external-action admission and explicit unique selectors. Password/file inputs and
personal browser profiles are excluded. UI interaction is not an independent
business-provider receipt; the live form qualification used an HTTP echo service.

## D025 — 2026-09-28 — Account connections must activate actual adapters

Add encrypted per-owner account connections in the UI. The SportMedical adapter
uses verified existing HTTP contracts, including `/api/v1/session`, canonical day
and summary endpoints, calendar/activity/patient reads, invoices and prices. It
does not access clinic databases, guess values, or claim unverified clinical writes.

Use ImapFlow (MIT), MailParser (MIT) and Nodemailer (MIT-0) for encrypted IMAP/SMTP
accounts. No existing personal browser or supervisor Telegram session is reused.
IMAP reads do not mark messages read. Attachment source identity/digest is checked;
outbound attachments use owned artifact digests. Sends require policy/approval and
ambiguous sends are not retried. OAuth-only accounts still need their real OAuth
configuration. Changing connections increments the actor revision, invalidating
pending authority against the old account setup. No real account was fabricated.

## D026 — 2026-09-28 — Make real task access usable from the notebook

Add an explicit `--tasks` mode to the authenticated, expiring notebook relay and
the owned Desktop launcher. Mirror only scoped operational routes; management,
native Gateway credentials and general host commands stay excluded. Preserve
download filenames. Route notebook calls to the same task conversation via polling
rather than assuming Quick Tunnel SSE support. Existing call-only mode remains
narrow unless task mode is explicitly enabled.

## D027 — 2026-09-28 — Correct failures at the real task boundaries

Actual UI jobs found defects that foundation tests could not: oversized process
results broke model continuation; a spreadsheet omitted its requested total;
model prose invented download hosts; relative reminder time was guessed; native
empty results appeared as “No response from OpenClaw.”

Repairs: bounded/named process queries, compact model previews with protected
paged observation retrieval, required explicit total-column selection and actual
file read-back, authoritative download links, server-clock relative reminder tools
with readable business-local due times, and verified file receipts when the native
framework yields its reserved empty-answer placeholder. Preserve failed evidence.
Task outcomes are checked against actual files/processes/HTTP responses, not prose.

## D028 — 2026-09-28 — Warm speech without reducing model capability

The new voice path initially took about21.5 seconds with a cold recognizer. The
existing GPU service now keeps Whisper/Kokoro resident, explicitly uses the same
Whisper Small CUDA float16 path, and warms speech before launch. The public warm
sample was about11.94 seconds, with most remaining time in the operational-agent
round trip. This meets functional routing, not the requested latency target.

## D029 — 2026-09-28 — Retry authentication only before admission

A business connector can return401 after an already authenticated request. Treating
every401 as an expired browser session could replay a clinic login multiple times
through frontend, notebook and Hub layers. The Hub marks true pre-admission session
rejections explicitly; the operational bridge also checks the Node auth error code.
Connector failures are not resubmitted. Backend/frontend regression tests cover the
distinction. Session renewal is not a justification for repeating consequential work.

## D030 — 2026-09-30 — Select the larger model using actual jobs and residency

Matko authorized the stronger local model and Medical-assistant work, then
reconfirmed routine execution permissions. Compare actual tool loops with isolated
synthetic tenants. GPT-OSS20B fit but failed source grounding. Qwen3.5 27B Q3_K_M
passed; importing the unchanged text GGUF without the unused vision projector and
explicitly placing all layers on the GPU removed CPU offload. Keep32K context/high
reasoning and use8K output allowance. Promote the verified text profile in both
owned runtime config and new-install seed. Existing defaults survive ordinary seed
updates. Model files use D: rather than filling C:.

Both the final9B baseline and27B scored6/6; this does not prove general superiority.
Actual UI work and the latency tradeoff are recorded in
`OPERATOR-MODEL-QUALIFICATION.md`. Preserve failed comparisons and the installed
baseline. No model receives native host authority or approval authority.

## D031 — 2026-09-30 — Complete streams and one authoritative final answer

Require successful terminal `finish_reason`, not merely `[DONE]`, before accepting
a model turn. Truncated text/tool batches are incomplete and do not execute.
Record thrown tool failures in returned observations as well as history. A finish
call must stand alone. Buffer final prose until artifact-receipt grounding and a
fresh authority check, then publish that same final text. This supersedes the
earlier immediate-final-fragment streaming in D017/D021. Completed effects still
remain durable if the overall planning deadline or step budget is exhausted.

## D032 — 2026-09-30 — Bind Medical reads to the running profile

The current registration checkout and Booking lane have different routes. D025's
original Booking-source inspection is not proof of the API on5092. Discover the
running OpenAPI, require a healthy known profile and rejection of anonymous
protected reads before sending credentials. Bind the full schema fingerprint to
the account; schema changes require reconnecting. Keep exact401/403 distinctions.

Registration day projection uses actual scheduling appointments with Prague DST
bounds, requires timezone-bearing timestamps, retains status counts and leaves
absent values unknown. The installed connector is explicitly read-only even after
sign-in. The tested stale DLL was rejected and removed from qualification; the
current source build failed CA1711. Retain those blockers instead of suppressing
analyzers, bypassing auth, touching a real database or borrowing source ownership.

## D033 — 2026-09-30 — Reserve useful GPU headroom and warm the real path

All-GPU speech plus27B left as little as63MiB free after longer speech output;
small cached-prompt requests degraded to76s. Keep the same Whisper Small on CUDA
float16 and the same Kokoro ONNX weights on CPU. The measured final headroom was
905MiB. This is device placement, not reduced reasoning or a smaller speech model.

Startup now performs actual incognito Gateway inference and verifies32K/full-GPU
residency. Generate-only preload did not establish first-request readiness. Model
keep-alive is persistent, and the old evaluation9B warmer is stopped. The final
public synthetic-microphone sample was12.638s, not the1–2s target. Local samples,
public transport and physical notebook acoustics remain distinct evidence.

## D034 — 2026-09-30 — Fresh upstream evidence and work-level acceptance

Matko rejected the first upgrade as still ineffective. GitHub showed the newer
Qwen3.8-27B release. Download and qualify it, and compare a35B-A3B MoE candidate
on multi-file work, source evidence, document paging and follow-ups. The old
pipeline passed only3/6 harder jobs. The faster MoE passed2/6 and was not promoted.
Keep Qwen3.8 after the repaired pipeline produced all six required outcomes.
Record exact output checks, timing, quantization and failed evidence in
`OPERATOR-QUALITY-UPGRADE.md`; larger size or basic arithmetic is insufficient.

## D035 — 2026-09-30 — Native inference with Node-owned authority

Use Ollama's actual structured tool/thinking contract directly, following the
Qwen native-function-call pattern. This removes a second agent's prompt overhead
while keeping Node as the sole business executor. Preserve xhigh reasoning,32K
context, complete terminal validation, scope and cancellation. Retain thinking
only within the current run for tool continuation; never persist or deliver it.
Model settings now live in `operator/config/model.json`, not the legacy Gateway
primary. Startup and the live probe inspect the active model's logging/residency.

## D036 — 2026-09-30 — Compute tables and transfer verified values

Add DuckDB1.5.6 in a pinned, networkless, unprivileged data-only container.
Actor-permitted CSV/XLSX inputs are parsed by the fixed document worker; generated
queries cannot access the host or external sources. Exact decimal joins/grouping
replace mental row reconciliation. `tableObservationId` binds file creation to
the caller's complete checked result, with permission/ownership checks and
immutable expanded input before action admission. Real numeric workbook cells
and downloaded PDF content are verified in the actual interface.

## D037 — 2026-09-30 — Repair practical protocol friction

Reports do not require spreadsheet-only totals arguments; missing output
extensions are deterministic. Reader limits have consistent count semantics and
pagination metadata. Safe validation constraints let the model repair an invalid
field instead of repeating blind failures. Budget exhaustion delivers labelled
partial results and receipts, without replaying effects. The UI exposes real
progress, uses attachment context and identifies the active model.

## D038 — 2026-09-30 — Reduce transport/generation overhead without weaker reasoning

Bounded HTTP waiting can return short completed jobs in the admission response,
retaining durable IDs and async fallback. Release the Hub's auth mutex before
network I/O using a matching cookie/CSRF snapshot so cancellation is not blocked.
Spoken turns request concise answers. Adapt the upstream return-direct pattern
only for a model-selected standalone exact calculator result; compound, failed,
rounded and non-calculator cases keep normal planning. No intent regex or lower
reasoning setting selects the answer. Final public voice10.825s is not the1–2s target.

## D039 — 2026-09-30 — Retain rejected optimizations and honest verifier corrections

A tool-discovery prototype reduced some prompt context but regressed a real
readiness task: the model omitted loading the available clinic tool. It is
disabled in the deployed configuration. Separately, a verifier read only30 lines
of a correct57-line Markdown file after paging semantics changed; the required
SDK starts on line31. Recheck the complete unchanged artifact and its receipt
hash, preserve the original failed report, and fix verifier pagination. Do not
replay the model/effects or silently replace failure evidence to obtain a green result.

## D040 — 2026-10-01 — Reproducible local setup and served-build identity

Matko selected development environment, architecture and resource efficiency.
Consolidate the actual application workflow in `scripts/dev.py`: pinned dependency
setup, diagnostics, native startup and retained verification. Build source/output
fingerprints prevent existing `dist` directories or a live older process from
being mistaken for the current implementation. This is identity checking, not a
substitute for tests. Keep the original Gateway/demo setup explicitly historical.

## D041 — 2026-10-01 — Bind table images to reviewed source

Replace manual machine-specific image-ID installation with an owned runtime
record. Hash the Dockerfile/worker/context policy, label and verify the built image,
then atomically write its immutable ID. Reuse matching images; reject unowned
records and source drift. The SQL worker's network/filesystem/permission boundary
is unchanged; the installer makes its provenance reproducible and inspectable.

## D042 — 2026-10-01 — Separate liveness, availability, warmth and latency

Add model-aware readiness and authenticated runtime diagnostics. Keep numeric
timing/token metrics separate from conversation content and hidden reasoning.
Record per-task model/tool time; process-wide recent counters reset on restart.
Treat Ollama's reported GPU placement as allocation metadata, not proof of
physical residency on Windows. Report device-wide memory/power separately.

## D043 — 2026-10-01 — Guard resource transitions without weakening the model

Interactive mode stays resident; balanced mode supplies a15-minute native idle
lease. Standby/wake manage only the selected dedicated model. Reject active/queued
work and fence new admission during transitions. Management operations stay out
of the notebook write proxy. Preserve the model, reasoning and context. Resource
policy is separate from business authorization fingerprints.

Live telemetry exposed an unnecessary profile-change reload: Ollama compares
context-shift settings between requests. Empty lease refreshes must match native
chat's `shift=false`. After the fix, profile changes took roughly0.35s and the
warm checked UI task took2.203s. Record the failed trial and avoid generalizing
these results into a universal speed or energy-saving claim.

## D044 — 2026-10-01 — Preserve HTTP denials during bounded connection teardown

An actual Windows notebook test intermittently received a socket abort instead of
the intended403 when a rejected POST body was unread. Discard only a small declared
body with a short timeout, never interpret/forward it, and explicitly close the
HTTP connection. Preserve the original failing run; verify split-body handling
and unchanged authentication/management denials in the full suite.

## D045 — 2026-10-01 — Declare connection contracts and source scope

Use a validated registry for local/Git source access and six explicit runtime
metadata adapters. Source readability, declared development requirements, passing
runtime contracts and authorized business operations are distinct evidence.
Import the existing managed clones idempotently, retaining project identities and
repository ownership. Do not execute a checkout to discover its capabilities or
guess a generic fallback for an unknown protocol. Runtime probes are bounded GETs
to reviewed HTTPS/loopback endpoints, with private credential-key references and
no redirect forwarding. Sources: `config/connections.json`,
`project_hub/connections.py`, `docs/CONNECTIONS-VERIFICATION.md`.

## D046 — 2026-10-01 — Verify the actual source bridges and notebook interface

Expose the same source/connection actions through the native task tool, host,
retained Gateway and installed CLI bridge. Existing seeded files are preserved,
so deploy reviewed changes through a narrow migration with hashed backups,
ownership preservation and supported plugin reload. Verify the installed bridge,
not just its source. Notebook task mode receives explicit source-read routes,
actions and fields plus usable navigation; project registration, coding launches
and runtime management remain local. Actual local/model and notebook browser
proofs, including the initial permission/navigation failures, are retained in
`docs/CONNECTIONS-VERIFICATION.md`.

## D047 — 2026-10-01 — Distinguish reachable authentication gates from outages

Medical's anonymous OpenAPI probe changed from unreachable to HTTP 401 during the
audit. Record `reachable:true` and `authentication_required` when no credential
reference was supplied; use `authentication_rejected` only for a rejected supplied
token, and distinguish 403 permission denial. Neither state qualifies the clinic
contract or its account. Preserve earlier evidence and recheck current state;
do not infer an empty agenda, repeat effects or reuse unrelated credentials.
The source verifier's exit 0 confirms source reads, while per-runtime results
explicitly retain unavailable/unconfigured/authentication-gated endpoints.

## D048 — 2026-10-01 — Verify microphone startup independently of the speech pipeline

A real notebook report exposed an unbounded microphone-permission wait and false
listening labels. Synthetic-stream/autoplay-bypass proofs did not cover native
device startup. Acquire permission in the Call click before engine loading,
display actual startup stages, bound each wait, and release late resources after
cancellation. Retry is an explicit user action. Verify with the browser's native
media API/default audio policy as well as a complete synthetic spoken turn;
neither substitutes for the user's physical microphone test. The Windows test
runner needs full Chromium for native capture, not its headless-shell package.
Failing controls and final evidence: `docs/VOICE-STARTUP-VERIFICATION.md`.

## D049 — 2026-10-03 — Optimize the measured transfer and preparation boundaries

Browser resource timing already showed compressed WASM, but the local relay sent
the full binary into the tunnel. Compress public build assets before the uplink,
with a bounded content-hash cache and explicit encoding negotiation. Keep private
API/body responses out of that cache. Route task-mode notebook startup through
native model/speech preparation; a live Node listener with an unloaded model is
not ready for a fast first question. Use one desktop startup path and a concise
greeting. Record call-startup and first-useful-answer timings separately, preserve
the selected model/reasoning and state the remaining inference delay. Evidence:
`docs/VOICE-SPEED-VERIFICATION.md`.

## D050 — 2026-10-06 — Make spoken interruption request-bound and durable

Keep microphone detection active while the model reasons, after transcription
has released the speech slot. Confirmed speech cancels only its preceding request
ID. Fence cancellation before admission, preserve completed outcomes and prevent
old client callbacks/cancellation messages from affecting a replacement turn.
Record a fixed cancellation notice after execution settles; recover pending
notices transactionally after restart. Only that exact owner-written marker is
replayable in model context, not arbitrary stored system instructions. Already
admitted actions retain their independent recorded states. Evidence:
`docs/VOICE-INTERRUPTION-VERIFICATION.md`.

## D051 — 2026-10-06 — Judge optimization by completed work and classify interruption honestly

Batch 512 passed the same three synthetic task checks as batch 256 but did not
consistently improve completed-work latency; restore 256 and preserve model,
reasoning and context. User cancellation is a separate model-call outcome from
failure; completed-call latency excludes cancelled/failed samples. The public
interruption proof must verify a running predecessor, an actual calculator-backed
successor, no resumed old task, released microphone tracks and separate cancellation
telemetry. Source/evidence: `docs/VOICE-INTERRUPTION-VERIFICATION.md`.

## D052 — 2026-10-06 — Connect social research through dedicated owner-scoped sessions

Matko requested TikTok/Instagram contact discovery and chose dedicated sign-in
sessions. Use separate browser contexts, manual platform login/verification, and
encrypted first-party session data bound to the JARVIS owner. Keep credentials out
of model inputs and status responses. Account controls expose only the two reviewed
platforms; ordinary public browsing does not inherit these sessions. Report saved
session, actual profile reads and platform/login errors separately. Pending login
windows prevent an ordinary operator restart from discarding the user's sign-in.
Source/qualification: `SOCIAL-CONTACTS.md`.

## D053 — 2026-10-06 — Keep social candidates, match evidence and outreach outcomes distinct

The initial brief is 20 Prague fitness creators, Czech/English, for paid
collaboration; later criteria are editable. Save observed public profile/contact
fields and source times. AI match explanations require exact saved-source quotes;
unknown criteria remain unverified. Deduplicate within platform and preserve human
notes/drafts/contacted status, with optimistic revisions and stale-evidence labels.
Drafts and CSV export support manual outreach; copied text and a manually marked
contact are not provider delivery receipts. Qualify synthetic workflow tests,
native-model drafting and real signed-in discovery separately. Source/evidence:
`SOCIAL-CONTACTS.md`.

## D054 — 2026-10-09 — Complete explicit social sign-in without an extra required Save step

An explicitly opened platform connection monitors readiness and automatically
saves only after consistent first-party session/origin and cleared sign-in gates.
Use minimal DOM readiness flags, not entered credential values or feed/inbox text.
Recheck current account permission, deduplicate manual/automatic completion, and
bind late callbacks to the exact login attempt. Closing or expiring one window
cannot persist it later or close a replacement. Platform login/verification stays
manual, and saved session state still does not prove successful profile discovery.
Source/evidence: `SOCIAL-CONTACTS.md`.
