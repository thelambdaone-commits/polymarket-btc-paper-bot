import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMetricsReport } from '../src/metrics.js';

test('builds drawdown, risk-adjusted and calibration reports', () => {
  const report = buildMetricsReport({
    initialBalance: 100,
    history: [
      { status: 'SETTLED', side: 'UP', winningSide: 'UP', pnl: 5, stake: 10, fee: 1, estimatedProbability: 0.7, timeframeMinutes: 5, regime: 'trending', strategy: 'trend_following' },
      { status: 'SETTLED', side: 'UP', winningSide: 'DOWN', pnl: -8, stake: 10, fee: 1, estimatedProbability: 0.7, timeframeMinutes: 5, regime: 'ranging', strategy: 'trend_following' },
    ],
  });
  assert.equal(report.samples, 2);
  assert.equal(report.realizedPnl, -3);
  assert.equal(report.maxDrawdown, 8);
  assert.equal(report.calibration.samples, 2);
  assert.equal(report.byTimeframe[0].group, 5);
  assert.equal(report.byRegime.length, 2);
});

test('does not invent risk metrics without enough returns', () => {
  assert.equal(buildMetricsReport({ initialBalance: 100 }).sharpePerTrade, null);
});
