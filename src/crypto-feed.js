const RTDS_URL = 'wss://ws-live-data.polymarket.com';
const MAX_HISTORY_MS = 20 * 60 * 1_000;
const MAX_FRESHNESS_MS = 5_000;
const START_TOLERANCE_MS = 2_000;

export function parseChainlinkTwapEvent(raw) {
  let event;
  try {
    event = JSON.parse(String(raw));
  } catch {
    return null;
  }
  const payload = event?.payload;
  const value = Number(payload?.value);
  const timestamp = Number(payload?.timestamp);
  const windowSeconds = Number(payload?.window_s ?? payload?.windowSeconds);
  if (
    event?.type !== 'update' ||
    payload?.symbol !== 'btc/usd' ||
    !Number.isFinite(value) || value <= 0 ||
    !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
    ![30, 60].includes(windowSeconds)
  ) return null;
  return { value, timestamp, windowSeconds };
}

export class ChainlinkPriceFeed {
  constructor({
    now = Date.now,
    WebSocketImpl = globalThis.WebSocket,
    onEvent = null,
    initialSamples = [],
  } = {}) {
    this.now = now;
    this.WebSocketImpl = WebSocketImpl;
    this.onEvent = null;
    this.samples = [];
    this.latest60 = null;
    this.socket = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.stopped = true;
    for (const sample of initialSamples) this.ingest(sample);
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
  }

  ingest(sample) {
    if (
      !sample || !Number.isFinite(sample.value) || sample.value <= 0 ||
      !Number.isSafeInteger(sample.timestamp) || ![30, 60].includes(sample.windowSeconds)
    ) return;
    if (sample.windowSeconds === 60 &&
      (!this.latest60 || sample.timestamp >= this.latest60.timestamp)) {
      this.latest60 = { ...sample };
    }
    if (sample.windowSeconds === 30) {
      this.samples.push({ ...sample });
      this.samples.sort((left, right) => left.timestamp - right.timestamp);
      const cutoff = sample.timestamp - MAX_HISTORY_MS;
      this.samples = this.samples.filter(({ timestamp }) => timestamp >= cutoff);
    }
    this.onEvent?.('twap', { ...sample }, sample.timestamp);
  }

  snapshot(marketStartSeconds) {
    const latest = this.samples.at(-1) ?? null;
    const marketStartMs = marketStartSeconds * 1_000;
    const start = this.samples.reduce((closest, sample) => {
      const distance = Math.abs(sample.timestamp - marketStartMs);
      if (distance > START_TOLERANCE_MS) return closest;
      if (!closest || distance < Math.abs(closest.timestamp - marketStartMs)) return sample;
      return closest;
    }, null);
    return {
      fresh: Boolean(latest && this.now() - latest.timestamp >= -MAX_FRESHNESS_MS &&
        this.now() - latest.timestamp <= MAX_FRESHNESS_MS),
      startPrice: start?.value ?? null,
      currentPrice: latest?.value ?? null,
      twap60: this.latest60?.value ?? null,
      samples: this.samples
        .filter(({ timestamp }) => timestamp >= marketStartMs)
        .map(({ value }) => value),
      sampleIntervalSeconds: this.sampleIntervalSeconds(),
      observedAt: latest?.timestamp ?? null,
    };
  }

  sampleIntervalSeconds() {
    const timestamps = this.samples
      .slice(-20)
      .map(({ timestamp }) => timestamp)
      .filter(Number.isSafeInteger);
    if (timestamps.length < 2) return 30;
    const intervals = timestamps.slice(1)
      .map((timestamp, index) => (timestamp - timestamps[index]) / 1_000)
      .filter((interval) => interval > 0 && interval <= 300)
      .sort((left, right) => left - right);
    return intervals.length === 0 ? 30 : intervals[Math.floor(intervals.length / 2)];
  }

  start() {
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable');
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const socket = new this.WebSocketImpl(RTDS_URL);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [30, 60].map((windowSeconds) => ({
          topic: `crypto_prices_twap_${windowSeconds === 30 ? 'thirty' : 'sixty'}`,
          type: 'update',
          filters: '{"symbol":"btc/usd"}',
        })),
      }));
      this.heartbeat = setInterval(() => socket.send('PING'), 5_000);
    });
    socket.addEventListener('message', ({ data }) => {
      const sample = parseChainlinkTwapEvent(data);
      if (sample) this.ingest(sample);
    });
    socket.addEventListener('close', () => {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), 2_000);
    });
    socket.addEventListener('error', () => socket.close());
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
