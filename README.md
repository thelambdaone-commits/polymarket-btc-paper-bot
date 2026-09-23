# Paper Prediction Bot

A dependency-free, **paper-trading-only** observer for Polymarket BTC Up/Down 5-minute and
15-minute markets. It reads executable order books and the official BTC/USD Chainlink 30-second
and 60-second TWAP feeds. A regime selector chooses trend following in directional conditions,
mean reversion in choppy conditions, or no directional trade when neither has a defensible edge.
Every prediction must clear fees plus a safety buffer. The bot records predictions, reconciles
official resolutions, and adjusts future confidence from settled calibration errors. It never
reads a wallet key and has no order-submission code.

## Run

Requires Node.js 20 or newer.

```bash
cp .env.example .env  # optional reference; Node does not load it automatically
npm test
npm start
```

Configuration is read from the process environment. Example:

```bash
PAPER_STAKE=1 npm start
```

### Research controls

The paper engine now records CLOB-derived features (spread, microprice, depth, imbalance and
time-to-expiry), classifies each window into a conservative regime, and applies risk limits before
simulating a fill. Kelly sizing is fractional and capped; daily loss, open exposure and consecutive
loss limits are paper-only safeguards. New controls are disabled or conservative by default:

```dotenv
REGIME_GATE_ENABLED=true
KELLY_FRACTION=0.25
MAX_PAPER_STAKE=1
MAX_OPEN_EXPOSURE=5
MAX_DAILY_LOSS=5
MAX_CONSECUTIVE_LOSSES=3
BTC_1H_ENABLED=false
BAYESIAN_ANCHOR_ENABLED=false
MULTI_TIMEFRAME_ENABLED=false
```

Enable the 1-hour profile only for observation first. The Bayesian anchor moves model probability
toward the executable CLOB midpoint and is opt-in; it must be validated with walk-forward replay
before being enabled for paper decisions.

Export a reproducible report from persisted paper history with:

```bash
npm run export-metrics
```

The report includes realized P&L, maximum drawdown, descriptive per-trade Sharpe, Brier score,
log loss, ECE, reliability bins, and breakdowns by timeframe, regime and strategy. `src/maker.js`
and `src/multi-timeframe.js` provide deterministic paper research primitives for queue-aware maker
fills and 1h → 15m → 5m alignment; they remain opt-in until a sufficiently large event dataset
supports honest calibration.

Stop with `Ctrl+C`. Output is newline-delimited JSON, suitable for later analysis.

Raw market events are written as versioned JSON Lines under `data/events/`. Files are append-only
and rotate at `EVENT_MAX_FILE_BYTES` (25 MB by default); completed segments are compressed with
gzip. Every message still updates the live in-memory book, while CLOB snapshots and raw deltas are
archived at a configurable 250 ms cadence to protect VPS storage. Replay every recorded file in strict
chronological order—including compressed segments—with:

```bash
npm run backtest
```

The replay rejects malformed, oversized, or time-travelling records and reports decisions,
settled wins/losses, and realized paper P&L. Event files are local runtime state: never commit or
hand-edit them.

For a research view of prediction quality, run:

```bash
npm run analyze
```

It derives each market's outcome from the recorded Chainlink TWAP (officially settled markets use
their recorded resolution), then reports Brier/log loss, reliability bins, fixed-stake P&L by
strategy, regime, and timeframe, plus an exploratory momentum-persistence statistic over recorded
windows. Treat every number as provisional until thousands of markets are recorded: officially
resolved outcomes can disagree with derived Chainlink labels on borderline windows because the
oracle reads its own raw stream at expiry.

### Storage capacity

The observed recording rate on 2026-08-24 was approximately **31 MB in 50 minutes**, including
compressed rotations and the active JSONL file. If traffic remains comparable, budget roughly
**0.9 GB per day**, **6.3 GB per week**, or **27 GB per month**, plus free space for the active file
and compression. This is an operational estimate, not a fixed limit: CLOB activity and reconnects
can increase it. Monitor both `du -sh data/events` and filesystem usage, alert before 80%, and move
closed `.jsonl.gz` segments to durable storage before deleting any local copy. Keep enough history
for chronological walk-forward tests. The bot currently rotates and compresses files but does not
apply an automatic retention or deletion policy.

## Telegram and PM2

