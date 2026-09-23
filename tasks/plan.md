# Implementation Plan: Top-1% Paper Trading Research System

## Overview

Upgrade the dependency-free Polymarket BTC paper bot into a reproducible, auditable research system inspired by the four reviewed repositories while preserving its hard-coded paper-only boundary.

## Architecture Decisions

- Keep Node.js ES modules and JSONL event storage; do not add Python, SQLite, Docker, or live CLOB execution yet.
- Add pure, independently tested modules for regime classification, calibration metrics, paper risk limits, and metrics export.
- Keep new behavior conservative and disabled or observation-only unless explicitly configured.
- Preserve Chainlink as settlement truth; Binance/Coinbase remain reference features only.
- Extend timeframe support incrementally, starting with 1h discovery/observation and no automatic risk increase.

## Task List

### Phase 1: Research and data contracts

- [ ] Add versioned feature/decision metadata and a schema validator for recorded events.
- [ ] Add CLOB feature extraction: spread, imbalance, microprice, depth, volatility and time-to-expiry.
- [ ] Add explicit regime classification with confidence and trade gating.
- [ ] Add Brier, log loss, ECE and reliability buckets to backtest metrics.

### Checkpoint: Foundation

- [ ] Existing tests and all new unit tests pass.
- [ ] Replay remains chronological and deterministic.

### Phase 2: Risk and evaluation

- [ ] Add conservative fractional-Kelly sizing with per-market, per-timeframe, daily-loss and cooldown limits.
- [ ] Add drawdown, Sharpe-style paper metrics and performance breakdown by regime/timeframe.
- [ ] Add JSON/CSV metrics export and health snapshots.
- [ ] Integrate risk decisions into the paper observation path without enabling live execution.

### Phase 3: Multi-timeframe and model-ready pipeline

- [ ] Add 1h market discovery and observation profile.
- [ ] Add 1h bias → 15m confirmation → 5m entry alignment.
- [ ] Add Bayesian midpoint anchoring behind a feature flag.
- [ ] Add walk-forward model-training data export; no model is promoted without out-of-sample validation.

### Phase 4: Execution realism and operations

- [ ] Add maker queue/latency/adverse-selection simulation.
- [ ] Add /health, /status, /metrics endpoints and structured operational alerts.
- [ ] Add dataset hashes, configuration snapshots and reproducibility reports.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Overfitting historical events | High | Walk-forward splits and baseline comparisons |
| False confidence from small samples | High | Minimum cohorts and uncertainty labels |
| Risk logic blocks all useful paper signals | Medium | Observation-only diagnostics and conservative defaults |
| Timeframe slug/rule differences | High | Validate market rules and test 1h separately |
| Runtime/storage growth | Medium | Existing rotation plus explicit retention metrics; no deletion automation |

## Definition of Done

- `npm test` passes.
- `npm run check` passes.
- New metrics and risk logic have deterministic unit tests.
- Paper-only boundary remains enforced.
- README documents new commands, configuration and limitations.
