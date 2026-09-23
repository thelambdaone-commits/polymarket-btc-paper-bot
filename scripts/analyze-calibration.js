import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { parseRecordedEvent, sortEventFilenames } from '../src/backtest.js';
import {
  applyOfficialSettlements,
  resolveTradeOutcomes,
  scoreCalibration,
  selectFirstActionablePerMarket,
  simulateFixedStakeTrades,
  summarizeMomentumPersistence,
} from '../src/outcome-analysis.js';

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

function groupScore(trades, keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade) ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, group]) => [key, {
        ...scoreCalibration(group),
        simulation: (({ detail, ...summary }) => summary)(simulateFixedStakeTrades(group)),
      }]),
  );
}

const files = sortEventFilenames(
  (await readdir(eventDirectory))
    .filter((filename) => /^\d{4}-\d{2}-\d{2}\.\d+\.jsonl(?:\.gz)?$/.test(filename)),
);
if (files.length === 0) throw new Error('No recorded event files found');

const samples = new Map();
const markets = new Map();
const evaluations = [];
const settlements = [];
let events = 0;
let malformedEvents = 0;

for await (const line of eventLines(files)) {
  let event;
  try {
    event = parseRecordedEvent(line);
  } catch {
    malformedEvents += 1;
    continue;
  }
  events += 1;
  if (event.source === 'chainlink' && event.type === 'twap' && event.payload?.windowSeconds === 30) {
    samples.set(`${event.payload.timestamp}:30`, {
      value: Number(event.payload.value),
      timestamp: event.payload.timestamp,
      windowSeconds: 30,
    });
  }
  if (event.source === 'decision' && event.type === 'evaluation') {
    const market = event.payload?.market;
    if (market?.id) markets.set(market.id, market);
    evaluations.push(event);
  }
  if (event.source === 'decision' && event.type === 'settlement') settlements.push(event.payload);
}

const chainlinkSamples = [...samples.values()].sort((left, right) => left.timestamp - right.timestamp);
const derivedTrades = resolveTradeOutcomes(
  selectFirstActionablePerMarket(evaluations),
  chainlinkSamples,
);
const trades = applyOfficialSettlements(derivedTrades, settlements);
const resolvable = trades.filter((trade) => trade.resolution);
const officialLabels = resolvable.filter((trade) => trade.resolution.source === 'official');
const officialTrades = officialLabels;
const derivedTradesOnly = resolvable.filter((trade) => trade.resolution.source !== 'official');
const report = {
  files: files.length,
  events,
  malformedEvents,
  chainlinkSamples: chainlinkSamples.length,
  distinctMarkets: markets.size,
  actionableSignals: trades.length,
  resolvableSignals: resolvable.length,
  unresolvableSignals: trades.length - resolvable.length,
  officialLabels: officialLabels.length,
  overall: {
    ...scoreCalibration(officialTrades),
    simulation: (({ detail, ...summary }) => summary)(simulateFixedStakeTrades(officialTrades)),
  },
  derivedProxy: {
    ...scoreCalibration(derivedTradesOnly),
    simulation: (({ detail, ...summary }) => summary)(simulateFixedStakeTrades(derivedTradesOnly)),
  },
  byStrategy: groupScore(officialTrades, (trade) => trade.signal?.strategy),
  byRegime: groupScore(officialTrades, (trade) => trade.signal?.regime),
  byTimeframeMinutes: groupScore(officialTrades, (trade) => trade.market?.timeframeMinutes),
  momentumPersistence: summarizeMomentumPersistence(chainlinkSamples, [...markets.values()]),
};

console.log(JSON.stringify(report, null, 2));
