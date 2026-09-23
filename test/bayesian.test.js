import test from 'node:test';
import assert from 'node:assert/strict';

import { applyBayesianAnchor } from '../src/bayesian.js';

test('dampens an overconfident model probability toward the CLOB midpoint', () => {
  const result = applyBayesianAnchor(
    { side: 'UP', estimatedProbability: 0.9, entryPrice: 0.6 },
    { midpointUp: 0.6 },
    { damping: 0.5 },
  );
  assert.ok(result.adjustedProbability < 0.9);
  assert.ok(result.adjustedProbability > 0.6);
  assert.equal(result.bayesianPrior, 0.6);
});

test('leaves HOLD and malformed inputs untouched', () => {
  const signal = { side: 'HOLD', reason: 'test' };
  assert.deepEqual(applyBayesianAnchor(signal, { midpointUp: 0.5 }), signal);
});
