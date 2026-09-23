import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateCalibrationMetrics } from '../src/calibration-metrics.js';

test('calculates Brier, log loss, ECE and reliability bins', () => {
  const metrics = calculateCalibrationMetrics([
    { status: 'SETTLED', side: 'UP', winningSide: 'UP', estimatedProbability: 0.8 },
    { status: 'SETTLED', side: 'DOWN', winningSide: 'UP', estimatedProbability: 0.7 },
  ]);
  assert.equal(metrics.samples, 2);
  assert.ok(metrics.brierScore >= 0);
  assert.ok(metrics.logLoss > 0);
  assert.ok(metrics.ece >= 0);
  assert.equal(metrics.reliability.length, 2);
});

test('returns explicit empty metrics for insufficient settled data', () => {
  assert.deepEqual(calculateCalibrationMetrics([]), {
    samples: 0, brierScore: null, logLoss: null, ece: null, reliability: [],
  });
});
