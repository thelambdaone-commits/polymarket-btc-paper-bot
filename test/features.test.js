import test from 'node:test';
import assert from 'node:assert/strict';

import { extractClobFeatures, extractMarketFeatures } from '../src/features.js';

test('extracts executable book spread, microprice, depth, and imbalance', () => {
  const result = extractClobFeatures({
    upBid: 0.55, upAsk: 0.57, upBidSize: 4, upSize: 6,
    downBid: 0.42, downAsk: 0.44, downBidSize: 6, downSize: 4,
    upAsks: [{ price: 0.57, size: 3 }], downAsks: [{ price: 0.44, size: 2 }],
  });
  assert.equal(result.spread, 0.02);
  assert.equal(result.imbalance, -0.066667);
  assert.equal(result.micropriceUp, 0.558);
});

test('rejects incomplete or crossed books', () => {
  assert.equal(extractClobFeatures({ upBid: 0.6, upAsk: 0.5 }), null);
});

test('combines oracle and market features without inventing missing values', () => {
  const result = extractMarketFeatures({
    oracle: { currentPrice: 101, startPrice: 100, twap60: 100, samples: [100, 101] },
    quote: { upBid: 0.55, upAsk: 0.57, upBidSize: 1, upSize: 1, downBid: 0.42, downAsk: 0.44, downBidSize: 1, downSize: 1 },
    market: { endTime: 200, timeframeMinutes: 5 }, nowSeconds: 150,
  });
  assert.equal(result.oracleMove, 0.01);
  assert.equal(result.secondsRemaining, 50);
  assert.equal(result.timeframeMinutes, 5);
});
