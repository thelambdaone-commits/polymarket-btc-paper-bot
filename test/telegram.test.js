import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSignal,
  formatSettlement,
  formatStatus,
  parseTelegramConfig,
  pollTelegramWithRetry,
  routeCommand,
} from '../src/telegram.js';

test('requires both Telegram token and numeric admin id when Telegram is enabled', () => {
  assert.equal(parseTelegramConfig({}), null);
  assert.throws(
    () => parseTelegramConfig({ TELEGRAM_BOT_TOKEN: '123:abc' }),
    /TELEGRAM_ADMIN_ID/,
  );
  assert.throws(
    () => parseTelegramConfig({ TELEGRAM_BOT_TOKEN: 'bad', TELEGRAM_ADMIN_ID: '42' }),
    /TELEGRAM_BOT_TOKEN/,
  );
});

test('accepts only the configured admin and allowlisted commands', () => {
  assert.deepEqual(routeCommand({ chatId: 42, text: '/status' }, 42), { type: 'status' });
  assert.deepEqual(routeCommand({ chatId: 7, text: '/status' }, 42), { type: 'ignore' });
  assert.deepEqual(routeCommand({ chatId: 42, text: '/unknown' }, 42), { type: 'help' });
});

test('formats a readable French paper dashboard without inventing performance', () => {
  const message = formatStatus({
    balance: 990,
    committedCapital: 10,
    openPositions: 1,
    wins: 0,
    losses: 0,
    winRate: null,
    predictions: 1,
    settledPredictions: 0,
    realizedPnl: 0,
    roi: null,
    averagePnl: null,
    profitFactor: null,
    recentForm: [],
    timeframeBreakdown: [],
    arbitrageOpportunities: 0,
  });

  assert.match(message, /PAPER PREDICTION BOT/);
  assert.match(message, /Cash disponible\s+990,00 \$/);
  assert.match(message, /Capital engagé\s+10,00 \$/);
  assert.match(message, /Taux de réussite\s+—/);
  assert.doesNotMatch(message, /Échantillon/);
  assert.doesNotMatch(message, /Résultats paper/);
  assert.doesNotMatch(message, /Aucun gain n’est garanti/);
});

test('shows settled performance by timeframe and recent form', () => {
  const message = formatStatus({
    balance: 1001.36,
    committedCapital: 30,
    openPositions: 3,
    wins: 5,
    losses: 2,
    winRate: 5 / 7,
    predictions: 10,
    settledPredictions: 7,
    realizedPnl: 31.86,
    roi: 0.455,
    averagePnl: 4.55,
    profitFactor: 2.4,
    recentForm: ['W', 'W', 'L', 'W', 'W'],
    timeframeBreakdown: [
      { timeframeMinutes: 5, settled: 4, wins: 3, losses: 1, winRate: 0.75, realizedPnl: 20 },
      { timeframeMinutes: 15, settled: 3, wins: 2, losses: 1, winRate: 2 / 3, realizedPnl: 11.86 },
    ],
    arbitrageOpportunities: 0,
  });

  assert.match(message, /5 min\s+3V · 1D · 75,0 % · \+20,00 \$/);
  assert.match(message, /15 min\s+2V · 1D · 66,7 % · \+11,86 \$/);
  assert.match(message, /Forme récente\s+✅ ✅ ❌ ✅ ✅/);
  assert.doesNotMatch(message, /Échantillon/);
  assert.doesNotMatch(message, /Résultats paper/);
  assert.doesNotMatch(message, /Aucun gain n’est garanti/);
});

test('formats settled predictions with outcome and signed PnL', () => {
  const winningMessage = formatSettlement({
    side: 'UP',
    winningSide: 'UP',
    slug: 'btc-up-or-down',
    pnl: 9.42,
  });
  assert.match(winningMessage, /✅ PRÉDICTION GAGNÉE/);
  assert.doesNotMatch(winningMessage, /performances passées/);
  assert.match(formatSettlement({
    side: 'DOWN',
    winningSide: 'UP',
    slug: 'btc-up-or-down',
    pnl: -10.28,
  }), /P&L réalisé\s+-10,28 \$/);
});

test('shows the market-selected strategy behind a paper prediction', () => {
  const message = formatSignal(
    { side: 'UP', slug: 'btc-updown-5m-1', entryPrice: 0.6, stake: 1 },
    {
      adjustedProbability: 0.68,
      netEdge: 0.05,
      cohortSamples: 10,
      strategy: 'mean_reversion',
      regime: 'choppy',
    },
  );

  assert.match(message, /Stratégie\s+mean reversion/);
  assert.match(message, /Régime\s+choppy/);
  assert.doesNotMatch(message, /promesse de gain/);
});

test('retries Telegram polling without stopping the trading engine', async () => {
  const abort = new AbortController();
  const errors = [];
  let attempts = 0;
  const client = {
    async poll() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary 502');
      abort.abort();
    },
  };

  await pollTelegramWithRetry(client, {
    getStats: () => ({}),
    signal: abort.signal,
    retryDelayMs: 0,
    onError: (error) => errors.push(error.message),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(errors, ['temporary 502']);
});
