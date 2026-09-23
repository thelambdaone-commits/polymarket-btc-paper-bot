import test from 'node:test';
import assert from 'node:assert/strict';

import { PaperPortfolio } from '../src/paper.js';

const market = { id: 'btc-5m-1', slug: 'btc-updown-5m-1' };

test('settles a winning paper position and reports win rate', () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open(market, 'UP', 0.5);

  const result = portfolio.settle(market.id, 'UP');

  assert.equal(result.pnl, 10);
  assert.deepEqual(portfolio.stats(), {
    balance: 110,
    committedCapital: 0,
    openPositions: 0,
    wins: 1,
    losses: 0,
    winRate: 1,
    predictions: 1,
    settledPredictions: 1,
    realizedPnl: 10,
    roi: 1,
    averagePnl: 10,
    profitFactor: null,
    recentForm: ['W'],
    timeframeBreakdown: [
      { timeframeMinutes: null, settled: 1, wins: 1, losses: 0, winRate: 1, realizedPnl: 10 },
    ],
    arbitrageOpportunities: 0,
  });
});

test('reports exposure, recent form, profit factor, and performance by timeframe', () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open({ id: 'five-win', slug: 'five-win', timeframeMinutes: 5 }, 'UP', 0.5);
  portfolio.settle('five-win', 'UP', 100);
  portfolio.open({ id: 'five-loss', slug: 'five-loss', timeframeMinutes: 5 }, 'DOWN', 0.5);
  portfolio.settle('five-loss', 'UP', 200);
  portfolio.open({ id: 'fifteen-open', slug: 'fifteen-open', timeframeMinutes: 15 }, 'UP', 0.5);

  const stats = portfolio.stats();

  assert.equal(stats.committedCapital, 10);
  assert.equal(stats.averagePnl, 0);
  assert.equal(stats.profitFactor, 1);
  assert.deepEqual(stats.recentForm, ['W', 'L']);
  assert.deepEqual(stats.timeframeBreakdown, [
    { timeframeMinutes: 5, settled: 2, wins: 1, losses: 1, winRate: 0.5, realizedPnl: 0 },
  ]);
});

test('settles a losing position without paying out', () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open(market, 'DOWN', 0.5);

  const result = portfolio.settle(market.id, 'UP');

  assert.equal(result.pnl, -10);
  assert.equal(portfolio.stats().balance, 90);
  assert.equal(portfolio.stats().losses, 1);
});

test('deducts taker fees and uses the executable ask for paper PnL', () => {
  const portfolio = new PaperPortfolio(100, 10);
  const position = portfolio.open(market, 'UP', 0.5, 0.07);

  assert.equal(position.fee, 0.35);
  assert.equal(portfolio.stats().balance, 89.65);
  assert.equal(portfolio.settle(market.id, 'UP').pnl, 9.65);
  assert.equal(portfolio.stats().balance, 109.65);
});

test('restores portfolio state across process restarts', () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open(market, 'UP', 0.6, 0.07);

  const restored = PaperPortfolio.restore(portfolio.snapshot());

  assert.deepEqual(restored.snapshot(), portfolio.snapshot());
});

test('keeps an auditable prediction record from signal through official settlement', () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open(market, 'UP', 0.6, 0.07, {
    createdAt: 123,
    timeframeMinutes: 5,
    estimatedProbability: 0.7,
    netEdge: 0.03,
  });
  portfolio.settle(market.id, 'DOWN', 456);

  assert.deepEqual(portfolio.history()[0], {
    marketId: market.id,
    slug: market.slug,
    side: 'UP',
    timeframeMinutes: 5,
    createdAt: 123,
    entryPrice: 0.6,
    estimatedProbability: 0.7,
    netEdge: 0.03,
    stake: 10,
    fee: 0.28,
    status: 'SETTLED',
    settledAt: 456,
    winningSide: 'DOWN',
    pnl: -10.28,
  });
});

test('records the strategy selected for the market regime', () => {
  const portfolio = new PaperPortfolio(20, 1);
  portfolio.open(market, 'UP', 0.6, 0.07, {
    timeframeMinutes: 5,
    estimatedProbability: 0.7,
    netEdge: 0.03,
    strategy: 'mean_reversion',
    regime: 'choppy',
  });

  assert.equal(portfolio.history()[0].strategy, 'mean_reversion');
  assert.equal(portfolio.history()[0].regime, 'choppy');
});

test('uses a validated multi-level paper fill instead of inventing top-level liquidity', () => {
  const portfolio = new PaperPortfolio(20, 1);
  const position = portfolio.open(
    { id: 'multi-level', slug: 'btc-updown-5m-1', endTime: 300, timeframeMinutes: 5 },
    'UP',
    0.545455,
    0.07,
    {
      fill: {
        shares: 1.83333333,
        averagePrice: 0.545455,
        fee: 0.0315,
        totalCost: 1.0315,
        levelsConsumed: 2,
      },
    },
  );

  assert.equal(position.shares, 1.83333333);
  assert.equal(position.fee, 0.0315);
  assert.equal(position.totalCost, 1.0315);
});
