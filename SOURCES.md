# Sources and provenance

## Bounded weather and direct basic replies — 2026-09-26

- Live current/forecast data and geocoding: https://open-meteo.com/en/docs and
  https://open-meteo.com/en/docs/geocoding-api. Current conditions are weather-model
  data; responses name the provider and data time. The chosen public APIs require
  no key for this personal test; deployment/licensing scope remains the provider's.
- The installed `@steipete/weather@1.0.0` skill was inspected in the live workspace.
  Its curl recipes had no deadlines. It is retained on disk but removed from active
  routing in favor of native `jarvis_weather`, declared in project plugin 0.3.2.
- Native transcript bookkeeping was verified against OpenClaw **v2026.9.6**:
  `packages/gateway-protocol/src/schema/logs-chat.ts` and
  `src/gateway/server-methods/chat-transcript-inject.ts`. A live synthetic probe
  confirmed `chat.inject` creates `provider=openclaw`, `model=gateway-injected`
  rows. The Hub recognizes only its own validated labeled records when projecting
  those into Q/A messages, and restores bounded context from native history.
- Two bounded OpenCode reviews covered the weather-tool contract and timeout/
  admission paths. The lead measured the old and replacement paths and retained
  the failed intermediate timing rather than presenting it as completion.

## Call responsiveness and answer checks — 2026-09-26

- The local model remains `ollama/qwen3.5:9b`; reasoning was raised to high through
  OpenClaw's public configuration writer. Native per-session checks preceded the
  default change. No smaller model, reduced reasoning setting, or new model download
  was introduced for speed.
- Native project plugin **0.3.1** now declares `jarvis_calculate` alongside
  `jarvis_projects`. Its bounded Python Decimal evaluator is application code;
  runtime inspection verifies the declared tool actually loads.
- Incremental call delivery uses existing Gateway SSE inside the host and bounded
  JSON polling outside it, respecting the documented Quick Tunnel SSE limitation.
- Speaker traces are drawn from captured VAD frames and decoded TTS samples at the
  audio element's playback position. No third-party visualization runtime was added.
- Two bounded OpenCode reviews examined early-delivery and expert-integration
  contracts. The shipped quality improvements are high local reasoning and the
  calculator; an additional expert-consult tool was only evaluated, not activated.

## Temporary notebook HTTPS connection — 2026-09-26

- Official `cloudflare/cloudflared` **2026.9.3**, Windows amd64 executable, downloaded
  from the named GitHub release and verified using the asset's published SHA-256:
  `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`.
- Cloudflare Quick Tunnel limitations were checked in the official documentation:
  temporary testing use, no SSE. The remote transport therefore uses JSON chat replies.
- The local relay/helper use Python's standard library. Windows process identity
  checks use `GetProcessTimes` and retained process handles, following Microsoft
  documentation, to avoid terminating a reused PID.
- Two bounded OpenCode reviews covered relay authentication and process lifecycle.
  Source/config credentials were not included in worker snapshots.

## Continuous conversation — 2026-09-26

The later phone-call UI reuses these same pinned components. A native HTML dialog
provides the full-screen call, focus containment, and Escape handling. The call
adapter retains one microphone stream, gates input while busy/muted, and gives
playback its own cancellation signal so user speech can interrupt without hanging up.

- `@ricky0123/vad-web` **0.0.31**, ISC — https://github.com/ricky0123/vad.
  Reused its frame processor, AudioWorklet/resampler, PCM WAV encoder, Silero
  model adapter, and packaged `silero_vad_v5.onnx` weights.
- Silero VAD, MIT — https://github.com/snakers4/silero-vad.
- `onnxruntime-web` **1.30.0**, MIT — https://github.com/microsoft/onnxruntime.
  Browser JS, MJS loader, and WASM come from the same pinned package.
- `@playwright/test` **1.63.0**, Apache-2.0, is a development-only verification tool.

Exact package versions/integrities are in `frontend/package-lock.json`. Vite emits
the detector's worklet/model/WASM as local assets and lazily loads its JS on Start.
The application adapter explicitly owns capture, serializes recurrent inference,
and releases resources during initialization/cancellation. It does not depend on
private fields of the upstream microphone wrapper. Only WASM compilation was added
to the existing same-origin CSP (`wasm-unsafe-eval`); no external runtime host was added.

