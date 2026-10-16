# Coordination: who is writing what (2026-10-16)

Two UI passes collided in this workdir on 2026-10-16 ~00:03. Read this file
AND run `git status --short` before writing any frontend file.

## Active passes

| Pass | Direction | Files owned | State |
|---|---|---|---|
| shadcn-migration (this session) | Tailwind v4 + shadcn/ui pattern (pinned deps, `cn`, cva Button, theme tokens) | `frontend/src/lib/*`, `frontend/src/ui/*`, `frontend/src/index.css`, `frontend/src/OperatorPanel.tsx`, `frontend/src/SocialContacts.tsx`, `frontend/src/ConnectionCatalog.tsx`, `frontend/src/CallScreen.tsx`, `frontend/src/AudioTrace.tsx` (App.tsx shell: planned, NOT started) | Preserved on branch `wip/colliding-ui-passes-20261016` (DO NOT MERGE, not pushed). Foundation verified: typecheck clean, 42/42 vitest. |
| mui-pass (other session) | MUI (`@mui/material`, not in package.json — currently cannot build) | `frontend/src/theme.ts`, `frontend/src/components.tsx`, `frontend/src/views.tsx`, `frontend/src/portalDemo.ts`, `frontend/src/FinancePanel.tsx`, `frontend/src/FirmPortal.tsx`, `frontend/src/FleetAdmin.tsx` | In flight, uncommitted when collided; preserved in the same WIP commit. |

Owner decision needed: which direction wins (Tailwind/shadcn vs MUI).
The loser’s files get reverted from the WIP checkpoint, the winner finishes.

## Rules until decided

1. ONE writer per file. Check the table above before touching a file.
2. Branch per pass. Never commit another pass’s files.
3. Never push `main` with mixed directions.
4. Downloaded models/skills go to `workspace/skills/` with source + license,
   never into `frontend/`.
