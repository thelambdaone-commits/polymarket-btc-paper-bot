import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildMetricsReport } from '../src/metrics.js';

const statePath = fileURLToPath(new URL('../data/paper-state.json', import.meta.url));
const outputPath = fileURLToPath(new URL('../data/metrics.json', import.meta.url));
const state = JSON.parse(await readFile(statePath, 'utf8'));
const report = buildMetricsReport({ history: state.history, initialBalance: state.initialBalance });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output: outputPath, ...report }, null, 2));
