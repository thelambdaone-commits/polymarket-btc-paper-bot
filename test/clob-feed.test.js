import assert from 'node:assert/strict';
import test from 'node:test';

import { ClobOrderBookFeed } from '../src/clob-feed.js';

const market = {
  id: 'market-1',
  upTokenId: 'up-token',
  downTokenId: 'down-token',
};

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
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

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  send(message) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

function snapshot(assetId, bids, asks, timestamp = 1_000) {
  return JSON.stringify({ event_type: 'book', asset_id: assetId, bids, asks, timestamp });
}

test('subscribes to both outcome tokens and builds an executable quote from snapshots', () => {
  FakeWebSocket.instances = [];
  let now = 1_000;
  const feed = new ClobOrderBookFeed({ WebSocketImpl: FakeWebSocket, now: () => now });
  feed.setMarkets([market]);
  feed.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();

  assert.deepEqual(JSON.parse(socket.sent[0]), {
    assets_ids: ['up-token', 'down-token'],
    type: 'market',
  });

  socket.emit('message', {
    data: snapshot('up-token', [{ price: '0.54', size: '8' }], [{ price: '0.56', size: '7' }]),
  });
  socket.emit('message', {
    data: snapshot('down-token', [{ price: '0.43', size: '6' }], [{ price: '0.45', size: '5' }]),
  });

  assert.deepEqual(feed.getQuote(market), {
    upBid: 0.54,
    upBidSize: 8,
    upAsk: 0.56,
    upSize: 7,
    downBid: 0.43,
    downBidSize: 6,
    downAsk: 0.45,
    downSize: 5,
    upAsks: [{ price: 0.56, size: 7 }],
    downAsks: [{ price: 0.45, size: 5 }],
    midpointUp: 0.555,
  });
  now = 3_001;
  assert.equal(feed.getQuote(market), null);
  feed.stop();
});

test('applies price changes and removes zero-sized levels', () => {
  const feed = new ClobOrderBookFeed({ now: () => 1_000 });
  feed.setMarkets([market]);
  feed.ingest(snapshot(
    'up-token',
    [{ price: '0.50', size: '2' }, { price: '0.49', size: '3' }],
    [{ price: '0.52', size: '4' }],
  ));
  feed.ingest(JSON.stringify({
    event_type: 'price_change',
    timestamp: 1_001,
    price_changes: [
      { asset_id: 'up-token', side: 'BUY', price: '0.50', size: '0' },
      { asset_id: 'up-token', side: 'BUY', price: '0.51', size: '9' },
      { asset_id: 'up-token', side: 'SELL', price: '0.52', size: '6' },
    ],
  }));

  assert.deepEqual(feed.getBook('up-token'), {
    bids: [{ price: 0.51, size: 9 }, { price: 0.49, size: 3 }],
    asks: [{ price: 0.52, size: 6 }],
    synchronized: true,
    updatedAt: 1_000,
  });
});

test('ignores out-of-order price changes instead of refreshing a stale book', () => {
  const feed = new ClobOrderBookFeed({ now: () => 2_000 });
  feed.setMarkets([market]);
  feed.ingest(snapshot(
    'up-token',
    [{ price: '0.50', size: '2' }],
    [{ price: '0.52', size: '4' }],
    2_000,
  ));
  feed.ingest(JSON.stringify({
    event_type: 'price_change',
    timestamp: 1_999,
    price_changes: [{ asset_id: 'up-token', side: 'BUY', price: '0.51', size: '9' }],
  }));

  assert.deepEqual(feed.getBook('up-token').bids, [{ price: 0.5, size: 2 }]);
});

test('requires fresh synchronized books for both outcomes', () => {
  const feed = new ClobOrderBookFeed({ now: () => 5_000 });
  feed.setMarkets([market]);
  feed.ingest(snapshot('up-token', [{ price: '0.5', size: '1' }], [{ price: '0.6', size: '1' }]));

  assert.equal(feed.getQuote(market), null);
});

test('clears snapshots on disconnect and resubscribes after reconnecting', () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const feed = new ClobOrderBookFeed({
    WebSocketImpl: FakeWebSocket,
    now: () => 1_000,
    setTimeoutImpl: (callback) => { scheduled.push(callback); return scheduled.length; },
    clearTimeoutImpl: () => {},
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  feed.setMarkets([market]);
  feed.start();
  const first = FakeWebSocket.instances[0];
  first.open();
  first.emit('message', {
    data: snapshot('up-token', [{ price: '0.5', size: '1' }], [{ price: '0.6', size: '1' }]),
  });
  first.close();

  assert.equal(feed.getBook('up-token').synchronized, false);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  const second = FakeWebSocket.instances[1];
  second.open();
  assert.deepEqual(JSON.parse(second.sent[0]).assets_ids, ['up-token', 'down-token']);
  feed.stop();
});

test('uses REST only for markets without a fresh WebSocket quote', async () => {
  const feed = new ClobOrderBookFeed({ now: () => 1_000 });
  feed.setMarkets([market]);
  const fallbackQuote = { upAsk: 0.6, downAsk: 0.4 };
  const result = await feed.getQuotes([market], async (missing) => {
    assert.deepEqual(missing, [market]);
    return new Map([[market.id, fallbackQuote]]);
  });

  assert.equal(result.get(market.id), fallbackQuote);
});

test('emits validated CLOB events for append-only recording', () => {
  const events = [];
  const feed = new ClobOrderBookFeed({
    now: () => 1_000,
    onEvent: (type, payload, timestamp) => events.push({ type, payload, timestamp }),
  });
  feed.setMarkets([market]);
  feed.ingest(snapshot('up-token', [{ price: '0.5', size: '1' }], [{ price: '0.6', size: '1' }], 900));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'book');
  assert.equal(events[0].payload.asset_id, 'up-token');
  assert.equal(events[0].timestamp, 900);
});
