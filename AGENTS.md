# Repository Guidelines

## What This Is

Dependency-free Node.js 20+ ES module bot that paper-trades Polymarket BTC Up/Down 5m/15m markets using Chainlink RTDS prices. Paper mode is hard-coded (`paperOnly: true` in `src/config.js`): never add wallet keys, order-submission paths, or third-party dependencies. `src/main.js` is the only entrypoint and wires everything together; keep real logic in modules below (`main.js` has no test file).

Module map (filenames alone don't reveal these roles):

- Feeds: `clob-feed.js` (CLOB order-book WebSocket with REST fallback when books are stale), `crypto-feed.js` (Chainlink RTDS — the resolution authority), `reference-feeds.js` (Binance/Coinbase, reference-only: stored for analysis, never alters predictions)
- Event pipeline: `event-recorder.js` (append-only JSONL + gzip rotation), `event-history.js` (restart warm-up), `features.js`
- Decision path: `regime.js` → `strategy.js`, plus `bayesian.js`, `multi-timeframe.js`, `maker.js` (opt-in research primitives), `risk.js`, `fills.js`, `pricing.js` (sure-bet arb), `learning.js`
- State/reporting: `paper.js`, `store.js`, `settlement.js`, `metrics.js`, `calibration-metrics.js`, `status-server.js`, `telegram.js`

Tests in `test/` mirror module names (`src/pricing.js` → `test/pricing.test.js`).

## Commands

- `npm test` — full built-in `node:test` suite. Single file: `node --test test/strategy.test.js`.
- `npm run check` — syntax check of `src/main.js`.
- `npm run backtest` — chronological replay of `data/events/*.jsonl(.gz)`; throws if no event files exist yet and rejects malformed or time-travelling records.
- `npm run analyze` — calibration report over recorded events: derives each market's outcome from recorded Chainlink TWAP, scores actionable signals (Brier/log loss/reliability bins) and simulates fixed-stake P&L. Officially settled markets use their recorded resolution — derived Chainlink labels are a proxy that can disagree with Polymarket's oracle on borderline windows.
- `npm run export-metrics` — reads `data/paper-state.json`, writes `data/metrics.json`.
- `npm start` and pm2 (`ecosystem.config.cjs`) both pass `--env-file-if-exists=.env`; invoking `node src/main.js` directly does not load `.env` at all.

There is no build step, no dependencies to install, and no lint/format/typecheck tooling: verification means `npm test` plus targeted regression tests for any behavior change.

## Configuration

Every environment variable must be documented in `.env.example` and validated in `src/config.js` with min/max bounds — out-of-range values throw at startup (e.g. `PAPER_STAKE` caps at 1). Telegram activates only when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_ID` are set; the numeric admin ID is the authorization boundary for every interaction.

New research features ship disabled or conservative behind flags (`BAYESIAN_ANCHOR_ENABLED=false`, `BTC_1H_ENABLED=false`, …) until validated by walk-forward replay over recorded events — see the README improvement roadmap before adding signals or models.

## Runtime State (`data/`)

All of `data/` is gitignored runtime state — never commit or hand-edit it. `data/paper-state.json` is atomically rewritten portfolio state. `data/events/` holds append-only JSONL rotated at `EVENT_MAX_FILE_BYTES` (25 MB) and gzipped — roughly 0.9 GB/day at observed traffic, with no automatic retention policy. Keep schemas backward-compatible so old recordings stay replayable. Startup also replays recent Chainlink samples from `data/events/`, so wiping it makes a restart lose valid market-start references.

## Testing Conventions

Use `node:test` with `node:assert/strict`. Inject fake `fetch`/WebSocket implementations instead of calling live APIs; keep tests deterministic and cover success, malformed input, and safety boundaries (e.g. incomplete books, stale quotes).

## Style & Safety Boundaries

ES modules, 2-space indent, single quotes, semicolons, trailing commas; `camelCase` functions, `PascalCase` classes. Validate all external data and preserve request timeouts. Do not weaken: the paper-only boundary, Telegram admin authorization, atomic state writes, or staleness gates (stale oracle/book data disables predictions rather than trading blind).

## Commits & PRs

Imperative Conventional Commits with a scope (`fix(markets): reject incomplete books`). PRs explain behavior and risk, list verification commands, note configuration changes, and include sample Telegram output when messages change.
