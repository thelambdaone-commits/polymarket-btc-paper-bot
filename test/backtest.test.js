import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRecordedEvent, replayEvents, sortEventFilenames } from '../src/backtest.js';

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    sequence: 1,
    receivedAt: 1_000,
    source: 'chainlink',
    type: 'twap',
    sourceTimestamp: 990,
    payload: { value: 65_000 },
    ...overrides,
  };
}

test('replays recorded events chronologically and summarizes decisions', async () => {
  const seen = [];
  const summary = await replayEvents([
    event(),
    event({
      sequence: 2,
      receivedAt: 1_100,
      source: 'decision',
      type: 'evaluation',
      payload: { signal: { side: 'HOLD', reason: 'no_regime_edge' } },
    }),
    event({
      sequence: 3,
      receivedAt: 1_200,
      source: 'decision',
      type: 'evaluation',
      payload: { signal: { side: 'UP', strategy: 'trend_following' } },
    }),
  ], { onEvent: (item) => seen.push(item.receivedAt) });

  assert.deepEqual(seen, [1_000, 1_100, 1_200]);
  assert.deepEqual(summary, {
    events: 3,
    firstReceivedAt: 1_000,
    lastReceivedAt: 1_200,
    sources: { chainlink: 1, decision: 2 },
    decisions: 2,
    holds: 1,
    actionable: 1,
    settlements: 0,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
  });
});

test('reconstructs settled paper performance from replayed settlement events', async () => {
  const summary = await replayEvents([
    event({
      source: 'decision',
      type: 'settlement',
      payload: { side: 'UP', winningSide: 'UP', pnl: 0.5 },
    }),
    event({
      sequence: 2,
      receivedAt: 1_100,
      source: 'decision',
      type: 'settlement',
      payload: { side: 'DOWN', winningSide: 'UP', pnl: -1.03 },
    }),
  ]);

  assert.equal(summary.settlements, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.realizedPnl, -0.53);
});

test('rejects malformed, oversized, or time-travelling replay data', async () => {
  assert.throws(() => parseRecordedEvent('{"schemaVersion":2}'), /schema/);
  assert.throws(() => parseRecordedEvent('x'.repeat(1_000_001)), /too large/);
  await assert.rejects(
    () => replayEvents([event({ receivedAt: 2_000 }), event({ sequence: 2, receivedAt: 1_999 })]),
    /chronological/,
  );
});

test('sorts rotated event files by date and numeric rotation index', () => {
  assert.deepEqual(sortEventFilenames([
    '2026-08-24.10.jsonl.gz',
    '2026-08-25.0.jsonl',
    '2026-08-24.2.jsonl.gz',
    '2026-08-24.1.jsonl.gz',
  ]), [
    '2026-08-24.1.jsonl.gz',
    '2026-08-24.2.jsonl.gz',
    '2026-08-24.10.jsonl.gz',
    '2026-08-25.0.jsonl',
  ]);
});
