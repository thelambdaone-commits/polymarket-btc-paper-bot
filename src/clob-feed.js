const CLOB_WEBSOCKET_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const DEFAULT_MAX_FRESHNESS_MS = 2_000;

function validLevel(level, { allowZero = false } = {}) {
  const price = Number(level?.price);
  const size = Number(level?.size);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  if (!Number.isFinite(size) || size < 0 || (!allowZero && size === 0)) return null;
  return { price, size };
}

function sortedLevels(levels, descending) {
  return [...levels.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((left, right) => descending ? right.price - left.price : left.price - right.price);
}

function emptyBook() {
  return {
    bids: new Map(),
    asks: new Map(),
    synchronized: false,
    updatedAt: 0,
    sourceTimestamp: 0,
  };
}

export class ClobOrderBookFeed {
  constructor({
    now = Date.now,
    WebSocketImpl = globalThis.WebSocket,
    maxFreshnessMs = DEFAULT_MAX_FRESHNESS_MS,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    onEvent = null,
  } = {}) {
    this.now = now;
    this.WebSocketImpl = WebSocketImpl;
    this.maxFreshnessMs = maxFreshnessMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.books = new Map();
    this.tokenIds = new Set();
    this.socket = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.stopped = true;
    this.connected = false;
  }

  setMarkets(markets) {
    const nextTokenIds = new Set(
      (Array.isArray(markets) ? markets : []).flatMap((market) =>
        [market?.upTokenId, market?.downTokenId].filter((tokenId) => typeof tokenId === 'string'),
      ),
    );
    const added = [...nextTokenIds].filter((tokenId) => !this.tokenIds.has(tokenId));
    const removed = [...this.tokenIds].filter((tokenId) => !nextTokenIds.has(tokenId));
    this.tokenIds = nextTokenIds;
    for (const tokenId of nextTokenIds) {
      if (!this.books.has(tokenId)) this.books.set(tokenId, emptyBook());
    }
    for (const tokenId of removed) this.books.delete(tokenId);
    if (this.connected && added.length > 0) this.sendSubscription('subscribe', added);
    if (this.connected && removed.length > 0) this.sendSubscription('unsubscribe', removed);
  }

  start() {
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable');
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const socket = new this.WebSocketImpl(CLOB_WEBSOCKET_URL);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket || this.stopped) return;
      this.connected = true;
      const tokenIds = [...this.tokenIds];
      if (tokenIds.length > 0) {
        socket.send(JSON.stringify({ assets_ids: tokenIds, type: 'market' }));
      }
      this.heartbeat = this.setIntervalImpl(() => {
        if (this.connected && socket === this.socket) socket.send('PING');
      }, 10_000);
    });
    socket.addEventListener('message', ({ data }) => this.ingest(data));
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.connected = false;
      this.clearIntervalImpl(this.heartbeat);
      this.heartbeat = null;
      this.invalidateBooks();
      if (!this.stopped) {
        this.reconnectTimer = this.setTimeoutImpl(() => this.connect(), 2_000);
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  sendSubscription(operation, tokenIds) {
    if (!this.connected || tokenIds.length === 0) return;
    this.socket.send(JSON.stringify({ operation, assets_ids: tokenIds }));
  }

  invalidateBooks() {
    for (const book of this.books.values()) {
      book.synchronized = false;
      book.updatedAt = 0;
    }
  }

  ingest(raw) {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }
    const events = Array.isArray(payload) ? payload : [payload];
    for (const event of events) {
      if (event?.event_type === 'book') this.ingestSnapshot(event);
      if (event?.event_type === 'price_change') this.ingestChanges(event);
    }
  }

  ingestSnapshot(event) {
    const tokenId = String(event?.asset_id ?? '');
    if (!this.tokenIds.has(tokenId) || !Array.isArray(event.bids) || !Array.isArray(event.asks)) return;
    const bids = event.bids.map((level) => validLevel(level)).filter(Boolean);
    const asks = event.asks.map((level) => validLevel(level)).filter(Boolean);
    if (bids.length === 0 || asks.length === 0) {
      const book = this.books.get(tokenId);
      if (book) {
        book.synchronized = false;
        book.updatedAt = 0;
        book.sourceTimestamp = 0;
      }
      return;
    }
    const sourceTimestamp = Number(event.timestamp);
    const previous = this.books.get(tokenId);
    if (!Number.isSafeInteger(sourceTimestamp) ||
      (previous?.sourceTimestamp > 0 && sourceTimestamp < previous.sourceTimestamp)) return;
    this.books.set(tokenId, {
      bids: new Map(bids.map(({ price, size }) => [price, size])),
      asks: new Map(asks.map(({ price, size }) => [price, size])),
      synchronized: true,
      updatedAt: this.now(),
      sourceTimestamp,
    });
    this.onEvent?.('book', event, Number(event.timestamp));
  }

  ingestChanges(event) {
    if (!Array.isArray(event?.price_changes)) return;
    const sourceTimestamp = Number(event.timestamp);
    if (!Number.isSafeInteger(sourceTimestamp)) return;
    let applied = false;
    for (const change of event.price_changes) {
      const tokenId = String(change?.asset_id ?? '');
      const book = this.books.get(tokenId);
      const level = validLevel(change, { allowZero: true });
      if (!book?.synchronized || !level || !['BUY', 'SELL'].includes(change.side) ||
        (book.sourceTimestamp > 0 && sourceTimestamp < book.sourceTimestamp)) continue;
      const levels = change.side === 'BUY' ? book.bids : book.asks;
      if (level.size === 0) levels.delete(level.price);
      else levels.set(level.price, level.size);
      book.updatedAt = this.now();
      book.sourceTimestamp = sourceTimestamp;
      applied = true;
    }
    if (applied) this.onEvent?.('price_change', event, Number(event.timestamp));
  }

  getBook(tokenId) {
    const book = this.books.get(String(tokenId));
    if (!book) return null;
    return {
      bids: sortedLevels(book.bids, true),
      asks: sortedLevels(book.asks, false),
      synchronized: book.synchronized,
      updatedAt: book.updatedAt,
    };
  }

  getQuote(market) {
    const up = this.books.get(String(market?.upTokenId));
    const down = this.books.get(String(market?.downTokenId));
    if (!this.isFresh(up) || !this.isFresh(down)) return null;
    const upBid = sortedLevels(up.bids, true)[0];
    const upAsk = sortedLevels(up.asks, false)[0];
    const downBid = sortedLevels(down.bids, true)[0];
    const downAsk = sortedLevels(down.asks, false)[0];
    if (!upBid || !upAsk || !downBid || !downAsk) return null;
    return {
      upBid: upBid.price,
      upBidSize: upBid.size,
      upAsk: upAsk.price,
      upSize: upAsk.size,
      downBid: downBid.price,
      downBidSize: downBid.size,
      downAsk: downAsk.price,
      downSize: downAsk.size,
      upAsks: sortedLevels(up.asks, false),
      downAsks: sortedLevels(down.asks, false),
      midpointUp: Number((
        ((upBid.price + upAsk.price) / 2 + (1 - (downBid.price + downAsk.price) / 2)) / 2
      ).toFixed(6)),
    };
  }

  isFresh(book) {
    const now = this.now();
    return Boolean(
      book?.synchronized && book.updatedAt > 0 && book.sourceTimestamp > 0 &&
      now - book.updatedAt >= 0 && now - book.updatedAt <= this.maxFreshnessMs &&
      book.sourceTimestamp <= now + this.maxFreshnessMs &&
      now - book.sourceTimestamp <= this.maxFreshnessMs,
    );
  }

  async getQuotes(markets, fetchFallback) {
    const quotes = new Map();
    const missing = [];
    for (const market of markets) {
      const quote = this.getQuote(market);
      if (quote) quotes.set(market.id, quote);
      else missing.push(market);
    }
    if (missing.length > 0 && typeof fetchFallback === 'function') {
      const fallbackQuotes = await fetchFallback(missing);
      for (const [marketId, quote] of fallbackQuotes) quotes.set(marketId, quote);
    }
    return quotes;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.connected = false;
    this.clearIntervalImpl(this.heartbeat);
    this.clearTimeoutImpl(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.invalidateBooks();
  }
}