Telegram is enabled only when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_ID` exist in the local
`.env`. The numeric admin ID is an authorization boundary: messages from every other chat are
ignored. Available command: `/status`.

The Telegram dashboard separates available cash from capital committed to open predictions. It
reports settled/open counts, realized P&L and ROI, average P&L, profit factor, recent form, and a
5-minute/15-minute breakdown. A sample-size notice is always displayed: a high win rate over a few
settled predictions is not evidence of a durable edge. Signal alerts also show entry price,
estimated probability, estimated net edge, and the learning cohort size.

Run continuously after configuring `.env`:

```bash
pm2 start ecosystem.config.cjs
pm2 status polymarket-btc-paper-bot
```

## What the numbers mean

The selector measures the BTC move from the Chainlink price captured at the market boundary,
path efficiency, deviation from the 60-second TWAP, recent volatility, time remaining, executable
asks, fees, and the configured edge buffer. Directional regimes use a volatility-scaled expiry
probability, allowing an earlier entry only when it remains positive after costs. At startup, the
feed restores up to 20 minutes of recorded Chainlink history so a process restart does not discard
valid market-start references. It still refuses stale or genuinely missing oracle data.
Market-making conditions remain observations only because paper fills cannot
prove that passive orders would execute. Complete-set sure bets are reported separately after both
asks, available size, fees, and a slippage buffer are considered.

Every prediction and sure-bet observation is atomically persisted in `data/paper-state.json`.
Officially closed markets update wins, losses, realized P&L, ROI, and calibration history. Learning
uses shrinkage and activates only after a minimum number of settled predictions in the same
side/timeframe cohort; it cannot guarantee future profitability.

Dashboard definitions:

- **Cash available** excludes stakes and estimated fees committed to open positions.
- **Committed capital** is the cost basis of currently open paper positions, not a live valuation.
- **Realized ROI** is settled P&L divided by settled cost basis; unrealized positions are excluded.
- **Profit factor** is gross settled profit divided by gross settled loss and remains unavailable
  until at least one losing prediction exists.
- **Sure bet** means a fee-, buffer-, and liquidity-filtered observation. It does not guarantee that
  both sides could be filled simultaneously in live trading.

## Safety and limitations

- Paper mode is hard-coded; there is no live execution path.
- External JSON and prices are validated and requests time out after five seconds.
- Chainlink RTDS reconnects automatically; missing or stale oracle data disables new predictions.
- A 100 ms loop does not guarantee 100 ms market-data latency. Network/API latency dominates, and
requests never overlap.
- Executable CLOB quotes come from a public market WebSocket. Both outcome books must have complete
  snapshots newer than `CLOB_MAX_FRESHNESS_MS` (2 seconds by default); missing or stale books fall
  back to the batched REST endpoint. Disconnects invalidate all cached books until resynchronized.
- Polymarket BTC markets resolve from their stated Chainlink BTC/USD stream, not an arbitrary spot
  exchange. Always check each market's rules.
- Availability and trading eligibility depend on jurisdiction and Polymarket's current terms.

## Improvement roadmap

Implement these phases before adding machine-learning or LLM-based signals:

1. Record raw, timestamped CLOB and Chainlink events in an append-only dataset. Preserve market and
   token IDs, local receipt time, source time, sequence/hash when available, full snapshots, deltas,
   reconnects, stale periods, and every `HOLD` decision. Rotate and compress files without modifying
   `data/paper-state.json`.
2. Build an event-driven backtester that replays this dataset strictly in chronological order. It
   must prevent look-ahead, reproduce market discovery and strategy decisions, and report results
   by timeframe, regime, strategy, probability calibration, and walk-forward test period.
3. Improve paper fills before evaluating market making: model spread, fees, latency, queue position,
   partial fills, cancellations, unavailable size, slippage, adverse selection, and the risk that
   only one side of a two-sided order executes.
4. Add complementary BTC reference feeds over WebSocket, initially Binance and Coinbase. Treat them
   as optional features for price discovery, cross-exchange divergence, volatility, and data-quality
   checks; Chainlink remains authoritative whenever the Polymarket rules specify Chainlink for
   resolution. A failed secondary feed must never block the core bot.

Each phase needs deterministic tests, versioned data schemas, health metrics, and paper validation
before the next phase starts.

Current status: raw CLOB, Chainlink, Binance, Coinbase, decision, and settlement events are recorded;
the chronological replay engine and multi-level taker-fill simulation are active. Binance and
Coinbase are reference-only inputs stored for future backtests—they do not alter predictions.
Market-maker queue position, cancellation races, and two-sided passive fills still require a larger
recorded dataset before they can be calibrated honestly.

The current signal remains a deterministic Chainlink-based heuristic with optional Bayesian anchoring;
there is deliberately no promoted XGBoost/LightGBM/LSTM model. A future model must use the recorded
features, time-based walk-forward splits, versioned weights and out-of-sample calibration before it
can influence paper decisions.

Prefer official interfaces before importing third-party trading code:

1. Adopt the official [TypeScript SDK](https://github.com/Polymarket/ts-sdk) market WebSocket and
   reconnect patterns. Replacing repeated CLOB REST snapshots with event-driven books is the most
   useful immediate latency improvement.
2. Build execution-aware replay tests using ideas from
   [polymarket-backtest](https://github.com/cengizmandros/polymarket-backtest): chronological events,
   no look-ahead, fees, spread, partial fills, and calibration by strategy and market regime.
3. Compare the current oracle handling with
   [polymarket-twap-trading-bot](https://github.com/guskarls/polymarket-twap-trading-bot), especially
   TWAP reconstruction, staleness checks, reconnects, and raw-sample recording.
4. Use [polybtc](https://github.com/LukasNSteel/polybtc) as a research reference for
   favorite/underdog and horizon analysis. Reproduce every result locally before changing signals.
5. Study [polymarket-terminal](https://github.com/direkturcrypto/polymarket-terminal) only for maker
   simulation, inventory limits, and fill-state ideas. Consider the official
   [Rust CLOB client](https://github.com/Polymarket/rs-clob-client) only if profiling later proves
   Node.js is the bottleneck.
6. Evaluate Groq only after raw-data collection and event-driven backtesting are operational. Use
   the free tier for asynchronous performance reports, loss analysis, or an experimental news
   sentiment feature—not for the 100 ms market loop. Any sentiment output must use a strict JSON
   schema, include its sources, model, prompt version, timestamp, confidence, and expiry, and be
   stored so decisions can be replayed. Default the integration to disabled, enforce a short
   timeout and rate limit, and ignore it safely when unavailable. Promote it to a paper signal only
   if a chronological A/B backtest over thousands of markets improves calibrated probability and
   net P&L after fees; otherwise keep it as reporting-only functionality.

Community performance claims are not evidence of an edge. Security-audit code, check its license,
pin revisions, and validate it in paper mode before reusing it. A live market-maker additionally
needs two-sided fill simulation, adverse-selection limits, price guards, inventory caps, and a kill
switch, as described in Polymarket's [market-making guide](https://docs.polymarket.com/trading/market-making).

Suggested future Groq configuration:

```dotenv
GROQ_ENABLED=false
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
GROQ_ANALYSIS_INTERVAL_MS=300000
GROQ_TIMEOUT_MS=2000
```

Free-tier quotas vary by model and account; check the official
[Groq rate limits](https://console.groq.com/docs/rate-limits) before enabling the experiment. Never
commit the API key or send wallet credentials, Telegram secrets, or private portfolio data.

## Deployment region and latency

Use **AWS `eu-west-1` (Dublin)** as the first production candidate. Polymarket documents its primary
servers in London (`eu-west-2`) and Dublin as the closest non-georestricted AWS region. Ireland is
currently frontend close-only, while its API is not restricted. Direct London colocation is an
institutional option requiring KYC/KYB. These facts can change; verify the official
[geographic restrictions](https://docs.polymarket.com/api-reference/geoblock) before deployment.

Server location must never be used to bypass a user's or operator's eligibility. At startup, query
`https://polymarket.com/api/geoblock` and fail closed when `blocked` is true. Before choosing a host,
run the same paper workload for at least 24 hours in Dublin and one alternative, then compare CLOB
order acknowledgement, WebSocket event age, Chainlink RTDS event age, and p50/p95/p99—not ping alone.
On 2026-08-24, this server's short baseline was approximately 113 ms CLOB p50 and 85 ms Gamma p50;
the long-tail spikes show why a single request is not a useful benchmark.

## Official references

- Market listing: https://docs.polymarket.com/api-reference/markets/list-markets
- CLOB market data: https://docs.polymarket.com/market-data/overview
- Market WebSocket: https://docs.polymarket.com/api-reference/wss/market
- Chainlink TWAP: https://docs.polymarket.com/market-data/chainlink-twap
- Real-time data: https://docs.polymarket.com/market-data/realtime-data
- Geographic restrictions: https://docs.polymarket.com/api-reference/geoblock
- Trader leaderboard: https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings
