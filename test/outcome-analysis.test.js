import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyOfficialSettlements,
  deriveMarketOutcome,
  resolveTradeOutcomes,
  scoreCalibration,
  selectFirstActionablePerMarket,
  simulateFixedStakeTrades,
  summarizeMomentumPersistence,
} from '../src/outcome-analysis.js';

const MINUTE = 60_000;

function sample(value, timestamp) {
  return { value, timestamp, windowSeconds: 30 };
}

const market = { id: 'm1', slug: 'btc-updown-5m-1', timeframeMinutes: 5, startTime: 1_000, endTime: 1_000 + 300 };

test('deriveMarketOutcome resolves UP when the close is above the open', () => {
  const samples = [sample(100, market.startTime * 1_000), sample(101, (market.endTime - 1) * 1_000)];
  const resolution = deriveMarketOutcome(samples, market);
  assert.equal(resolution.outcome, 'UP');
  assert.equal(resolution.openValue, 100);
  assert.equal(resolution.closeValue, 101);
});

test('deriveMarketOutcome resolves DOWN when the close is below the open', () => {
  const samples = [sample(100, market.startTime * 1_000), sample(99, (market.endTime - 1) * 1_000)];
  assert.equal(deriveMarketOutcome(samples, market).outcome, 'DOWN');
});

test('deriveMarketOutcome returns null on an exact tie or insufficient references', () => {
  const tie = [sample(100, market.startTime * 1_000), sample(100, (market.endTime - 1) * 1_000)];
  assert.equal(deriveMarketOutcome(tie, market), null);
  assert.equal(deriveMarketOutcome([sample(100, market.startTime * 1_000)], market), null);
  assert.equal(deriveMarketOutcome([], market), null);
});

test('deriveMarketOutcome rejects a close printed long before the end time', () => {
  const samples = [sample(100, market.startTime * 1_000), sample(101, (market.startTime + 30) * 1_000)];
  assert.equal(deriveMarketOutcome(samples, market), null);
});

test('deriveMarketOutcome tolerates a start reference within the default window', () => {
  const samples = [
    sample(99.9, market.startTime * 1_000 - 1_500),
    sample(100.1, market.startTime * 1_000 + 4_500),
    sample(102, (market.endTime - 1) * 1_000),
  ];
  const resolution = deriveMarketOutcome(samples, market);
  assert.equal(resolution.outcome, 'UP');
  assert.equal(resolution.openValue, 99.9);
});

test('deriveMarketOutcome rejects invalid markets and malformed samples', () => {
  assert.equal(deriveMarketOutcome([sample(1, 1)], null), null);
  assert.equal(deriveMarketOutcome([sample(1, 1)], { startTime: 200, endTime: 100 }), null);
  assert.equal(
    deriveMarketOutcome([{ value: Number.NaN, timestamp: 1 }], market),
    null,
  );
});

function evaluation(receivedAt, marketId, side, extras = {}) {
  return {
    receivedAt,
    payload: {
      market: { id: marketId, slug: `btc-updown-5m-${marketId}`, timeframeMinutes: 5, startTime: 0, endTime: 1 },
      signal: { side, entryPrice: 0.6, estimatedProbability: 0.62, netEdge: 0.01, strategy: 'trend_following', regime: 'directional', ...extras },
    },
  };
}

test('selectFirstActionablePerMarket keeps the earliest actionable evaluation per market', () => {
  const trades = selectFirstActionablePerMarket([
    evaluation(3, 'a', 'HOLD'),
    evaluation(5, 'b', 'DOWN'),
    evaluation(7, 'a', 'UP'),
    evaluation(9, 'b', 'UP'),
    evaluation(11, 'c', 'HOLD'),
    evaluation(13, 'd', 'UP'),
  ]);
  assert.deepEqual(trades.map((trade) => trade.market.id), ['b', 'a', 'd']);
  assert.deepEqual(trades.map((trade) => trade.signal.side), ['DOWN', 'UP', 'UP']);
});

test('resolveTradeOutcomes attaches Chainlink-derived resolutions to trades', () => {
  const samples = [sample(50, 0), sample(51, 290_000)];
  const window = { id: 'w', startTime: 0, endTime: 300 };
  const trades = resolveTradeOutcomes(
    [{ market: window, signal: { side: 'UP' } }],
    samples,
  );
  assert.equal(trades[0].resolution.outcome, 'UP');
  assert.equal(trades[0].resolution.source, 'chainlink_twap_derived');
});

test('applyOfficialSettlements overrides derived labels with official winners', () => {
  const trades = [
    {
      market: { id: 'w1', startTime: 0, endTime: 300 },
      signal: { side: 'UP' },
      resolution: { outcome: 'DOWN', source: 'chainlink_twap_derived' },
    },
    {
      market: { id: 'w2', startTime: 0, endTime: 300 },
      signal: { side: 'UP' },
      resolution: null,
    },
    {
      market: { id: 'w3', startTime: 0, endTime: 300 },
      signal: { side: 'UP' },
      resolution: { outcome: 'UP', source: 'chainlink_twap_derived' },
    },
  ];
  const merged = applyOfficialSettlements(trades, [
    { marketId: 'w1', winningSide: 'UP' },
    { marketId: 'w2', winningSide: 'DOWN' },
    { marketId: 'missing', winningSide: 'UP' },
    { marketId: 'w3', winningSide: 'bogus' },
  ]);
  assert.equal(merged[0].resolution.outcome, 'UP');
  assert.equal(merged[0].resolution.source, 'official');
  assert.equal(merged[1].resolution.outcome, 'DOWN');
  assert.equal(merged[1].resolution.source, 'official');
  assert.equal(merged[2].resolution.outcome, 'UP');
  assert.equal(merged[2].resolution.source, 'chainlink_twap_derived');
});

