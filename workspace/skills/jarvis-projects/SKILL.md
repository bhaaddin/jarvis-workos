---
name: jarvis-projects
description: Inspect connected Windows projects, read source and repository instructions, search code, and get current Git status through Project Hub.
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["JARVIS_PROJECT_TOKEN"]}}}
---

# Connected projects

Use this skill for the user's connected projects. Windows source folders live on
the host, not in this container. Use the bridge rather than trying local file paths.

```text
node {baseDir}/bridge.mjs list
node {baseDir}/bridge.mjs overview PROJECT
node {baseDir}/bridge.mjs tree PROJECT ROOT [RELATIVE_FOLDER]
node {baseDir}/bridge.mjs read PROJECT ROOT RELATIVE_FILE [START_LINE] [LINE_COUNT]
node {baseDir}/bridge.mjs search PROJECT ROOT "literal search text"
node {baseDir}/bridge.mjs git PROJECT ROOT
node {baseDir}/bridge.mjs instructions PROJECT ROOT [RELATIVE_FILE]
```

1. Get the project/root IDs with `list` if not supplied.
2. Read `overview` once to load project instructions and current Git facts.
3. Search for the named symbol or file, then read the relevant source lines.
4. Cite the root label, file path, and line numbers. Report bounded/truncated
   searches accurately. Follow any narrower instructions returned for that path.

The Medical project has separate backend and frontend roots. Repository branches
and changed paths come from current Git output; an old plan is not current status.

These tools inspect source. To implement a requested change, the user can open
the selected folder's native OpenCode session from Project Hub. Strong review in
the Hub provides focused review/patch proposals through the existing account.
Do not claim that reading files or receiving a proposal changed the application.

Project Hub: http://127.0.0.1:18791. Connect another folder using its Connect a
project form or `python scripts/projects.py connect PATH --name NAME` on the host.
