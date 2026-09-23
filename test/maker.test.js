import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateMakerFill } from '../src/maker.js';

test('simulates queue-aware partial maker fills and adverse selection', () => {
  const result = simulateMakerFill({
    orderPrice: 0.55, orderSize: 10, bestBid: 0.55, bestAsk: 0.58,
    queueAhead: 3, matchedVolume: 8, latencyMs: 40, adverseSelectionBps: 5,
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.filled, 5);
  assert.equal(result.effectivePrice, 0.550275);
});

test('does not treat a crossing order as a maker fill', () => {
  assert.equal(simulateMakerFill({ orderPrice: 0.59, orderSize: 1, bestBid: 0.55, bestAsk: 0.58 }).status, 'not_maker');
});