test('applyOfficialSettlements tolerates empty or malformed settlements', () => {
  const trades = [{ market: { id: 'w1' }, signal: {}, resolution: { outcome: 'UP' } }];
  assert.deepEqual(applyOfficialSettlements(trades, []), trades);
  assert.deepEqual(applyOfficialSettlements(trades, [null, { winningSide: 'UP' }]), trades);
});

test('scoreCalibration computes Brier, log loss and reliability bins exactly', () => {
  const trades = [
    { signal: { side: 'UP', estimatedProbability: 0.6 }, resolution: { outcome: 'UP' } },
    { signal: { side: 'DOWN', estimatedProbability: 0.7 }, resolution: { outcome: 'UP' } },
  ];
  const report = scoreCalibration(trades);
  assert.equal(report.scored, 2);
  assert.equal(report.wins, 1);
  assert.equal(report.winRate, 0.5);
  assert.ok(Math.abs(report.brier - ((0.4 ** 2 + 0.7 ** 2) / 2)) < 1e-12);
  const expectedLogLoss = -(Math.log(0.6) + Math.log(1 - 0.7)) / 2;
  assert.ok(Math.abs(report.logLoss - expectedLogLoss) < 1e-12);
  const firstBin = report.bins.find((bin) => bin.range === '0.55-0.60');
  const secondBin = report.bins.find((bin) => bin.range === '0.65-0.70');
  assert.equal(firstBin.count, 1);
  assert.equal(firstBin.hits, 1);
  assert.equal(secondBin.count, 1);
  assert.equal(secondBin.hits, 0);
});

test('scoreCalibration ignores unscoreable trades and empty inputs', () => {
  assert.equal(scoreCalibration([]).brier, null);
  const report = scoreCalibration([
    { signal: { side: 'UP', estimatedProbability: 0.6 }, resolution: { outcome: null } },
    { signal: { side: 'UP', estimatedProbability: 0.49 }, resolution: { outcome: 'UP' } },
    { signal: { side: 'UP' }, resolution: { outcome: 'UP' } },
  ]);
  assert.equal(report.scored, 0);
  assert.equal(report.winRate, null);
});

test('simulateFixedStakeTrades reproduces the paper portfolio money math', () => {
  const trades = [
    { market: { id: 'w1' }, signal: { side: 'UP', entryPrice: 0.64 }, resolution: { outcome: 'UP' } },
    { market: { id: 'w2' }, signal: { side: 'DOWN', entryPrice: 0.64 }, resolution: { outcome: 'UP' } },
  ];
  const simulation = simulateFixedStakeTrades(trades, { stake: 1, feeRate: 0.07 });
  const shares = 1 / 0.64;
  const fee = shares * 0.07 * 0.64 * 0.36;
  assert.equal(simulation.trades, 2);
  assert.equal(simulation.wins, 1);
  assert.equal(simulation.losses, 1);
  assert.ok(Math.abs(simulation.realizedPnl - (shares - (1 + fee) - (1 + fee))) < 1e-9);
  assert.ok(Math.abs(simulation.roi - simulation.realizedPnl / (2 * (1 + fee))) < 1e-12);
  assert.equal(simulation.detail[0].won, true);
  assert.equal(simulation.detail[1].won, false);
});

test('simulateFixedStakeTrades skips unresolvable and invalid entries', () => {
  const simulation = simulateFixedStakeTrades([
    { market: { id: 'w1' }, signal: { side: 'UP', entryPrice: 0.64 }, resolution: null },
    { market: { id: 'w2' }, signal: { side: 'UP', entryPrice: 1 }, resolution: { outcome: 'UP' } },
    { market: { id: 'w3' }, signal: { side: 'UP' }, resolution: { outcome: 'UP' } },
  ]);
  assert.equal(simulation.trades, 0);
  assert.equal(simulation.realizedPnl, 0);
  assert.equal(simulation.roi, null);
});

test('summarizeMomentumPersistence counts early-move continuation versus reversal', () => {
  const windows = [];
  const samples = [];
  let start = 0;
  for (let index = 0; index < 4; index += 1) {
    const endTime = start + 600;
    windows.push({ id: `w${index}`, startTime: start, endTime });
    const base = 100 + index * 10;
    samples.push(sample(base, start * 1_000));
    samples.push(sample(index % 2 === 0 ? base + 1 : base - 1, (start + 300) * 1_000));
    samples.push(sample(index % 2 === 0 ? base + 2 : base - 2, (endTime - 5) * 1_000));
    start = endTime;
  }
  const summary = summarizeMomentumPersistence(samples, windows);
  assert.equal(summary.windows, 4);
  assert.equal(summary.unresolvable, 0);
  // Window closes reuse the next window's opening print when it sits exactly on the boundary,
  // so the odd windows inherit an upward close while their early move points down.
  assert.equal(summary.UP_then_UP, 2);
  assert.equal(summary.DOWN_then_DOWN, 1);
  assert.equal(summary.DOWN_then_UP, 1);
  assert.equal(summary.persistence, 0.75);
});

test('summarizeMomentumPersistence handles empty inputs without crashing', () => {
  const summary = summarizeMomentumPersistence([], []);
  assert.equal(summary.persistence, null);
  assert.equal(summary.windows, 0);
});
