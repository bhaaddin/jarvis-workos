# GitHub-backed quality upgrade — 2026-09-30

**Subsequent environment work,2026-10-01:** setup, build provenance, live runtime
diagnostics and resource controls now use [DEVELOPMENT.md](../DEVELOPMENT.md).
The table-image installation record has moved to source-checked
`runtime/table-engine.json`; the local image pin below is historical evidence.

This supersedes the earlier Qwen3.5 deployment in
[model qualification](OPERATOR-MODEL-QUALIFICATION.md). Matko rejected basic smoke
checks as proof of an effective assistant. This pass tested multi-file work,
actual output content, recovery and source-grounded reporting.

## Active configuration

- **Qwen3.8-27B**, Unsloth **UD-Q3_K_XL** (Ollama reports27.3B /Q3_K_L).
- Actual selection: `operator/config/model.json`, transport **native Ollama**,
  model **`jarvis-qwen3.8:27b-text-gpu`**, loopback11436.
- Native **xhigh** reasoning,32,768 context,8,192 output-token allowance.
  No reasoning downgrade was used to report a speed improvement.
- Official Qwen3.8 renderer /Qwen tool parser; text GGUF only, full GPU placement,
  batch256, flash attention, q8_0 KV cache and one inference slot.
- Publisher sampling: temperature1.0, top_p0.95, top_k20, min_p0,
  presence penalty0, repetition penalty1.
- Text blob SHA256:
  `8c2a45ff85e7674ca185ec8eb6cdeab0e617ed9d8018caed0b64380eb2a67a5e`.
- Alias digest:
  `9b907f180ef02569442bb0db26da313b53d214c26519dcfbc4d0c267f3a71ca1`.
- Final inventory: `logs/model-upgrade-20260930T191058877843Z/results.json`:
  **13,729,047,510 resident bytes, all in VRAM**,32K context. GPU14,319MiB used,
  1,571MiB free. Operator, Hub and speech health endpoints returned200.
- Whisper Small remains CUDA float16; unchanged Kokoro weights run on CPU.

The native adapter removes the extra general-purpose Gateway agent prompt from
operational turns. One observed first financial step dropped from11,658 prompt
tokens through the Gateway to6,300 through the native transport. This is prompt
overhead evidence, not an equivalent percentage speed guarantee.

Node still owns all identity, tool admission, effects, approvals, memory and
delivery. The model returns proposals. Native inference is stateless, loopback-only
in this adapter, with Docker logging disabled. Thinking continuation is kept only
inside the current run, excluded from history, audit, events and answers. The
legacy Gateway remains separately constrained for its retained uses/fallback.

## Upstream sources actually checked

