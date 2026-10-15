# Local model upgrade and Medical contract qualification

**Historical checkpoint:** the deployed model and transport were subsequently
upgraded to Qwen3.8/native inference. Current selection, harder work verification,
data-analysis/export improvements and remaining latency are in
[OPERATOR-QUALITY-UPGRADE.md](OPERATOR-QUALITY-UPGRADE.md). Preserve the earlier
measurements below as evidence of this first upgrade, not the current default.

Verified **2026-09-30**. Paths below are relative to `C:/Users/Matko/Jarvis-WorkOS`.

## Deployed model

- Gateway primary: **`jarvis-local/jarvis-qwen3.5:27b-text-gpu`**.
- Qwen3.5 **26.9B**, Unsloth **Q3_K_M**, Apache-2.0, text/tools/thinking.
- 32,768-token context, 8,192 configured output-token ceiling, agent reasoning
  **high**. Qwen advertises thinking on/off; this is not a distinct native
  three-level effort scale. Reasoning was not disabled for the speed checks.
- Ollama 0.34.4, pinned image in `operator/compose.brain.yaml`, single inference
  slot, flash attention, q8_0 KV cache, persistent loaded model.
- Model default parameters: `num_ctx=32768`, `num_batch=256`, `num_gpu=999`.
  The full-GPU setting was verified on the RTX 5080 rather than inferred from it.
- Storage: `D:/AI/OllamaModels`, API loopback11436. The operator Gateway is18809;
  Node18801 and the actual Tasks interface18791 are running.
- Manifest digest:
  `53104004064a873642e38c98d44a020dbf3a584a3852e7afc8d65cea21acdca6`.
- Unchanged text GGUF blob:
  `f08ce37ebe8a7130db0c198262336773976b1e374f2444f898c41117710f0bb3`
  (13,505,116,064 bytes). The original package's unused vision projector is not
  loaded into this text-only operator model. Original downloaded models remain.

Final inventory: `logs/model-upgrade-20260930T161530993940Z/results.json`.
Ollama reported **14,438,786,661 resident bytes, all in VRAM**, context32768.
After the public voice check, NVIDIA reported14,985MiB used /905MiB free
(its reported free+used excludes some driver-reserved memory).

## Selection evidence

`operator/scripts/compare-models.mjs` runs the actual Gateway/tool owner with
isolated synthetic tenants. Cases require calculator2541, an actual reopened
XLSX total219, a Czech ten-minute reminder, Medical `global.json` source evidence,
honest unavailable-clinic handling, and no write from ambiguous patient identity.

| Configuration | Result | Evidence |
| --- | --- | --- |
| Original9B, first exploration |6/6|`logs/model-benchmark-2026-09-30T14-31-19-453Z/`|
| GPT-OSS20B MXFP4, full GPU |5/6; source task hit step limit|`logs/model-benchmark-2026-09-30T14-32-39-871Z/`|
|27B Q3_K_M package with projector |6/6;12% CPU /88% GPU|`logs/model-benchmark-2026-09-30T15-12-07-065Z/`|
|27B text-only, automatic placement |6/6;5% CPU /95% GPU|`logs/model-benchmark-2026-09-30T15-21-52-317Z/`|
|27B text-only, explicit full GPU |6/6;100% GPU|`logs/model-benchmark-2026-09-30T15-38-02-082Z/`|
|27B full GPU, revised shared Medical context, speech loaded |6/6|`logs/model-benchmark-2026-09-30T15-44-39-734Z/`|
|9B, same provider/context/output budget/Medical guidance |6/6|`logs/model-benchmark-2026-09-30T15-47-32-108Z/`|

The last matched pair used the same six prompts, tool schemas, high reasoning,
32K context and8K output allowance. 9B's first request included a36.874s cold load;
its other tasks took2.983–20.227s. The already-loaded27B took5.690–12.910s.
For the Medical source task that run used2 model turns/7.870s on27B versus
8 turns/20.227s on9B. Simple9B jobs were generally faster. Both scored6/6: this
small acceptance suite does **not** establish universal quality superiority.
The earlier GPT-OSS comparison predates the final shared Medical guidance.

The larger Qwen was selected after passing actual work; GPT-OSS was not promoted.
Configuration and benchmark artifacts retain the actual failures and timing
differences. Neither model size nor reported GPU occupancy alone is the score.

## GPU/speech coexistence and startup

The first full-GPU27B check improved warm task time substantially over CPU
offload. However, longer all-GPU speech allocations subsequently left only63MiB
free and a tiny cached-prompt readiness response took76.296s. A functionally
passing short voice sample was insufficient to establish stable coexistence.

The selected shared-GPU profile keeps **Whisper Small CUDA float16** and moves
the **same Kokoro ONNX model/voices to CPU**. The existing pinned speech service
excludes CUDA/TensorRT ONNX providers; it does not replace the speech weights.
Configuration reference: Speaches0.9.0-rc.3 `src/speaches/config.py`,
`OrtOptions.exclude_providers`. The service stays at18902 and keeps both models
loaded. After settling, actual Gateway readiness checks took2.108s and1.981s,
and post-call VRAM headroom remained905MiB. This is a measured operating profile,
not a concurrent-load guarantee.

