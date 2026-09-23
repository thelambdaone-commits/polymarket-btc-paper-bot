import test from 'node:test';
import assert from 'node:assert/strict';

import { ChainlinkPriceFeed, parseChainlinkTwapEvent } from '../src/crypto-feed.js';

test('accepts only fresh BTC/USD Chainlink TWAP updates', () => {
  assert.deepEqual(parseChainlinkTwapEvent(JSON.stringify({
    topic: 'crypto_prices_twap_thirty',
    type: 'update',
    payload: { symbol: 'btc/usd', value: 79_000.5, timestamp: 1_000, window_s: 30 },
  })), { value: 79_000.5, timestamp: 1_000, windowSeconds: 30 });
  assert.equal(parseChainlinkTwapEvent('PONG'), null);
  assert.equal(parseChainlinkTwapEvent('{bad json'), null);
  assert.equal(parseChainlinkTwapEvent(JSON.stringify({
    topic: 'crypto_prices_twap_thirty',
    payload: { symbol: 'eth/usd', value: 4_000, timestamp: 1_000, window_s: 30 },
  })), null);
});

test('keeps a bounded history and requires a fresh market-start reference', () => {
  const feed = new ChainlinkPriceFeed({ now: () => 20_000 });
  for (let timestamp = 1_000; timestamp <= 20_000; timestamp += 1_000) {
    feed.ingest({ value: 79_000 + timestamp / 1_000, timestamp, windowSeconds: 30 });
  }
  feed.ingest({ value: 79_010, timestamp: 20_000, windowSeconds: 60 });

  const snapshot = feed.snapshot(10);

  assert.equal(snapshot.fresh, true);
  assert.equal(snapshot.startPrice, 79_010);
  assert.equal(snapshot.currentPrice, 79_020);
  assert.equal(snapshot.twap60, 79_010);
  assert.equal(snapshot.samples.length, 11);
  assert.equal(feed.snapshot(-5).startPrice, null);
});

test('emits validated Chainlink samples for append-only recording', () => {
  const events = [];
  const feed = new ChainlinkPriceFeed({
    onEvent: (type, payload, timestamp) => events.push({ type, payload, timestamp }),
  });
  feed.ingest({ value: 65_000, timestamp: 1_000, windowSeconds: 30 });

  assert.deepEqual(events, [{
    type: 'twap',
    payload: { value: 65_000, timestamp: 1_000, windowSeconds: 30 },
    timestamp: 1_000,
  }]);
});

test('restores recent Chainlink history without recording duplicate events', () => {
  const events = [];
  const feed = new ChainlinkPriceFeed({
    now: () => 20_000,
    initialSamples: [
      { value: 79_000, timestamp: 10_000, windowSeconds: 30 },
      { value: 79_010, timestamp: 20_000, windowSeconds: 30 },
      { value: 79_005, timestamp: 20_000, windowSeconds: 60 },
    ],
    onEvent: (...args) => events.push(args),
  });

  const snapshot = feed.snapshot(10);
  assert.equal(snapshot.startPrice, 79_000);
  assert.equal(snapshot.currentPrice, 79_010);
  assert.equal(snapshot.twap60, 79_005);
  assert.deepEqual(events, []);
});

test('ignores out-of-order Chainlink samples when selecting the current price', () => {
  const feed = new ChainlinkPriceFeed({ now: () => 3_000 });
  feed.ingest({ value: 101, timestamp: 3_000, windowSeconds: 30 });
  feed.ingest({ value: 99, timestamp: 2_000, windowSeconds: 30 });

  assert.equal(feed.snapshot(2).currentPrice, 101);
});
