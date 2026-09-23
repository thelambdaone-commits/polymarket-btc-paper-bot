import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAdaptiveStrategy,
  estimateExpiryProbability,
  evaluateTrend,
} from '../src/strategy.js';

test('converts observed return variance into per-second volatility', () => {
  const samples = [100, 101, 100, 101, 100];
  const perSecond = estimateExpiryProbability(samples, 100, 101, 30, 30);
  const perSample = estimateExpiryProbability(samples, 100, 101, 30, 1);

  assert.ok(perSecond > perSample);
});

test('returns UP when a probability trend clears the threshold', () => {
  const samples = [0.48, 0.49, 0.515];
  assert.deepEqual(evaluateTrend(samples, 0.02), { side: 'UP', change: 0.035 });
});

test('returns DOWN when a negative probability trend clears the threshold', () => {
  const samples = [0.54, 0.53, 0.51];
  assert.deepEqual(evaluateTrend(samples, 0.02), { side: 'DOWN', change: -0.03 });
});

test('returns HOLD for insufficient or malformed market data', () => {
  assert.equal(evaluateTrend([0.5], 0.02).side, 'HOLD');
  assert.equal(evaluateTrend([0.5, Number.NaN], 0.02).side, 'HOLD');
  assert.equal(evaluateTrend([0.5, 1.2], 0.02).side, 'HOLD');
});

test('selects trend following only in a directional crypto regime', () => {
  const signal = evaluateAdaptiveStrategy(
    {
      fresh: true,
      startPrice: 100,
      currentPrice: 101,
      twap60: 100.8,
      samples: [100, 100.1, 100.25, 100.4, 100.55, 100.7, 100.85, 101],
    },
    {
      upBid: 0.59,
      upBidSize: 30,
      upAsk: 0.6,
      upSize: 8,
      downBid: 0.39,
      downBidSize: 8,
      downAsk: 0.41,
      downSize: 30,
      midpointUp: 0.6,
    },
    { startTime: 1_000, endTime: 1_300 },
    1_150,
    {
      feeRate: 0.07,
      edgeBuffer: 0.005,
      minimumEntryPrice: 0.55,
      maximumEntryPrice: 0.8,
    },
  );

  assert.equal(signal.side, 'UP');
  assert.equal(signal.strategy, 'trend_following');
  assert.equal(signal.regime, 'directional');
  assert.ok(signal.netEdge > 0);
});

test('prices a developing move from volatility and time remaining before the market becomes extreme', () => {
  const signal = evaluateAdaptiveStrategy(
    {
      fresh: true,
      startPrice: 100,
      currentPrice: 100.1,
      twap60: 100.08,
      samples: [100, 100.015, 100.03, 100.045, 100.06, 100.075, 100.09, 100.1],
    },
    {
      upBid: 0.59,
      upAsk: 0.62,
      downBid: 0.37,
      downAsk: 0.4,
      midpointUp: 0.605,
    },
    { startTime: 1_000, endTime: 1_300 },
    1_170,
    {
      feeRate: 0.07,
      edgeBuffer: 0.005,
      minimumEntryPrice: 0.55,
      maximumEntryPrice: 0.8,
    },
  );

  assert.equal(signal.side, 'UP');
  assert.equal(signal.strategy, 'trend_following');
  assert.ok(signal.estimatedProbability > 0.7);
  assert.ok(signal.netEdge > 0);
});

test('still holds when the executable ask consumes the statistical edge', () => {
  const signal = evaluateAdaptiveStrategy(
    {
      fresh: true,
      startPrice: 100,
      currentPrice: 100.1,
      twap60: 100.08,
      samples: [100, 100.015, 100.03, 100.045, 100.06, 100.075, 100.09, 100.1],
    },
    { upAsk: 0.95, downAsk: 0.06, midpointUp: 0.945 },
    { startTime: 1_000, endTime: 1_300 },
    1_170,
    {
      feeRate: 0.07,
      edgeBuffer: 0.005,
      minimumEntryPrice: 0.55,
      maximumEntryPrice: 0.8,
    },
  );

  assert.equal(signal.side, 'HOLD');
  assert.equal(signal.reason, 'entry_outside_range');
});

test('selects mean reversion in a choppy stretched crypto regime', () => {
  const signal = evaluateAdaptiveStrategy(
    {
      fresh: true,
      startPrice: 100,
      currentPrice: 99.7,
      twap60: 100.6,
      samples: [100, 100.4, 99.8, 100.3, 99.6, 100.2, 99.7],
    },
    {
      upBid: 0.56,
      upBidSize: 20,
      upAsk: 0.58,
      upSize: 10,
      downBid: 0.41,
      downBidSize: 10,
      downAsk: 0.43,
      downSize: 20,
      midpointUp: 0.575,
    },
    { startTime: 1_000, endTime: 1_300 },
    1_150,
    {
      feeRate: 0.07,
      edgeBuffer: 0.005,
      minimumEntryPrice: 0.55,
      maximumEntryPrice: 0.8,
    },
  );

  assert.equal(signal.side, 'UP');
  assert.equal(signal.strategy, 'mean_reversion');
  assert.equal(signal.regime, 'choppy');
});

test('refuses to trade without fresh Chainlink data captured at market start', () => {
  const quote = { upAsk: 0.6, downAsk: 0.41 };
  const market = { startTime: 1_000, endTime: 1_300 };
  const config = {
    feeRate: 0.07,
    edgeBuffer: 0.005,
    minimumEntryPrice: 0.55,
    maximumEntryPrice: 0.8,
  };

  assert.equal(
    evaluateAdaptiveStrategy({ fresh: false }, quote, market, 1_150, config).reason,
    'stale_oracle',
  );
  assert.equal(
    evaluateAdaptiveStrategy({ fresh: true, startPrice: null }, quote, market, 1_150, config).reason,
    'missing_oracle_start',
  );
});