- [QwenLM/Qwen3.8](https://github.com/QwenLM/Qwen3.8): official current model
  family;27B release dated2026-08-14. Publisher claims were used to choose a
  candidate, not substituted for local acceptance results.
- [Official model card](https://huggingface.co/Qwen/Qwen3.8-27B) and
  [Unsloth quantization](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF).
- [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent): native function calling
  (`use_raw_api`) and multi-step tool execution patterns.
- [Ollama0.34.4](https://github.com/ollama/ollama/tree/v0.34.4): actual native chat
  message/tool/thinking/terminal contracts and Qwen3.8 renderer, not a guessed
  OpenAI `reasoning_effort` field.
- [DuckDB1.5.6](https://github.com/duckdb/duckdb/releases/tag/v1.5.6): real relational
  analysis and exact-decimal calculations over supplied tables.
- [LangChain return_direct](https://reference.langchain.com/python/langchain-core/tools/base/BaseTool/return_direct):
  adapted as a model-selected exact-calculator response, with owner-controlled
  output and additional compound/failed/rounded-result guards.
- [LangChain tool selection](https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/langchain/agents/middleware/tool_selection.py):
  evaluated as a deferred-tool prototype. It is **disabled** in the deployed
  configuration because a qualification run missed an available clinic probe.
- [ExLlamaV3](https://github.com/turboderp-org/exllamav3) and
  [llama.cpp](https://github.com/ggml-org/llama.cpp): reviewed alternatives;
  no unmeasured throughput claim or wholesale runtime replacement was made.

## Harder work benchmark

`operator/scripts/qualify-work.mjs` uses isolated synthetic tenants, actual tools
and real documents. It reopens outputs and checks their contents:

1. Join invoices/payments, filter statuses and cutoff dates, preserve currencies,
   identify an unmatched payment, and create **both XLSX and PDF**.
2. Read current backend SDK, frontend React version and actual database-provider
   source, with citations.
3. Retrieve the later approved section of a650-line handbook, ignore a superseded
   rule and embedded instructions, and create the correct PDF.
4. Preserve a Czech multi-turn budget change, exclude cancelled scope, calculate
   the remainder and write the actual workbook.
5. Compare valid supplier quotations including shipping/tax, exclude expired and
   incomparable-currency offers, and create a recommendation PDF.
6. Probe actual Medical connector status and current SDK source, then create a
   useful report despite unavailable clinic access.

Partial outcomes do not pass completed-job assertions. Case data is synthetic;
live source reads and generated artifacts are real. This is a bounded acceptance
suite, not a general intelligence leaderboard or clinical validation.

| Model / pipeline | Result | Retained results folder |
| --- | --- | --- |
| Previous3.5-27B through Gateway |3/6|`logs/work-qualification-2026-09-30T16-37-37-276Z/`|
|3.5-27B through direct adapter |3/6|`logs/work-qualification-2026-09-30T16-43-31-868Z/`|
|3.8-27B before tool repairs |4/6|`logs/work-qualification-2026-09-30T16-51-39-056Z/`|
|3.8 with repaired tools /DuckDB |6/6|`logs/work-qualification-2026-09-30T17-20-41-020Z/`|
|3.6-35B-A3B UD-IQ3_S candidate |2/6; faster but unreliable|`logs/work-qualification-2026-09-30T17-57-25-054Z/`|
|Deferred-tool prototype |5/6; later targeted readiness check also failed|`logs/work-qualification-2026-09-30T18-37-23-245Z/`, `18-51-14-771Z/`|
|Final full-tool3.8 profile |6/6 after full-artifact verifier correction|`logs/work-qualification-2026-09-30T18-55-22-887Z/`|

### Verifier correction, not a rewritten failure

The last folder retains its original **5/6** result. After document paging was
made consistent, the verifier still read only30 lines of the readiness Markdown.
The actual required SDK begins on **line31**, and is also stated on line44.
`artifact-recheck.json` separately verifies the complete unchanged file, its
receipt SHA256, the actual clinic probe and current source read: **6/6 corrected**.
Original logs remain intact; the model/effects were not replayed to get this result.
`qualify-work.mjs` suite version3 now requests larger pages and follows `nextStart`.

The earlier version2 also allowed the new table engine as an arithmetic verifier
instead of prescribing the calculator implementation. Business/output criteria
remained, and explicit partial-result rejection was added. These are pipeline
comparisons, not controlled claims that weights alone caused every improvement.

Final case times were **180.054 /61.456 /32.822 /41.256 /44.594 /70.485 seconds**.
Correctness improved; complex local reasoning can still take minutes. The faster
35B MoE was retained for evidence and **not promoted**: it used the wrong code
language, omitted action confidence, mixed currencies into a total, and exhausted
budgets on source inspection. Bigger or faster was not enough.

## Operational improvements

### Checked table analysis and data-bound exports

`jarvis_table_query` loads actor-permitted CSV/XLSX files and runs a single
SELECT/WITH query in a dedicated **DuckDB1.5.6** container. Inputs are complete
tables (up to4 files,50,000 rows each,16MiB combined serialized data). Oversized
inputs fail instead of producing partial financial totals. Columns start as
VARCHAR; explicit DECIMAL casts preserve financial arithmetic.

The container has no network, host mounts, credentials or Docker socket;
UID65534, read-only root, dropped capabilities,512MiB memory/2 CPUs, bounded
temporary storage and a20s in-container deadline. External access/extensions are
disabled and configuration locked; non-SELECT/multiple statements are rejected.
Output is capped at200 rows with an explicit truncation flag.

Pinned local image:
`sha256:9f1441fef9d385e07efe303b57198ddaabf950ddca515fcc13e420807bf23f4a`.
Rebuild source: `operator/table-sandbox/Dockerfile` and `worker.py`; base Python
image and engine version are pinned. `image.json` records the installed image ID.
On a new machine, build the image and record its inspected immutable ID before use.

Document creation accepts **`tableObservationId`**. The owner retrieves its own
successful, complete table observation, rechecks source permission, and expands
the exact values **before immutable action admission**. The model does not need
to retype the computed rows. Safe numeric values become actual numeric Excel
cells; larger exact values remain text rather than silently losing precision.
Cross-owner references and conflicting manual rows are rejected.

### Fewer avoidable failures

- Report formats no longer require spreadsheet-only `totalColumns` arguments.
  XLSX/CSV still require explicit totals selection, including `[]` for mixed currencies.
- Missing output filename extensions are added from the explicit format.
- Document `start`/`limit` now mean actual1-based page/row/line counts, with next-page
  metadata. The old mixed units caused repeated invalid calls.
- Schema failures return specific safe constraints, not just an opaque failure.
- Source guidance supplies current Medical navigation paths and distinguishes
  registry health from actual connector reachability/sign-in.
- On planning-step exhaustion, a final no-tools pass returns clearly labelled
  partial results and preserved receipts. It does not replay completed effects.
  Local development/staging overall task allowance is300s; budgets remain bounded.

### Better interaction and transport

- The UI shows the actual model and real tool progress; attachments supply file
  context without forcing an unrelated summary request.
- `delivery=voice` selects concise spoken answers, preserving reasoning.
- A bounded20s wait can return a short durable task result in its original HTTP
  response. Longer jobs retain async polling. Request deduplication still applies.
- The Hub snapshots cookie/CSRF pairs under its auth lock, then releases the lock
  for I/O, so a waiting response cannot block cancellation. Only explicit
  pre-admission authentication failures may retry.
- `_respond=true` is available for a standalone calculation-only request. The
  model still selects the tool; Node may deliver only a successful **exact**
  calculator value directly. Failed, rounded, compound or non-calculator results
  do not use this shortcut. No natural-language intent regex routes the request.

## Actual interface and privacy evidence

- **Real uploaded CSV → checked analysis → numeric XLSX + PDF**:
  `logs/office-ui-2026-09-30T18-15-33-148Z/results.json`.
  Prague1200 /Brno100 /Olomouc500 CZK, total1800; cancelled/refunded rows excluded.
  Checked source-observation binding, numeric cells, exact row layout, real file
  downloads, visible progress and no browser errors. **83.816s**.
- Earlier office run retained an extra total row and failed the exact-layout
  assertion: `logs/office-ui-2026-09-30T17-54-05-295Z/`. The subsequent request
  explicitly placed the overall total only in the PDF; criteria were not loosened.
- Six deployed simple UI jobs passed:
  `logs/task-jobs-2026-09-30T17-40-13-483Z/results.json` (5.822–10.482s).
- Final native HTTP/model/privacy proof:
  `logs/operator-live-2026-09-30T19-10-59-489Z/results.json`.
  Real clock request3.624s; encrypted memory/restart; active model logging`none`;
  no output marker in scanned persistent model storage. Legacy Gateway negative
  probes and disk scan remain separately recorded, not substituted for the active
  transport check. Native model storage scans omit files≥50MiB.
- Final public HTTPS synthetic-microphone proof:
  `logs/task-voice-2026-09-30T19-11-08-754Z/results.json`.
  Correct spoken355 from an actual calculator observation, **10.825s** to audible
  answer; core task7.630s. No browser errors; tracks released on hang-up.

Other voice samples remained around12–13s. The10.825s sample is not a p95,
physical-notebook acoustic test or achievement of the1–2s target. The faster
10.198s deferred-tool sample used a subsequently disabled prototype.

## Checks and remaining gates

- **52 operator tests passed**, TypeScript build exit0:
  `logs/operator-check-2026-09-30T18-34-58-004Z/`.
- **78 Hub/backend tests,27 frontend tests**, frontend production build and
  listed syntax checks passed: `logs/project-checks-20260930T181237Z/`.
- Host document venv `pip check` passed. DuckDB executes in its pinned container;
  the temporary host-only inspection installation was removed.
- Medical API5092 remains offline; no clinic/mail account is connected. Actual
  clinic reads/writes were not qualified. The earlier clean-source CA1711 failures
  and rejected stale DLL are retained in the previous qualification report.

Current entry: <http://127.0.0.1:18791/#operator>. Normal launcher:
`python -B scripts/start.py --gpu --voice`. Model selection is now in
`operator/config/model.json`; changing only the legacy Gateway primary does not
change this native path. After a reviewed configuration change, use owned graceful
stop, warm the selected model, then start the operator. All downloaded candidates
remain available for explicit comparison; `toolDiscovery` is intentionally false.
