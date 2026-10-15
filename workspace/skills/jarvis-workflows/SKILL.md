---
name: jarvis-workflows
description: Run the JARVIS demo briefing to verify the live n8n workflow connection.
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["JARVIS_WORKFLOW_TOKEN"]}}}
---

# JARVIS workflows

For a demo briefing or an n8n connection check, run:

```text
node {baseDir}/bridge.mjs demo-briefing
```

Read the JSON result. Report its request ID and the fact that it is synthetic
demonstration data. A successful response proves a workflow call, not a real
mailbox or calendar integration. Report a failed call as a failed call.
