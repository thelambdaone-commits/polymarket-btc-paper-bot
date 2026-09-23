import test from 'node:test';
import assert from 'node:assert/strict';

import { PaperPortfolio } from '../src/paper.js';
import { reconcileDuePositions } from '../src/settlement.js';

test('settles every resolvable position when another resolution request fails', async () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open({ id: 'broken', slug: 'btc-updown-5m-100', endTime: 400 }, 'UP', 0.5);
  portfolio.open({ id: 'resolved', slug: 'btc-updown-5m-200', endTime: 500 }, 'DOWN', 0.5);
  const settled = [];
  const errors = [];

  await reconcileDuePositions({
    portfolio,
    nowSeconds: 600,
    fetchResolution: async (slug) => {
      if (slug.endsWith('-100')) throw new Error('temporary API failure');
      return 'DOWN';
    },
    onSettled: async (result) => settled.push(result.marketId),
    onError: (error, position) => errors.push([position.marketId, error.message]),
  });

  assert.deepEqual(settled, ['resolved']);
  assert.deepEqual(errors, [['broken', 'temporary API failure']]);
  assert.deepEqual(portfolio.openPositions().map(({ marketId }) => marketId), ['broken']);
});

test('waits for the grace period and for an official resolution', async () => {
  const portfolio = new PaperPortfolio(100, 10);
  portfolio.open({ id: 'recent', slug: 'btc-updown-5m-300', endTime: 590 }, 'UP', 0.5);
  portfolio.open({ id: 'pending', slug: 'btc-updown-5m-400', endTime: 500 }, 'UP', 0.5);
  const requested = [];

  await reconcileDuePositions({
    portfolio,
    nowSeconds: 600,
    fetchResolution: async (slug) => {
      requested.push(slug);
      return null;
    },
  });

  assert.deepEqual(requested, ['btc-updown-5m-400']);
  assert.equal(portfolio.stats().openPositions, 2);
});
