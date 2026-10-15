# Upstream source references

These are shallow, sparse checkouts of official upstream repositories at the
releases selected for this starter. Production services use published container
images; they do not compile these checkouts. Upstream source remains unmodified.

- OpenClaw: https://github.com/openclaw/openclaw, tag `v2026.9.6`
- n8n: https://github.com/n8n-io/n8n, tag `n8n@2.40.7`
- Ollama: https://github.com/ollama/ollama, tag `v0.34.4`
- Speaches: https://github.com/speaches-ai/speaches, tag `v0.9.0-rc.3`
- faster-whisper: https://github.com/SYSTRAN/faster-whisper, tag `v1.2.1` (reference)
- Kokoro ONNX: https://github.com/thewh1teagle/kokoro-onnx, commit `3596b26764286a7de9d90c363e988d50578918e5` (reference)
- ClawHub: https://github.com/openclaw/clawhub, commit `21dc829bf2943c78dfb101f043eef1edb731d35f` (catalog API/source reference)

Voice runtime package versions come from the pinned Speaches image. They are
listed separately in `SOURCES.md`; the reference snapshots are not source builds
of that image.

Each checkout retains its upstream license. Run `git rev-parse HEAD` inside a
checkout to identify its exact revision. Expand a sparse checkout with
`git sparse-checkout add <directory>` if implementation source is needed.
