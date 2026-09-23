import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchExecutableQuotes,
  normalizeBtcMarkets,
  normalizeOrderBooks,
  normalizeResolution,
} from '../src/markets.js';

test('keeps active BTC up/down markets in the requested timeframes', () => {
  const markets = normalizeBtcMarkets([
    {
      id: '1',
      question: 'Bitcoin Up or Down - 5 Minutes',
      slug: 'btc-updown-5m-123',
      active: true,
      closed: false,
      outcomes: '["Up", "Down"]',
      outcomePrices: '["0.52", "0.48"]',
      clobTokenIds: '["up-token", "down-token"]',
    },
    { id: '2', question: 'Bitcoin above $100k?', slug: 'btc-price', active: true },
  ]);

  assert.deepEqual(markets, [
    {
      id: '1',
      slug: 'btc-updown-5m-123',
      timeframeMinutes: 5,
      startTime: 123,
      endTime: 423,
      upTokenId: 'up-token',
      downTokenId: 'down-token',
      upPrice: 0.52,
    },
  ]);
});

test('accepts only an officially closed binary resolution', () => {
  assert.equal(normalizeResolution({ closed: false, outcomes: '["Up","Down"]', outcomePrices: '["1","0"]' }), null);
  assert.equal(normalizeResolution({ closed: true, outcomes: '["Up","Down"]', outcomePrices: '["1","0"]' }), 'UP');
  assert.equal(normalizeResolution({ closed: true, outcomes: '["Up","Down"]', outcomePrices: '["0","1"]' }), 'DOWN');
});

test('drops malformed external market records', () => {
  assert.deepEqual(normalizeBtcMarkets([null, {}, { slug: 'btc-updown-5m-x' }]), []);
});

test('preserves validated market fee and execution metadata', () => {
  const [market] = normalizeBtcMarkets([{
    id: 'fee-market',
    question: 'Bitcoin Up or Down - 5 Minutes',
    slug: 'btc-updown-5m-123',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    feeSchedule: { rate: '0.07' },
    orderPriceMinTickSize: '0.001',
    orderMinSize: '5',
    outcomes: '["Up", "Down"]',
    outcomePrices: '["0.52", "0.48"]',
    clobTokenIds: '["up-token", "down-token"]',
  }]);

  assert.equal(market.feeRate, 0.07);
  assert.equal(market.tickSize, 0.001);
  assert.equal(market.minimumOrderSize, 5);
});

test('sets a zero fee for explicitly fee-free markets', () => {
  const [market] = normalizeBtcMarkets([{
    id: 'free-market',
    question: 'Bitcoin Up or Down - 5 Minutes',
    slug: 'btc-updown-5m-123',
    active: true,
    closed: false,
    feesEnabled: false,
    outcomes: '["Up", "Down"]',
    outcomePrices: '["0.52", "0.48"]',
    clobTokenIds: '["up-token", "down-token"]',
  }]);

  assert.equal(market.feeRate, 0);
});

test('normalizes executable best asks and available sizes for both outcomes', () => {
  const quote = normalizeOrderBooks([
    {
      asset_id: 'up',
      bids: [{ price: '0.44', size: '8' }],
      asks: [{ price: '0.46', size: '20' }],
    },
    {
      asset_id: 'down',
      bids: [{ price: '0.45', size: '15' }],
      asks: [{ price: '0.47', size: '12' }],
    },
  ], { upTokenId: 'up', downTokenId: 'down' });

  assert.deepEqual(quote, {
    upBid: 0.44,
    upBidSize: 8,
    upAsk: 0.46,
    upSize: 20,
    downBid: 0.45,
    downBidSize: 15,
    downAsk: 0.47,
    downSize: 12,
    upAsks: [{ price: 0.46, size: 20 }],
    downAsks: [{ price: 0.47, size: 12 }],
    midpointUp: 0.495,
  });
});

test('rejects incomplete or malformed order books', () => {
  assert.equal(normalizeOrderBooks([], { upTokenId: 'up', downTokenId: 'down' }), null);
});

test('keeps valid quotes when another market has an incomplete order book', async () => {
  const markets = [
    { id: 'valid', upTokenId: 'valid-up', downTokenId: 'valid-down' },
    { id: 'empty', upTokenId: 'empty-up', downTokenId: 'empty-down' },
  ];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      {
        asset_id: 'valid-up',
        bids: [{ price: '0.53', size: '9' }],
        asks: [{ price: '0.55', size: '10' }],
      },
      {
        asset_id: 'valid-down',
        bids: [{ price: '0.44', size: '7' }],
        asks: [{ price: '0.46', size: '8' }],
      },
      { asset_id: 'empty-up', asks: [] },
      { asset_id: 'empty-down', asks: [{ price: '0.50', size: '5' }] },
    ],
  });

  const quotes = await fetchExecutableQuotes(markets, fetchImpl);

  assert.deepEqual([...quotes.keys()], ['valid']);
  assert.deepEqual(quotes.get('valid'), {
    upBid: 0.53,
    upBidSize: 9,
    upAsk: 0.55,
    upSize: 10,
    downBid: 0.44,
    downBidSize: 7,
    downAsk: 0.46,
    downSize: 8,
    upAsks: [{ price: 0.55, size: 10 }],
    downAsks: [{ price: 0.46, size: 8 }],
    midpointUp: 0.545,
  });
});
