import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRecentChainlinkSamples } from '../src/event-history.js';

test('loads and deduplicates recent Chainlink samples from event recordings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-event-history-'));
  const lines = [
    { source: 'chainlink', type: 'twap', payload: { value: 79_000, timestamp: 1_000, windowSeconds: 30 } },
    { source: 'clob', type: 'book', payload: {}, sourceTimestamp: 2_000 },
    { source: 'chainlink', type: 'twap', payload: { value: 79_010, timestamp: 10_000, windowSeconds: 30 } },
    { source: 'chainlink', type: 'twap', payload: { value: 79_010, timestamp: 10_000, windowSeconds: 30 } },
    { source: 'chainlink', type: 'twap', payload: { value: 79_005, timestamp: 10_000, windowSeconds: 60 } },
  ];
  await writeFile(join(directory, '2026-08-24.0.jsonl'), `${lines.map(JSON.stringify).join('\n')}\n`);

  const samples = await loadRecentChainlinkSamples(directory, { now: 20_000, historyMs: 15_000 });

  assert.deepEqual(samples, [
    { value: 79_010, timestamp: 10_000, windowSeconds: 30 },
    { value: 79_005, timestamp: 10_000, windowSeconds: 60 },
  ]);
});
