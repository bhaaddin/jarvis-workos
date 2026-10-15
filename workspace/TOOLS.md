# Connected tools

## Workflow bridge

`skills/jarvis-workflows/bridge.mjs` invokes the authenticated n8n demonstration.
The helper gets its credential from its environment, not from prompt text.

Run from this workspace:

```text
node skills/jarvis-workflows/bridge.mjs demo-briefing
```

Email, calendar, code repositories, business systems, microphone capture, and
Windows desktop actions require the integrations described in the build plan.
An empty demo calendar is sample output, not a query of the user's calendar.
