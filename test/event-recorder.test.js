import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createIntervalSampler, RawEventRecorder } from '../src/event-recorder.js';

test('bounds high-frequency event recording regardless of changing payload keys', () => {
  let now = 1_000;
  const shouldRecord = createIntervalSampler(100, () => now);

  assert.equal(shouldRecord(), true);
  now = 1_050;
  assert.equal(shouldRecord(), false);
  now = 1_100;
  assert.equal(shouldRecord(), true);
});

test('records versioned append-only events with source and receipt timestamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-events-'));
  const recorder = new RawEventRecorder({ directory, now: () => 1_700_000_000_123 });

  await recorder.record('clob', 'book', { assetId: 'token-1', bids: [['0.5', '2']] }, 1_700_000_000_000);
  await recorder.record('chainlink', 'twap', { value: 65_000, windowSeconds: 30 }, 1_700_000_000_100);
  await recorder.flush();

  const [filename] = await readdir(directory);
  const records = (await readFile(join(directory, filename), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(({ schemaVersion, sequence, source, type }) => ({
    schemaVersion,
    sequence,
    source,
    type,
  })), [
    { schemaVersion: 1, sequence: 1, source: 'clob', type: 'book' },
    { schemaVersion: 1, sequence: 2, source: 'chainlink', type: 'twap' },
  ]);
  assert.equal(records[0].receivedAt, 1_700_000_000_123);
  assert.equal(records[0].sourceTimestamp, 1_700_000_000_000);
});

test('rotates files at the configured bound and rejects untrusted event shapes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-events-'));
  const recorder = new RawEventRecorder({
    directory,
    now: () => 1_700_000_000_123,
    maxFileBytes: 220,
  });

  await recorder.record('clob', 'book', { value: 'a'.repeat(40) });
  await recorder.record('clob', 'book', { value: 'b'.repeat(40) });
  await recorder.flush();

  const files = await readdir(directory);
  assert.equal(files.length, 2);
  assert.equal(files.some((filename) => filename.endsWith('.jsonl.gz')), true);
  await assert.rejects(() => recorder.record('../secret', 'book', {}), /Invalid event source/);
  await assert.rejects(() => recorder.record('clob', 'book', { value: 'x'.repeat(1_100_000) }), /too large/);
});
