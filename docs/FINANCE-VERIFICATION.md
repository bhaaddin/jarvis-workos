# Direct Finance connection — verification

Verified **2026-10-08** against the existing WorkOS Tasks application. The owner
authorized a minimal read-only connector and compact view, superseding the
configuration-only restriction specifically for this WorkOS connection.

## Delivered

- `jarvis_finance` **1.0.1**, a closed-schema native read tool used by existing
  text/voice Tasks. Service operations and endpoint selection remain server-owned.
- Authenticated `/api/finance` overview, permission/owner checks before cached
  reads, and authority revalidation before returning a fetched snapshot.
- Finance workspace inside `OperatorPanel`, including paper/study/history cards,
  explicit public price/news reads, and existing Assistant/Talk integration.
- Fixed Freqtrade REST reads, official MCP SDK 1.32.1 for native OpenBB public
  data, and a bounded projection of the registered locked-study artifact.
- Model-selected return-direct for simple successful numeric paper/study
  summaries. It accepts no provider prose/URLs or arbitrary answer field, and
  refuses failed, partial or multiple-call batches.
- Existing local/notebook route allowlist extended by one read endpoint. No
  account schema, password, credential copy, funded trading or custom strategy.

## Builds and automated checks

| Check | Result | Retained evidence under `logs/` |
| --- | --- | --- |
| Operator build and tests | **80 passed**, including eight Finance tests | `finance-final-operator-20261008.log` |
| Frontend build / TypeScript | Passed | `finance-final-frontend-build-20261008.log` |
| Frontend tests | **39 passed** | `finance-final-frontend-tests-20261008.log` |
| Local/notebook proxy tests | **15 passed** | `finance-proxy-tests-20261008.log` |
| Source/output build stamps | Both valid | Source identifiers below |
| Compose configuration / native services | Valid; seven running, six healthchecked services healthy | Actual post-change Compose check |

Operator source: `f609f6e1ad64c3ea0479accabb3319363123bb43327274768ca084773395a5b2`.
Frontend source: `2ee0e10d0f9380ff9d17185e13b56263d14e274de9cd399deea021b5b607a200`.
Model configuration SHA-256 unchanged:
`a0ec2e351897f4364d26d413eb583a652db94821aa88f4ea8f4ca5b6f6db7321`.

Tests cover identity/tenant/owner and revoked-permission checks (including cache),
anonymous 401, query/input injection, rejected mutation routes, secret projection,
unavailable/partial data, non-paper mode rejection, cancellation, byte limits,
symlink escape, real SDK protocol calls against synthetic responses, unfinished
daily bars, and the existing voice-channel agent invoking the permissioned tool.

The frontend build retains its non-failing >500 kB chunk warning. No bundling or
model downgrade was used to hide latency. WorkOS is an uncommitted/untracked
workspace; source fingerprints identify the tested builds, not Git commits.

## Actual UI, data, Tasks and speech proof

Final evidence:
[`../logs/finance-live-2026-10-08T11-16-18-667Z/results.json`](../logs/finance-live-2026-10-08T11-16-18-667Z/results.json).

- Actual isolated browser, authenticated WorkOS at `18791/#operator`; no mocked
  Finance APIs, task responses or model during the live run.
- Native wallet/position read, seven research results, and full four-row locked
  validation comparison rendered in the Finance tab.
- Equity SPY, crypto BTC-USD and currency EURUSD passed through native OpenBB.
  BBC headlines returned real dated source links. No raw credentials appeared
  in saved results; credential-value scanning ran before writing evidence.
- Desktop and 390px mobile screenshots, with no horizontal overflow or page
  errors. Screenshot animations disabled to avoid capturing a half-transitioned
  existing sidebar after viewport resize.
- Two actual native-model Tasks retrieved Finance evidence and returned grounded
  paper/study results in new conversations.
- A synthesized test question entered the browser microphone stream. Real
  browser VAD, Whisper Small, the existing `delivery=voice` task route, native
  Qwen3.8, Finance tool and Kokoro output completed; audible playback was observed.
  Hang-up released every synthetic microphone track.
- Model file hash checked before/after. Owned operator/Hub were restarted using
  their guarded lifecycle helpers; Finance's public-data container was recreated
  only to publish `127.0.0.1:18815`. Other Finance services remained running.

Screenshots in the same folder: `finance-desktop.png`, `finance-mobile.png`,
`finance-voice.png`. The physical owner's microphone and remote notebook audio
were not exercised in this test. Notebook route authorization was tested locally.

## Measured latency

These are observed samples, not throughput guarantees or a controlled benchmark.
The model/reasoning/context were unchanged throughout.

| Operation, final run | Measured time |
| --- | ---: |
| Finance view initial snapshot, including click/network | **87 ms** |
| Immediate repeated snapshot, cached | **6 ms** |
| SPY daily-price button → data | **690 ms** |
| BTC-USD daily-price read | **587 ms** |
| EURUSD daily-price read | **482 ms** |
| BBC headline button → data | **403 ms** |
| Paper question → completed Task response | **11.729 s**, one model call |
| Study question → completed Task response | **9.908 s**, two model calls |
| Voice setup including greeting | **2.618 s** |
| Synthetic speech start → transcript | **4.293 s** |
| Voice Task execution itself | **7.415 s**, one model call |
| Synthetic speech start → audible answer | **16.462 s** |

The first observed uncached native snapshot took **2.220 s** in the initial run;
later uncached reads were faster. A preceding full run recorded a **3.524 s**
single-model-call study answer and **16.422 s** speech-start-to-answer latency.
An earlier paper question took **34.759 s** and two model turns; the input
description was clarified that balance plus position count is one simple status
request, and the final sample used one turn. Return-direct remains model-selected,
not forced for complex questions. Cache/prefill state and shared inference can
change these numbers. Inference and speech remain the dominant conversational
delay; card reads do not invoke a model.

## Failures found and corrected

1. Ajv strict-required validation initially disabled the new manifest. Required
   fields were explicitly declared at their schema levels. Registry/API/agent
   tests then passed; no validation settings were weakened.
2. The first live run failed crypto price validation. Native OpenBB data showed
   that crypto/FX included the current unfinished date even with `end_date=today`.
   The connector now filters and counts outside-window/current-day bars before
   selecting a daily close. Regression test and all three asset-class live reads
   passed. Initial failed proof remains in
   `logs/finance-live-2026-10-08T11-10-35-112Z/`.
3. Native `/trades` totals count closed trades. The card/observation were labelled
   accordingly; two open positions do not contradict zero closed trades. Source:
   [Freqtrade 2026.9 RPC trade history](https://github.com/freqtrade/freqtrade/blob/2026.9/freqtrade/rpc/rpc.py).

Reproduce live read-only proof after building: from `operator/`, run
`node scripts/prove-finance.mjs`. It creates only verification conversations,
protected read observations and local evidence, using synthetic microphone input.

## Remaining external gates

- World Monitor needs the owner's connection and applicable data entitlement.
- X needs the selected authorized provider/account access and public handles.
- Polymarket's previously recorded hostname-validation failure is not bypassed;
  a valid accessible provider endpoint and selected wallet identities are needed.
- No profitable strategy was qualified. The historical study remains negative,
  with no holdout evaluation or promotion. No funded-execution connection exists.
