# Finance in JARVIS Tasks

**Connected and verified 2026-10-08.** Open
<http://127.0.0.1:18791/#operator> and choose **Finance** beside Assistant.
Refresh an already-open browser tab to load the new build.

The Finance view reads the native services directly. The existing Tasks assistant
and its Talk button use the same connection. There is no second assistant/model
request to the standalone Finance gateway.

## Available now

- Paper wallet, allocation, open positions, closed-trade count and seven daily
  results, with actual observation time.
- The registered October 7 locked RSI validation comparison, including signed
  losses, wallet drawdown, holdout status and unchanged paper parameters.
- Saved historical workbench result identifiers and execution times.
- Dated daily prices for SPY, QQQ, AAPL, MSFT, NVDA, BTC-USD, ETH-USD, EURUSD,
  USDCZK and EURCZK; selected explicitly in the view or by the assistant.
- Five public BBC headlines with dates and source links.

Try in **Assistant** or **Talk**:

> What is my current virtual paper wallet balance and open-position count?

> What was the locked Finance study outcome? Was the holdout tested or anything promoted?

> Read the recent dated daily prices for BTC-USD.

The **Review with JARVIS** and **Explain with JARVIS** buttons continue in the
same Tasks conversation. Cards and explicit price/headline reads do not wait for
inference. Simple status questions can use a model-selected, checked numeric
reply without a second model turn; explanations retain normal reasoning.

## Connection and scope

`operator/config/finance.json` selects the sibling Finance installation, the
local owner identity, and one registered study. Existing `operator.chat` and
`connections.manage` permissions, the configured tenant/owner, and secure-channel
policy apply. This adds no database schema, identity migration or new password.

| Source | Fixed local connection |
| --- | --- |
| Paper simulator | Authenticated GETs to `127.0.0.1:18812/api/v1/` |
| Historical workbench | Authenticated GETs to `127.0.0.1:18814/api/v1/` |
| Public data | Official MCP SDK **1.32.1** → native OpenBB at `127.0.0.1:18815/mcp` |
| Locked study | Bounded, projected `evidence/2026-10-07-rsi/COMPARISON.json` |

Paper/research authorization is read server-side from their existing private
`state/<service>/credentials.env` files. Credentials are not copied into the
WorkOS environment, browser, model observations or evidence. Backend paths and
operations are fixed; callers cannot supply URLs, files, headers or commands.

The connector rejects paper endpoints outside dry-run and research endpoints
outside historical webserver mode. There are no order, strategy-edit, backtest
start/abort, file-write or generic MCP-dispatch operations in this connector.
The former configuration-only constraint has an owner-approved exception for
this small WorkOS connector/view; the Finance deployment itself still uses
upstream services and an unchanged strategy.

Snapshots use a five-second in-process cache; public data uses thirty seconds.
Every cache read rechecks identity/permission. The view shows the original
observation timestamp and cache age; failures are not cached as successful reads.
Individual sources can be unavailable while the other overview cards remain
usable. Reads have a 22-second overall deadline and bounded response/file sizes.

### Interpreting the data

- All trading funds/results here are virtual or historical.
- Wallet balance and allocated capital differ. The unallocated reserve is not
  profit. Native `/trades` history counts **closed** trades; open positions come
  from `/status` and `/count`.
- Daily market bars are not real-time quotes. Current-day/in-window-excluded bars
  are counted and omitted: the installed crypto/FX provider sometimes includes
  today's unfinished bar despite the requested exclusive end date.
- The study's verification date is distinct from when JARVIS read it. The current
  decision remains **NO_QUALIFIED_CANDIDATE**. Smaller losses are not profits;
  holdout evaluation and promotion did not occur.
- Numeric fast replies format wallet amounts to at most eight decimal places;
  original numeric observations remain in the protected tool result.

## Startup and verification

Start the existing Finance Compose project from its own directory, then use the
normal WorkOS startup (`python -B scripts/dev.py up --voice`). OpenBB's new host
publication is loopback-only; paper/research MCP adapters remain internal.
The authenticated notebook bridge allows only the Finance snapshot GET and the
existing permissioned tool invocation route, preserving its access-expiry policy.

Current model remains **Qwen3.8-27B / xhigh / 32768 context / 8192 output**.
Clinic/private memory, selected model, paper strategy and study files were
preserved. Native Finance schedules and backup services continue independently.

[Actual verification and latency](docs/FINANCE-VERIFICATION.md) records the
builds, tests, desktop/mobile UI, real Tasks calls and a synthetic-microphone
test through real speech recognition, native inference, Finance and speech output.

External World Monitor/X entitlements and the prior Polymarket TLS/wallet gates
remain separate activation work. They do not block this local connection.