`scripts/start.py --gpu --voice` was exercised successfully. It starts services,
warms speech, then uses `scripts/warm_operator_model.py` and
`operator/scripts/warm-model.mjs` to exercise the **actual private Gateway** before
starting/reusing Node. The original generate-only preload had still allowed a
72.689s first live probe, so preload alone is not advertised as a latency proof.
Model unloading/reboot can still make startup slow. The old evaluation9B warmer
was stopped during this upgrade; do not run a second resident LLM over this budget.

## Real deployed jobs and privacy checks

- `logs/operator-check-2026-09-30T15-44-35-906Z/`: TypeScript build; **42 tests
  passed**, zero failures/skips.
- `logs/project-checks-20260930T154435Z/`: **77 Hub/backend tests**, **27 frontend
  tests**, frontend production build and listed syntax checks; all exit0.
- `logs/operator-live-2026-09-30T15-52-04-486Z/results.json`: actual selected-model
  clock, encrypted memory/restart, output-marker privacy, Docker logging`none`,
  and seven unavailable native-tool probes. The initial clock request was72.689s,
  retained rather than replaced by a later warm number.
- `logs/task-jobs-2026-09-30T15-53-24-647Z/results.json`: all six actual UI jobs
  passed: real process IDs, Excel download/read-back219, Medical React source,
  isolated public page, authenticated GitHub and persisted reminder.6.458–19.446s;
  mobile layout fit and no browser errors.
- `logs/task-voice-2026-09-30T15-54-29-190Z/results.json`: initial **local** synthetic
  microphone test,8.652s to audible355, before the final CPU-TTS placement.
- `logs/notebook-tasks-2026-09-30T16-11-46-843Z/results.json`: refreshed authenticated
  public HTTPS, unauthorized401, management denied, actual PDF content/download,
  exact sixty-second reminder and actual due notification.
- `logs/task-voice-2026-09-30T16-13-13-166Z/results.json`: final **public HTTPS**
  synthetic microphone check, correct spoken355, **12.638s** end-to-audible,
  tracks released and no browser errors. About1.289s STT,7.079s agent round trip,
  2.645s TTS transport; physical notebook acoustics were not tested.

The1–2-second useful-speech target remains unmet. Public and local samples are
different paths; the earlier local8.652s must not be reported as notebook latency.

## Medical integration: implemented versus blocked

`operator/context/medical.md` directs project/source questions to the real Project
Hub and records coordinator ownership. The current clinic connector is explicitly
read-only; signing in does not add rebooking or other write actions. Initial27B
prose promised future rebooking; explicit capability guidance corrected this in
the later inspected answer. Names never establish patient identity or prices.

`clinic-contract.ts`/`clinic.ts` now discover advertised read routes and distinguish
`registration`, `booking-day`, and unknown profiles. Registration day reads use
`/api/scheduling/appointments`, not absent Booking-lane endpoints. Prague date
bounds honor DST, naive timestamps fail instead of silently becoming UTC, status
counts retain cancelled records, and absent appointment values remain unknown.
The complete OpenAPI fingerprint is bound to the connection; schema changes block
authenticated reads until reconnection. This is not proof of clinic row-level RBAC.

Synthetic adapter regressions verify that offline/missing/unknown/anonymous-read
contracts receive no login credentials, unsupported operations make no business
request, changed schemas block reads, and401 versus403 are distinguished without
replay. Discovery currently requires exposed `/openapi/v1.json`; production
deployments without it need a reviewed pinned-contract mechanism.

**Current live blockers:** configured API5092 is offline; no clinic account is
connected. A Sept6 prebuilt DLL was tested only in an isolated disposable fixture
and returned200 for unauthenticated `/api/services`; qualification rejected it,
stopped the process and removed the disposable database container. No existing
clinic data was accessed. Evidence: `logs/medical-contract-20260930T145229Z/`.

A detached verification worktree at committed backend HEAD
`5e2afde205c52b03bc45c8dc7231980c246c64d9` passed SDK10.0.302 and locked restore,
then build exited1 with CA1711 for `Permission.cs(19,21)` and
`RolePermission.cs(10,21)`. Evidence: `logs/medical-source-check-20260930T145654Z/`.
No source ownership override or analyzer suppression was used. A genuinely current
clean API binary and authorized test session are still required for live clinic
qualification; an older binary is not evidence about that commit.

## Reproduce / select the retained baseline

From WorkOS, startup: `python -B scripts/start.py --gpu --voice`.
The desktop notebook launcher renews its private eight-hour access card.

From `operator`, compare an explicit candidate with
`node scripts/compare-models.mjs jarvis-local/jarvis-qwen3.5:27b-text-gpu` or
`node scripts/compare-models.mjs jarvis-local/qwen3.5:9b`.
Model comparisons share the inference service; keep user work idle during them.

For an intentional return to the retained9B primary, the supported config command
is `docker exec jarvis-operator-brain-1 node dist/index.js config set agents.defaults.model.primary jarvis-local/qwen3.5:9b`.
Then run `python -B scripts/warm_operator_model.py`. This changes the owned current
Gateway selection; the source seed remains the reviewed27B installation default.
`seed.mjs` preserves an existing selected default. Native logging/incognito and
Node-owned tool/approval boundaries apply to either choice.
