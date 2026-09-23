import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateFractionalKelly, evaluatePaperRisk } from '../src/risk.js';
import { PaperPortfolio } from '../src/paper.js';

test('calculates conservative fractional Kelly sizing with a hard cap', () => {
  const stake = calculateFractionalKelly({
    probability: 0.7, entryPrice: 0.6, bankroll: 100, fraction: 0.25, maximumStake: 5,
  });
  assert.equal(stake, 5);
});

test('returns zero Kelly size when probability has no edge', () => {
  assert.equal(calculateFractionalKelly({
    probability: 0.5, entryPrice: 0.6, bankroll: 100, fraction: 0.25, maximumStake: 5,
  }), 0);
});

test('accounts for taker fees when calculating Kelly size', () => {
  const withoutFee = calculateFractionalKelly({
    probability: 0.7, entryPrice: 0.6, bankroll: 100, fraction: 0.25, maximumStake: 100,
  });
  const withFee = calculateFractionalKelly({
    probability: 0.7, entryPrice: 0.6, bankroll: 100, fraction: 0.25, maximumStake: 100,
    feeRate: 0.07,
  });
  assert.ok(withFee < withoutFee);
});

test('blocks paper trading after the configured daily loss limit', () => {
  const portfolio = new PaperPortfolio(100, 1);
  portfolio.open({ id: 'old', slug: 'old' }, 'UP', 0.5);
  portfolio.settle('old', 'DOWN', Date.now());
  const result = evaluatePaperRisk({
    portfolio,
    market: { id: 'new', slug: 'new' },
    signal: { side: 'UP', entryPrice: 0.55, estimatedProbability: 0.7 },
    config: {
      maxDailyLoss: 0.5, maxConsecutiveLosses: 3, maxOpenExposure: 100,
      maxStake: 10, minimumStake: 0.01, kellyFraction: 0.25,
    },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'daily_loss_limit');
});

test('sizes a valid signal under exposure limits', () => {
  const portfolio = new PaperPortfolio(100, 1);
  const result = evaluatePaperRisk({
    portfolio,
    market: { id: 'new', slug: 'new' },
    signal: { side: 'UP', entryPrice: 0.55, estimatedProbability: 0.7 },
    config: {
      maxDailyLoss: 10, maxConsecutiveLosses: 3, maxOpenExposure: 100,
      maxStake: 10, minimumStake: 0.01, kellyFraction: 0.25,
    },
  });
  assert.equal(result.allowed, true);
  assert.ok(result.stake > 0 && result.stake <= 10);
});