References checked:

- https://docs.vad.ricky0123.com/user-guide/api/
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- OpenClaw's pinned `v2026.9.6/src/gateway/openai-http.ts` maps system messages into
  per-turn `extraSystemPrompt`; `voice_mode` is a Hub option, not an upstream field.
- Two bounded OpenCode workers reviewed the chat/cancellation handoff and drafted
  the backend spoken-response contract; the lead integrated and verified the work.

## Command Center frontend and catalog — 2026-09-26

- ClawHub source reference: https://github.com/openclaw/clawhub (MIT), cloned to
  `vendor/clawhub` at `21dc829bf2943c78dfb101f043eef1edb731d35f`.
- Catalog data: `https://clawhub.ai/api/v1/skills`, using the public downloads-sorted
  feed and opaque cursors. 11,133 valid publisher/slug identities were indexed.
  Entry licenses come from registry metadata; missing licenses remain unspecified.
- Managed skill install tested: `@steipete/weather@1.0.0`, followed by actual
  installed-inventory inspection and enablement. The upstream installer reported
  its audit and installed the workspace skill; the UI records requirements separately.
- React / React DOM 19.3.0 — MIT.
- Vite 8.3.1 — MIT; TypeScript 7.0.2; React plugin 6.1.1.
- Lucide React 1.48.0 — ISC.
- react-markdown 10.1.0 and remark-gfm 4.0.1 — MIT.
- IBM Plex Sans via Fontsource 5.3.0 — OFL-1.1; bundled locally.
- Vitest 5.0.2 and Prettier 3.9.9 are development tools.

Exact package integrity/version data is in `frontend/package-lock.json`. The
frontend uses published packages; it does not compile the ClawHub registry server.
No Open WebUI code or branding was copied into this frontend.

## Local voice update — 2026-09-26

| Reference checkout | Revision |
|---|---|
| `vendor/speaches` — https://github.com/speaches-ai/speaches | `v0.9.0-rc.3`, `24f209c90218187747a9205f0b84bc06b42ce775` |
| `vendor/faster-whisper` — https://github.com/SYSTRAN/faster-whisper | `v1.2.1`, `65882eee9f5cdbeeb2d877f1131d48cf241b327d` |
| `vendor/kokoro-onnx` — https://github.com/thewh1teagle/kokoro-onnx | `3596b26764286a7de9d90c363e988d50578918e5` |

All three inspected source repositories use MIT licenses. The **runtime** is the
official published Speaches image, not a build of the reference directories:

```text
ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu@sha256:2163775b6df5e451a71200e8f675fed68dbd8ab184fc604453d549e486f22fd2
```

This is a pinned release-candidate image. Runtime metadata was checked directly:
`faster-whisper 1.1.1`, `kokoro-onnx 0.4.5`, `piper-tts 1.3.0`, and
`onnxruntime-gpu 1.22.0`. The configured voice execution uses CPU; the GPU remains
assigned to Ollama. Reference checkout versions must not be mistaken for the
package versions bundled in this image.

Model artifacts:

- https://huggingface.co/Systran/faster-whisper-small — MIT model card; multilingual recognition.
- https://huggingface.co/speaches-ai/Kokoro-82M-v1.0-ONNX — converted Kokoro model;
  repository revision observed during research: `dc196c76d64fed9203906231372bcb98135815df`.
- https://huggingface.co/hexgrad/Kokoro-82M — original Apache-2.0 model weights/license.

Speaches downloads model IDs through its registry into its persistent cache. The
container digest is pinned; the setup does not claim an independently verified
immutable digest for each downloaded model file.

Integration contracts were checked in the pinned `routers/stt.py`,
`routers/speech.py`, `routers/models.py`, and `dependencies.py`, then verified
through real requests. Three bounded OpenCode workers reviewed STT, TTS/model
management, and browser media lifecycle separately; proposals were reviewed and
applied by the lead.

Public references:

- https://speaches.ai/installation/
- https://speaches.ai/usage/speech-to-text/
- https://speaches.ai/usage/text-to-speech/
- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/gateway/openai-http-api

