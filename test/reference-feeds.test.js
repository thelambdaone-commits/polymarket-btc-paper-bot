import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBinanceTrade,
  parseCoinbaseTicker,
  ReferencePriceFeeds,
} from '../src/reference-feeds.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(value) { this.sent.push(value); }
  close() { this.emit('close'); }
}

test('strictly parses BTC trades from Binance and Coinbase', () => {
  assert.deepEqual(parseBinanceTrade(JSON.stringify({
    e: 'trade', s: 'BTCUSDT', p: '65001.25', q: '0.02', T: 1_700_000_000_000,
  })), { price: 65_001.25, size: 0.02, timestamp: 1_700_000_000_000 });
  assert.equal(parseBinanceTrade(JSON.stringify({ e: 'trade', s: 'ETHUSDT', p: '1', T: 1 })), null);

  assert.deepEqual(parseCoinbaseTicker(JSON.stringify({
    channel: 'ticker',
    timestamp: '2023-11-14T22:13:20.000Z',
    events: [{ tickers: [{ product_id: 'BTC-USD', price: '64999.50' }] }],
  })), { price: 64_999.5, timestamp: 1_700_000_000_000 });
  assert.equal(parseCoinbaseTicker('{"channel":"ticker","events":[]}'), null);
});

test('keeps optional feeds independent and reports only fresh prices', () => {
  FakeWebSocket.instances = [];
  let now = 1_700_000_000_100;
  const events = [];
  const feeds = new ReferencePriceFeeds({
    enabled: true,
    now: () => now,
    WebSocketImpl: FakeWebSocket,
    onEvent: (source, type, payload, timestamp) => events.push({ source, type, payload, timestamp }),
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  });
  feeds.start();
  const [binance, coinbase] = FakeWebSocket.instances;
  binance.emit('open');
  coinbase.emit('open');

  assert.deepEqual(coinbase.sent.map(JSON.parse), [
    { type: 'subscribe', product_ids: ['BTC-USD'], channel: 'ticker' },
    { type: 'subscribe', channel: 'heartbeats' },
  ]);
  binance.emit('message', { data: JSON.stringify({
    e: 'trade', s: 'BTCUSDT', p: '65001.25', q: '0.02', T: 1_700_000_000_000,
  }) });
  coinbase.emit('message', { data: JSON.stringify({
    channel: 'ticker', timestamp: '2023-11-14T22:13:20.000Z',
    events: [{ tickers: [{ product_id: 'BTC-USD', price: '64999.50' }] }],
  }) });
  binance.emit('message', { data: JSON.stringify({
    e: 'trade', s: 'BTCUSDT', p: '65002', q: '0.01', T: 1_700_000_000_100,
  }) });

  assert.deepEqual(feeds.snapshot(), {
    binance: { price: 65_001.25, observedAt: 1_700_000_000_000, fresh: true },
    coinbase: { price: 64_999.5, observedAt: 1_700_000_000_000, fresh: true },
    divergence: 0.000027,
  });
  assert.equal(events.length, 2);
  now += 5_001;
  assert.equal(feeds.snapshot().binance.fresh, false);
  feeds.stop();
});

test('does not open external sockets when complementary feeds are disabled', () => {
  FakeWebSocket.instances = [];
  const feeds = new ReferencePriceFeeds({ enabled: false, WebSocketImpl: FakeWebSocket });
  feeds.start();
  assert.equal(FakeWebSocket.instances.length, 0);
});
