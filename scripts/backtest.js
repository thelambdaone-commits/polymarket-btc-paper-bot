import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { replayEvents, sortEventFilenames } from '../src/backtest.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const eventDirectory = join(root, 'data', 'events');

async function* eventLines(files) {
  for (const filename of files) {
    const file = createReadStream(join(eventDirectory, filename));
    const input = filename.endsWith('.gz') ? file.pipe(createGunzip()) : file;
    const lines = createInterface({ input });
    for await (const line of lines) {
      if (line.trim()) yield line;
    }
  }
}

const files = sortEventFilenames(
  (await readdir(eventDirectory))
    .filter((filename) => /^\d{4}-\d{2}-\d{2}\.\d+\.jsonl(?:\.gz)?$/.test(filename)),
);
if (files.length === 0) throw new Error('No recorded event files found');
const summary = await replayEvents(eventLines(files));
console.log(JSON.stringify({ files: files.length, ...summary }, null, 2));
