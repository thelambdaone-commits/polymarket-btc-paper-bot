import test from 'node:test';
import assert from 'node:assert/strict';

import { detectCompleteSetArbitrage, takerFee } from '../src/pricing.js';

test('calculates the official crypto taker fee curve', () => {
  assert.equal(takerFee(100, 0.5, 0.07), 1.75);
  assert.equal(takerFee(100, 0.75, 0.07), 1.3125);
});

test('detects executable complete-set arbitrage after fees and buffer', () => {
  const opportunity = detectCompleteSetArbitrage({
    upAsk: 0.46,
    downAsk: 0.47,
    upSize: 20,
    downSize: 12,
    feeRate: 0.07,
    buffer: 0.005,
  });

  assert.equal(opportunity.shares, 12);
  assert.ok(opportunity.edgePerShare > 0);
  assert.ok(opportunity.expectedPnl > 0);
});

test('rejects a false arbitrage whose raw asks are below one but costs erase the edge', () => {
  assert.equal(
    detectCompleteSetArbitrage({
      upAsk: 0.49,
      downAsk: 0.49,
      upSize: 10,
      downSize: 10,
      feeRate: 0.07,
      buffer: 0.005,
    }),
    null,
  );
});
