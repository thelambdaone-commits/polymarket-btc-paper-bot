import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRegime } from '../src/regime.js';

test('blocks ranging and trap conditions', () => {
  const result = classifyRegime({
    oracle: { startPrice: 100, currentPrice: 99.7, samples: [100, 100.4, 99.8, 100.3, 99.6, 100.2, 99.7] },
    features: { twapDeviation: -0.009 },
  });
  assert.equal(result.tradeAllowed, false);
  assert.ok(['ranging', 'trap'].includes(result.regime));
});

test('allows a directional trending condition', () => {
  const result = classifyRegime({
    oracle: { startPrice: 100, currentPrice: 101, samples: [100, 100.1, 100.25, 100.4, 100.55, 100.7, 100.85, 101] },
    features: { twapDeviation: 0.002 },
  });
  assert.equal(result.tradeAllowed, true);
  assert.equal(result.regime, 'trending');
});
