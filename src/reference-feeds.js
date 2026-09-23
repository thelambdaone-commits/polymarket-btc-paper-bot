const BINANCE_URL = 'wss://stream.binance.com:9443/ws/btcusdt@trade';
const COINBASE_URL = 'wss://advanced-trade-ws.coinbase.com';
const MAX_MESSAGE_LENGTH = 1_000_000;

function parseJson(raw) {
  const text = String(raw);
  if (text.length > MAX_MESSAGE_LENGTH) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseBinanceTrade(raw) {
  const event = parseJson(raw);
  const price = Number(event?.p);
  const size = Number(event?.q);
  const timestamp = Number(event?.T);
  if (
    event?.e !== 'trade' || event?.s !== 'BTCUSDT' ||
    !Number.isFinite(price) || price <= 0 ||
    !Number.isFinite(size) || size <= 0 ||
    !Number.isSafeInteger(timestamp) || timestamp <= 0
  ) return null;
  return { price, size, timestamp };
}

export function parseCoinbaseTicker(raw) {
  const event = parseJson(raw);
  if (event?.channel !== 'ticker' || !Array.isArray(event.events)) return null;
  const tickers = event.events.flatMap((item) => Array.isArray(item?.tickers) ? item.tickers : []);
  const ticker = tickers.find((item) => item?.product_id === 'BTC-USD');
  const price = Number(ticker?.price);
  const timestamp = Date.parse(event.timestamp);
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(timestamp)) return null;
  return { price, timestamp };
}

export class ReferencePriceFeeds {
  constructor({
    enabled = false,
    now = Date.now,
    WebSocketImpl = globalThis.WebSocket,
    maxFreshnessMs = 5_000,
    minimumSampleIntervalMs = 1_000,
    onEvent = null,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {}) {
    this.enabled = enabled;
    this.now = now;
    this.WebSocketImpl = WebSocketImpl;
    this.maxFreshnessMs = maxFreshnessMs;
    this.minimumSampleIntervalMs = minimumSampleIntervalMs;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.sockets = new Map();
    this.reconnectTimers = new Map();
    this.latest = new Map();
    this.stopped = true;
  }

  start() {
    if (!this.enabled || !this.stopped) return;
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable');
    this.stopped = false;
    this.connect('binance', BINANCE_URL);
    this.connect('coinbase', COINBASE_URL);
  }

  connect(source, url) {
    if (this.stopped) return;
    const socket = new this.WebSocketImpl(url);
    this.sockets.set(source, socket);
    socket.addEventListener('open', () => {
      if (source !== 'coinbase') return;
      socket.send(JSON.stringify({
        type: 'subscribe', product_ids: ['BTC-USD'], channel: 'ticker',
      }));
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }));
    });
    socket.addEventListener('message', ({ data }) => {
      const sample = source === 'binance' ? parseBinanceTrade(data) : parseCoinbaseTicker(data);
      if (!sample) return;
      const previous = this.latest.get(source);
      if (previous && sample.timestamp - previous.observedAt < this.minimumSampleIntervalMs) return;
      this.latest.set(source, { price: sample.price, observedAt: sample.timestamp });
      this.onEvent?.(source, 'trade', sample, sample.timestamp);
    });
    socket.addEventListener('close', () => {
      if (this.sockets.get(source) !== socket) return;
      this.sockets.delete(source);
      this.latest.delete(source);
      if (!this.stopped) {
        const timer = this.setTimeoutImpl(() => this.connect(source, url), 2_000);
        this.reconnectTimers.set(source, timer);
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  snapshot() {
    const snapshot = {};
    for (const source of ['binance', 'coinbase']) {
      const sample = this.latest.get(source) ?? null;
      snapshot[source] = sample ? {
        ...sample,
        fresh: this.now() - sample.observedAt <= this.maxFreshnessMs,
      } : { price: null, observedAt: null, fresh: false };
    }
    snapshot.divergence = snapshot.binance.fresh && snapshot.coinbase.fresh
      ? Number((Math.abs(snapshot.binance.price - snapshot.coinbase.price) /
        ((snapshot.binance.price + snapshot.coinbase.price) / 2)).toFixed(6))
      : null;
    return snapshot;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.reconnectTimers.values()) this.clearTimeoutImpl(timer);
    this.reconnectTimers.clear();
    const sockets = [...this.sockets.values()];
    this.sockets.clear();
    for (const socket of sockets) socket.close();
    this.latest.clear();
  }
}
