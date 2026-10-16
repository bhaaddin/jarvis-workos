# Coordination: who is writing what (2026-10-16)

Two UI passes collided in this workdir on 2026-10-16 ~00:03. Read this file
AND run `git status --short` before writing any frontend file.

## Active passes

| Pass | Direction | Files owned | State |
|---|---|---|---|
| shadcn-migration (this session) | Tailwind v4 + shadcn/ui pattern (pinned deps, `cn`, cva Button, theme tokens) | `frontend/src/lib/*`, `frontend/src/ui/*`, `frontend/src/index.css`, `frontend/src/OperatorPanel.tsx`, `frontend/src/SocialContacts.tsx`, `frontend/src/ConnectionCatalog.tsx`, `frontend/src/CallScreen.tsx`, `frontend/src/AudioTrace.tsx` (App.tsx shell: planned, NOT started) | Preserved on branch `wip/colliding-ui-passes-20261016` (DO NOT MERGE, not pushed). Foundation verified: typecheck clean, 42/42 vitest. |
| mui-pass (other session) | MUI (`@mui/material`, not in package.json — currently cannot build) | `frontend/src/theme.ts`, `frontend/src/components.tsx`, `frontend/src/views.tsx`, `frontend/src/portalDemo.ts`, `frontend/src/FinancePanel.tsx`, `frontend/src/FirmPortal.tsx`, `frontend/src/FleetAdmin.tsx` | In flight, uncommitted when collided; preserved in the same WIP commit. |

## Audit 2026-10-16 (read-only, nothing changed)

Mixed tree is NOT broken: `tsc -b` clean, vitest 42/42 green. But:
1. `@mui/material` is imported by 3 screens yet missing from package.json —
   it resolves only by accident from node_modules. A fresh `npm ci` breaks
   the MUI screens. Either declare it or drop MUI.
2. Two visual languages ship at once (Tailwind/shadcn on 4 screens, MUI on
   3, legacy style.css shell). No user-facing failure, but incoherent UI.

## 2026-10-16 later: MUI pass reclaimed CallScreen

The other session rewrote `CallScreen.tsx` to MUI (sx props, inline
`style=` on the dialog), overwriting the Tailwind migration. No recovery
needed — the Tailwind version is preserved in the WIP branch history.
`e2e/voice.spec.js` + `e2e/notebook.spec.js` still query the removed
`.jarvis-call`/`.call-layout`/`.call-status` selectors and CANNOT be fixed
until CallScreen stops churning. Do not touch screens or e2e until the
direction decision lands.

## Rules until decided

1. ONE writer per file. Check the table above before touching a file.
2. Branch per pass. Never commit another pass’s files.
3. Never push `main` with mixed directions.
4. Downloaded models/skills go to `workspace/skills/` with source + license,
   never into `frontend/`.
