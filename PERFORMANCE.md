# Basic response speed and reliability

## Priority and diagnosed cause — 2026-09-26

Matko reported Prague weather requests taking 1–2 minutes or producing no answer,
and explicitly prioritized basic response speed/correctness over additional features.

The running model was **qwen3.5:9b**, not a 3.5B model. At diagnosis, `ollama ps`
showed **6.6 GB, 100% GPU residency, 32,768 context**. A reproduced warm request
took **19.698 seconds** while direct HTTPS weather endpoints answered in roughly
**0.2–0.5 seconds**. Native history showed one weather-skill read followed by **four
curl executions**, without explicit curl deadlines. The request also received
unrelated project instructions.

Evidence: `logs/weather-diagnostic-20260926T190514Z/`. This establishes a measured
orchestration problem; it does not prove every reported 1–2-minute delay had one cause.

## What changed

- **Direct handlers for clear basic requests:** routine weather, greetings, and
  simple arithmetic return checked results without a language-model planning loop.
  Other requests retain the selected model and reasoning settings.
- **Weather:** fixed-host HTTPS Open-Meteo geocoding/current/forecast APIs, six-second
  shared lookup budget, bounded worker pool, coalesced identical lookups, 60-second
  weather cache, and 24-hour location cache. Returned numbers/units are validated.
  Missing/ambiguous locations request clarification; unavailable data is not invented.
- **No unwanted forecast essay:** current questions get current conditions, matched
  city/country, source, and local data time. Explicit today/tomorrow requests use
  the provider's dated forecast. The model does not invent weekdays or extra details.
- **Old shell weather routing retired:** installed skill sources remain, but the
  shell-based Weather skill is disabled for active agent routing. Native
  `jarvis_weather` remains available for weather requests needing interpretation.
- **Relevant context only:** clear weather/social/arithmetic requests skip project
  source/instruction reads. Code and mixed requests keep normal project context.
- **Native history retained:** direct Q/A records are appended through supported
  `sessions.patch` / `chat.inject` RPCs, then projected as ordinary user/assistant
  messages. No second transcript database was introduced. A metadata flag and
  bounded native-derived context cache preserve follow-ups across host restarts.
- **Speech can overlap bookkeeping:** verified weather text is available before
  its native save finishes; terminal success still requires successful persistence.
- **Bounded client waits:** job submission, polling/body reads, cancellation, and
  history reconciliation have deadlines. A conversation's history refresh is
  single-flight, preventing overlapping refreshes from continually invalidating
  each other and leaving the conversation busy.

This is a conservative fast path, not a claim that every arbitrary natural-language
request can bypass reasoning or external tools.

## Measured results through the public notebook HTTPS endpoint

Final run: `logs/basic-speed-20260926T202340Z/results.json`.

| Query | First answer text | Completed and saved |
|---|---:|---:|
| Prague weather, first request | 0.923 s | 2.665 s |
| Prague weather, repeat | 0.470 s | 1.372 s |
| Brno weather | 0.932 s | 1.830 s |
| Hi Jarvis | 1.225 s | 1.225 s |
| What is 2+2? | 1.302 s | 1.302 s |

All five returned an answer and preserved both question and answer in the native
history projection. The direct routes made **zero model/tool-orchestration calls**;
weather still used its live data connector and native transcript RPCs.

The full browser voice path measured **7.545 seconds from synthetic utterance end
to first audible weather output**, including recognition, HTTPS transport, lookup,
and speech generation. Evidence:
`logs/notebook-browser-2026-09-26T20-23-59-276Z/results.json`.
The first voice check before overlapping history persistence measured 8.765 seconds.
Speech processing and transport remain additional latency; do not describe the
1–3-second text timings as microphone-to-audio timings.

## Verification

- **74 backend tests**, **26 frontend tests**, production build, Gateway config,
  native tool contracts, and project connectivity passed:
  `logs/project-checks-20260926T201504Z/`.
- Real public HTTPS call, live weather, audio playback, and history after refresh
  passed with synthetic microphone input. Physical microphone/acoustic behavior
  was not re-certified by these tests.
- A 5.5-second delayed-history browser check issued one history request and restored
  admission, rather than repeatedly invalidating the response:
  `logs/voice-browser-2026-09-26T20-01-38-029Z/`.
- Tests cover malformed provider values, ambiguous locations, cache expiry/isolation,
  shared in-flight requests, uncooperative-worker deadline, cancellation, native-record
  projection/attestation, restart context recovery, and stalled fetch/body deadlines.
- A final same-country place-ambiguity correction passed the eight focused weather
  tests and live provider checks (`logs/basic-speed-20260926T203537Z/`); specifying
  a country alone no longer suppresses clarification between similarly sized cities.
- The intermediate model-mediated replacement still took 12.727 seconds on its
  first Prague query and added unwanted forecast details. That result is retained
  in `logs/basic-speed-20260926T193038Z/`; it was not accepted as the final fix.

Repeat from the repository root:

```text
python scripts/verify_projects.py --frontend --live
python scripts/verify_basic_queries.py --provider-only
python scripts/verify_basic_queries.py
npm --prefix frontend run test:notebook -- --grep "Prague weather speaks"
```

The notebook link must be active for external checks. Credentials stay in the
ignored runtime configuration and are not printed or captured in browser traces.
