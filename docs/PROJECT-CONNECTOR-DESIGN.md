# Project Hub: implementation contract

## Goal

Connect a local folder or a multi-repository project through one command or a small
web form. Let JARVIS inspect the project and answer project-specific questions from
the same page. Reuse OpenClaw for agent runs and the existing OpenCode CLI for coding.

The implementation seat is Jarvis-WorkOS/main. Medical source is an integration
target, not the implementation seat. Existing repository instructions must be
included in project context. Git remains authoritative for branch and work status.

## Deliverable

- A Windows-side, Python-standard-library service at 127.0.0.1:18791.
- A local web dashboard with project connection, root selection, live overview,
  file navigation, content search, project chat, and coding-session launch.
- A registry of connection metadata in runtime/project-hub.sqlite.
- Registered roots may be ordinary folders or Git worktrees. Root labels are stable.
- Bounded text reads and literal search, with page/range metadata and explicit caps.
- Git metadata/status obtained on request through argument-array subprocess calls.
- A jarvis-projects OpenClaw skill whose Node bridge calls the host service through
  host.docker.internal. The project token is distinct from the Gateway token.
- Chat is proxied to OpenClaw's documented /v1/chat/completions endpoint with a
  project/thread-specific session key. OpenClaw owns conversations and model/tool use.
- An optional stronger review/patch-proposal task uses the already-reviewed
  sm_opencode.py snapshot helper. Results are proposals, not applied source edits.
- A selected coding session can be opened in the existing native OpenCode executable.
- Startup integrates the host service, live OpenClaw skill/config update, and browser
  opening through an explicit --open flag. A Desktop launcher can invoke that flow.

## HTTP boundaries

The UI is a same-origin localhost application. A direct top-level loopback visit
bootstraps an HttpOnly SameSite=Strict session cookie. Check Host, Origin, and
Sec-Fetch-Site; reject cross-site bootstrap and API requests. API access otherwise
requires the dedicated project bearer token. The Gateway token stays server-side.
Agent calls can inspect registered projects but cannot register arbitrary roots or
launch new Windows processes. Those management operations require the local UI/CLI.

Read operations: projects, overview, tree, read, search, git. Management: connect,
disconnect, coding-session launch, review task. Chat accepts one selected project,
message, and thread identifier. Request and response bodies have explicit limits.

## File and process rules

- Resolve and contain paths inside a registered root before each read.
- Do not follow symlinks/junctions outside the root, including intermediate links.
- Reject absolute paths, traversal, .git internals, credentials, runtime databases,
  binary files, generated/dependency trees, and oversized source files.
- Reads/searches share the same file policy; sensitive filenames cannot bypass it.
- Root discovery is bounded and lazy. Cache a file index briefly; use fresh file
  contents and Git status. Honor Git ignores for repository source browsing.
- Root-level and nested AGENTS/CLAUDE instructions accompany source context.
- Use argument-array subprocess calls without a shell. Preserve real exit codes.
- Native coding launch uses an absolute installed executable and the selected cwd.
- Strong-review snapshots are explicit, bounded source selections with hashes.
- Never infer a successful code change from an assistant's prose or worker exit alone.

## Verification

Use synthetic fixtures for containment, credentials, ignored paths, malformed input,
multi-root registration, Git worktree detection, and service authentication tests.
Check real Medical metadata and source paths without touching application data.
Prove an actual assistant project-tool call and a project-specific chat answer.
Verify desktop/mobile dashboard behavior with the isolated Playwright browser.
