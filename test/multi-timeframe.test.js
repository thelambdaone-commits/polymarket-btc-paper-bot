import test from 'node:test';
import assert from 'node:assert/strict';

import { alignMultiTimeframe } from '../src/multi-timeframe.js';

test('allows aligned 1h, 15m and 5m directions with a size multiplier', () => {
  const result = alignMultiTimeframe({ hourly: { side: 'UP' }, fifteenMinute: { side: 'UP' }, entry: { side: 'UP' } });
  assert.equal(result.allowed, true);
  assert.equal(result.multiplier, 1.5);
});

test('blocks a conflicting higher timeframe bias', () => {
  const result = alignMultiTimeframe({ hourly: { side: 'DOWN' }, entry: { side: 'UP' } });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'hourly_bias_conflict');
});
