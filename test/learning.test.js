import test from 'node:test';
import assert from 'node:assert/strict';

import { calibrateSignal } from '../src/learning.js';

test('shrinks future confidence after systematically overconfident misses', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    status: 'SETTLED',
    side: 'UP',
    timeframeMinutes: 5,
    strategy: 'trend_following',
    estimatedProbability: 0.7,
    winningSide: index < 3 ? 'UP' : 'DOWN',
    pnl: index < 3 ? 1 : -1,
  }));
  const result = calibrateSignal(
    {
      side: 'UP',
      strategy: 'trend_following',
      entryPrice: 0.6,
      estimatedProbability: 0.7,
    },
    history,
    5,
    { feeRate: 0.07, edgeBuffer: 0.005, minimumLearningSamples: 5 },
  );

  assert.ok(result.adjustedProbability < 0.7);
  assert.equal(result.side, 'HOLD');
});

test('applies a small correction after the first settled error without overreacting', () => {
  const result = calibrateSignal(
    {
      side: 'UP',
      strategy: 'trend_following',
      entryPrice: 0.6,
      estimatedProbability: 0.7,
    },
    [{
      status: 'SETTLED',
      side: 'UP',
      timeframeMinutes: 5,
      strategy: 'trend_following',
      estimatedProbability: 0.9,
      winningSide: 'DOWN',
    }],
    5,
    { feeRate: 0.07, edgeBuffer: 0.005, minimumLearningSamples: 5 },
  );

  assert.ok(result.adjustedProbability < 0.7);
  assert.ok(result.adjustedProbability > 0.65);
});

test('waits for feedback before stacking the same strategy and timeframe', () => {
  const result = calibrateSignal(
    {
      side: 'DOWN',
      strategy: 'trend_following',
      entryPrice: 0.58,
      estimatedProbability: 0.64,
    },
    [{
      status: 'PENDING',
      side: 'UP',
      timeframeMinutes: 5,
      strategy: 'trend_following',
      estimatedProbability: 0.67,
    }],
    5,
    { feeRate: 0.07, edgeBuffer: 0.005, minimumLearningSamples: 5 },
  );

  assert.equal(result.side, 'HOLD');
  assert.equal(result.reason, 'awaiting_strategy_feedback');
});

test('a first loss can remove a marginal opposite-side signal from the same strategy', () => {
  const result = calibrateSignal(
    {
      side: 'DOWN',
      strategy: 'trend_following',
      entryPrice: 0.58,
      estimatedProbability: 0.632806,
    },
    [{
      status: 'SETTLED',
      side: 'UP',
      timeframeMinutes: 5,
      strategy: 'trend_following',
      estimatedProbability: 0.665172,
      winningSide: 'DOWN',
    }],
    5,
    { feeRate: 0.07, edgeBuffer: 0.005, minimumLearningSamples: 5 },
  );

  assert.equal(result.side, 'HOLD');
  assert.equal(result.reason, 'learning_removed_edge');
  assert.equal(result.cohortSamples, 1);
});
