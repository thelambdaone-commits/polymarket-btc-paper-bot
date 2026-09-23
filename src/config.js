function finiteNumber(env, name, fallback, { min, max }) {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function booleanValue(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env) {
  const observationIntervalMs = finiteNumber(env, 'OBSERVATION_INTERVAL_MS', 100, {
    min: 0,
    max: 60_000,
  });
  if (observationIntervalMs < 100) {
    throw new Error('OBSERVATION_INTERVAL_MS must be at least 100');
  }

  return Object.freeze({
    paperOnly: true,
    timeframes: booleanValue(env, 'BTC_1H_ENABLED', false) ? [5, 15, 60] : [5, 15],
    observationIntervalMs,
    marketRefreshMs: finiteNumber(env, 'MARKET_REFRESH_MS', 10_000, {
      min: 1_000,
      max: 300_000,
    }),
    clobMaxFreshnessMs: finiteNumber(env, 'CLOB_MAX_FRESHNESS_MS', 2_000, {
      min: 100,
      max: 30_000,
    }),
    rawEventRecording: booleanValue(env, 'RAW_EVENT_RECORDING', true),
    eventMaxFileBytes: finiteNumber(env, 'EVENT_MAX_FILE_BYTES', 25_000_000, {
      min: 1_000_000,
      max: 1_000_000_000,
    }),
    maximumFillSlippage: finiteNumber(env, 'MAXIMUM_FILL_SLIPPAGE', 0.03, {
      min: 0,
      max: 0.5,
    }),
    referenceFeedsEnabled: booleanValue(env, 'REFERENCE_FEEDS_ENABLED', true),
    referenceFeedFreshnessMs: finiteNumber(env, 'REFERENCE_FEED_FRESHNESS_MS', 5_000, {
      min: 500,
      max: 60_000,
    }),
    clobRecordIntervalMs: finiteNumber(env, 'CLOB_RECORD_INTERVAL_MS', 250, {
      min: 0,
      max: 10_000,
    }),
    startingBalance: finiteNumber(env, 'PAPER_STARTING_BALANCE', 20, {
      min: 1,
      max: 10_000_000,
    }),
    stake: finiteNumber(env, 'PAPER_STAKE', 1, { min: 0.01, max: 1 }),
    feeRate: finiteNumber(env, 'CRYPTO_TAKER_FEE_RATE', 0.07, { min: 0, max: 0.2 }),
    edgeBuffer: finiteNumber(env, 'EDGE_BUFFER', 0.005, { min: 0, max: 0.1 }),
    arbitrageBuffer: finiteNumber(env, 'ARBITRAGE_BUFFER', 0.005, { min: 0, max: 0.1 }),
    minimumEntryPrice: finiteNumber(env, 'MINIMUM_ENTRY_PRICE', 0.55, { min: 0.5, max: 0.95 }),
    maximumEntryPrice: finiteNumber(env, 'MAXIMUM_ENTRY_PRICE', 0.8, { min: 0.55, max: 0.99 }),
    minimumLearningSamples: finiteNumber(env, 'MINIMUM_LEARNING_SAMPLES', 5, {
      min: 5,
      max: 100,
    }),
    regimeGateEnabled: booleanValue(env, 'REGIME_GATE_ENABLED', true),
    kellyFraction: finiteNumber(env, 'KELLY_FRACTION', 0.25, { min: 0.01, max: 1 }),
    maxStake: finiteNumber(env, 'MAX_PAPER_STAKE', 1, { min: 0.01, max: 1_000_000 }),
    minimumStake: finiteNumber(env, 'MINIMUM_PAPER_STAKE', 0.01, { min: 0.01, max: 1_000 }),
    maxOpenExposure: finiteNumber(env, 'MAX_OPEN_EXPOSURE', 5, { min: 0.01, max: 10_000_000 }),
    maxDailyLoss: finiteNumber(env, 'MAX_DAILY_LOSS', 5, { min: 0.01, max: 10_000_000 }),
    maxConsecutiveLosses: finiteNumber(env, 'MAX_CONSECUTIVE_LOSSES', 3, { min: 1, max: 100 }),
    bayesianAnchorEnabled: booleanValue(env, 'BAYESIAN_ANCHOR_ENABLED', false),
    bayesianDamping: finiteNumber(env, 'BAYESIAN_DAMPING', 0.65, { min: 0, max: 1 }),
    multiTimeframeEnabled: booleanValue(env, 'MULTI_TIMEFRAME_ENABLED', false),
    statusEnabled: booleanValue(env, 'STATUS_ENABLED', false),
    statusPort: finiteNumber(env, 'STATUS_PORT', 8787, { min: 1, max: 65_535 }),
  });
}