The following sections preserve the original foundation research.

Inspected on 2026-09-25. Upstream repositories and published documentation can
change. The starter pins both release labels and immutable image digests.

## Official source checkouts

| Local checkout | Official source | Release | Commit |
|---|---|---|---|
| `vendor/openclaw` | https://github.com/openclaw/openclaw | `v2026.9.6` | `eb377ac59e6c9fd6c7705028034812becf00271b` |
| `vendor/n8n` | https://github.com/n8n-io/n8n | `n8n@2.40.7` | `09b3ce6f9889c889e13cf3747f6f6c68eebdeeb6` |
| `vendor/ollama` | https://github.com/ollama/ollama | `v0.34.4` | `b2da9e468af2479058ae18c6d908ed29de410684` |

The clones are shallow and sparse. OpenClaw includes selected configuration and
CLI docs. n8n includes the selected workflow/credential import, publication, and
webhook node sources used to check the integration contracts.

## Published image pins

- OpenClaw: `ghcr.io/openclaw/openclaw:2026.9.6`
  - `sha256:0a5ff5e682e62afa19149df126aa50063bf65ef885b5c94713ce32dc0eb12e15`
- n8n: `docker.n8n.io/n8nio/n8n:2.40.7`
  - `sha256:ffeb52485f78b1b06c9a832205853cf75da72a07a514c9a27724df85979d6c34`
- Ollama: `ollama/ollama:0.34.4`
  - `sha256:8262851b2846b87c649eddf3e76beb270c52f4d1bc94559f47efde16b0841551`

The digests were resolved with `docker buildx imagetools inspect`. Source commit
recording and image pinning are provenance records, not a claim that local source
builds reproduced the published image bytes.

## License files

- OpenClaw: `vendor/openclaw/LICENSE` — MIT.
- n8n: `vendor/n8n/LICENSE.md` — Sustainable Use License for covered source;
  enterprise-designated code is subject to separate terms.
- Ollama: `vendor/ollama/LICENSE` — MIT.
- Qwen model: https://ollama.com/library/qwen3.5:9b — listed Apache-2.0 model
  license and roughly 6.6 GB Q4_K_M download at inspection.

GitHub's API returned `NOASSERTION` for some repository license summaries. The
license descriptions above use the actual license text, not that summary field.

## Integration references

- [OpenClaw Docker installation](https://docs.openclaw.ai/install/docker)
- [OpenClaw configuration](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Ollama recipes](https://docs.openclaw.ai/providers/ollama/recipes)
- [OpenClaw skills](https://docs.openclaw.ai/tools/skills)
- [Ollama Docker installation](https://docs.ollama.com/docker)
- [n8n workflow import at the pinned release](https://github.com/n8n-io/n8n/blob/n8n%402.40.7/packages/cli/src/commands/import/workflow.ts)
- [n8n workflow publication at the pinned release](https://github.com/n8n-io/n8n/blob/n8n%402.40.7/packages/cli/src/commands/publish/workflow.ts)
- [Microsoft Graph permissions overview](https://learn.microsoft.com/graph/permissions-overview)

The older n8n documentation URLs for Docker hosting and CLI commands returned
page-not-found responses during research. The pinned CLI source was used to
verify the import/publication commands instead of relying on those stale URLs.

## Evaluated expansion components

- [Playwright MCP](https://github.com/microsoft/playwright-mcp): Apache-2.0;
  repository not archived at inspection.
- [Docling](https://github.com/docling-project/docling): MIT;
  repository not archived at inspection.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): MIT;
  repository not archived; last reported push was 2025-11-19 at inspection.
- [Piper](https://github.com/OHF-Voice/piper1-gpl): GPL-3.0;
  repository not archived at inspection; voice model licenses are separate.
- [Open WebUI license](https://github.com/open-webui/open-webui/blob/main/LICENSE):
  inspected as an alternative interface; current branding conditions apply.

The voice update above records the components now installed and tested. Docling,
standalone Piper voices, and a dedicated Playwright integration into JARVIS remain
expansion candidates. Check their release and license when adopting them.
