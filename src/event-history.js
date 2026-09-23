import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { sortEventFilenames } from './backtest.js';

const EVENT_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+\.jsonl(?:\.gz)?$/;
const MAX_FILES = 50;
const MAX_SAMPLES = 10_000;

export async function loadRecentChainlinkSamples(
  directory,
  { now = Date.now(), historyMs = 20 * 60 * 1_000 } = {},
) {
  let filenames;
  try {
    filenames = sortEventFilenames(
      (await readdir(directory)).filter((filename) => EVENT_FILE_PATTERN.test(filename)),
    ).slice(-MAX_FILES);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const cutoff = now - historyMs;
  const samples = new Map();
  for (const filename of filenames) {
    const file = createReadStream(join(directory, filename));
    const input = filename.endsWith('.gz') ? file.pipe(createGunzip()) : file;
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const sample = event?.payload;
      if (
        event?.source !== 'chainlink' || event?.type !== 'twap' ||
        !Number.isFinite(sample?.value) || sample.value <= 0 ||
        !Number.isSafeInteger(sample?.timestamp) || sample.timestamp < cutoff ||
        ![30, 60].includes(sample?.windowSeconds)
      ) continue;
      samples.set(`${sample.timestamp}:${sample.windowSeconds}`, {
        value: sample.value,
        timestamp: sample.timestamp,
        windowSeconds: sample.windowSeconds,
      });
    }
  }
  return [...samples.values()]
    .sort((left, right) => left.timestamp - right.timestamp || left.windowSeconds - right.windowSeconds)
    .slice(-MAX_SAMPLES);
}
