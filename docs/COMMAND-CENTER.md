# JARVIS Command Center v0.3 contract

## Product scope

Build a testable React frontend over the existing working Python/OpenClaw/Ollama/
Speaches/n8n stack. Keep the existing project and voice contracts functional.
The implementation seat is Jarvis-WorkOS/main; Medical is a connected source target.

Views: Overview, Assistant, Projects/source explorer, Skills library, Automations,
Runs, and Settings. Reuse React, Vite, Lucide icons, react-markdown, and remark-gfm.
Use the existing muted navy/mint JARVIS identity with blue for navigation and amber
for setup states. IBM Plex Sans is bundled locally. The assistant and actionable
workspaces lead the layout; catalog counts are actual inventory, not a hero claim.

## 10,000-capability direction

Index real ClawHub skill metadata, deduplicated by publisher and slug, in a local
SQLite catalog. The public API accepts `limit`, `sort=downloads`, and an opaque
`cursor`; results contain `items` and `nextCursor`. Each item has ownerHandle,
slug, displayName, summary, topics, stats, latestVersion.version/license, and optional
metadata.setup requirements. Target at least 10,000 real discoverable entries if
the feed supplies them. Do not generate filler, count versions twice, or report
available catalog entries as installed/executable functions.

Catalog requests are paginated and filtered on the server. Only the current page
enters browser memory. Import runs in a bounded background operation and preserves
its cursor/progress. Install one selected skill through the existing OpenClaw CLI
without force/policy-bypass flags. Installed readiness comes from `skills list --json`,
including eligible/modelVisible/disabled/missing fields. Enable a selected ready
skill through the owning OpenClaw config writer, preserving existing allowlists.
Credentials and platform requirements remain visible as actual setup requirements.

## Backend additions

- Catalog search/detail/stats/sync/install APIs and a persistent operation history.
- Conversation metadata (project, thread ID, title, timestamps) in the Hub database;
  message history remains owned by OpenClaw. Read it through `chat.history`.
- Expose user/final assistant messages and current run state; exclude tool payloads
  and legacy injected project context from the chat transcript display.
- Build chat context from root labels and complete applicable root instructions,
  not a full repository inventory and Git diff on every turn. Git stays a live tool.
- Keep root instructions present on each call, using a separate system/context
  message and the actual user text. Do not assume a local context hash proves the
  Gateway has retained instructions after compaction.
- Support streamed chat deltas with explicit done/error events, scoped per thread.
- Expose service health, review/operation history, working demo workflow execution,
  and actual saved UI/voice preferences.
- Local UI bootstrap remains same-origin/loopback. A new /api/session endpoint can
  establish its HttpOnly cookie for the React client. Project bearer stays read-only.
- Serve built frontend assets from frontend/dist. Preserve /classic for the earlier
  interface. No secrets enter the frontend bundle or browser storage.

## Frontend requirements

- Persistent project/thread selection and authoritative conversation reload.
- Formatted assistant Markdown, code blocks, copy, loading/error states, and voice.
- Dictation stays editable by default. Explicit voice preferences may auto-send
  dictation and speak new replies; project/thread changes must cancel stale media.
- Source tree/search/read and native coding/review launches retain their working APIs.
- Skills: search, source/category/status filters, real counts, detail/setup, install,
  and use a ready installed skill in a project conversation.
- Runs show real operation/review outcomes, not fabricated activity.
- Settings controls must have effects: theme, voice selection, auto-read/dictation.
- Desktop/mobile layout, keyboard navigation, and visible failure/retry paths.

## Verification

Test catalog deduplication/cursors/filters and 10k+ pagination with synthetic data,
then import the real registry and report its actual count. Test conversation
projection and thread isolation, streaming errors/cleanup, and context construction.
Run TypeScript/build checks and browser flows for chat refresh, source search,
catalog search/detail, operation history, and synthetic voice capture/playback.
