import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFillToSignal, simulateTakerFill } from '../src/fills.js';

test('fills a paper stake across multiple ask levels including taker fees', () => {
  const fill = simulateTakerFill({
    stake: 1,
    asks: [{ price: 0.5, size: 1 }, { price: 0.6, size: 1 }],
    feeRate: 0.07,
    maximumSlippage: 0.25,
  });

  assert.equal(fill.shares, 1.83333333);
  assert.equal(fill.averagePrice, 0.545455);
  assert.equal(fill.fee, 0.0315);
  assert.equal(fill.levelsConsumed, 2);
  assert.equal(fill.totalCost, 1.0315);
});

test('refuses partial or excessively slipped paper fills', () => {
  assert.equal(simulateTakerFill({
    stake: 1,
    asks: [{ price: 0.6, size: 1 }],
    feeRate: 0.07,
    maximumSlippage: 0.1,
  }), null);
  assert.equal(simulateTakerFill({
    stake: 1,
    asks: [{ price: 0.5, size: 1 }, { price: 0.7, size: 1 }],
    feeRate: 0.07,
    maximumSlippage: 0.1,
  }), null);
});

test('removes a signal whose executable multi-level fill erases its edge', () => {
  const signal = applyFillToSignal({
    side: 'UP',
    adjustedProbability: 0.61,
    strategy: 'trend_following',
  }, {
    averagePrice: 0.6,
    shares: 1.66666667,
    fee: 0.028,
    totalCost: 1.028,
    levelsConsumed: 2,
  }, { edgeBuffer: 0.005 });

  assert.equal(signal.side, 'HOLD');
  assert.equal(signal.reason, 'fill_removed_edge');
});
