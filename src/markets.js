const GAMMA_MARKET_BY_SLUG_URL = 'https://gamma-api.polymarket.com/markets/slug';
const CLOB_MIDPOINT_URL = 'https://clob.polymarket.com/midpoint';
const CLOB_BOOKS_URL = 'https://clob.polymarket.com/books';

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseFeeRate(record) {
  if (record?.feesEnabled === false) return 0;
  const rate = Number(record?.feeSchedule?.rate ?? record?.feeRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

export function normalizeBtcMarkets(records) {
  if (!Array.isArray(records)) return [];

  return records.flatMap((record) => {
    if (!record || record.active !== true || record.closed === true) return [];
    const slug = typeof record.slug === 'string' ? record.slug : '';
    const question = typeof record.question === 'string' ? record.question : '';
    if (!/^btc-updown-(?:5|15)m-\d+$/i.test(slug) && !/^btc-updown-1h-\d+$/i.test(slug)) return [];
    const match = `${slug} ${question}`.match(/(?:btc|bitcoin).*?(5|15)(?:m|\s*minutes?)|(?:btc|bitcoin).*?(1)(?:h|\s*hours?)/i);
    if (!match || !/up\s*(?:or|\/)?\s*down|updown/i.test(`${slug} ${question}`)) return [];

    const outcomes = parseArray(record.outcomes);
    const prices = parseArray(record.outcomePrices);
    const tokenIds = parseArray(record.clobTokenIds);
    if (!outcomes || !prices || !tokenIds || outcomes.length !== tokenIds.length ||
      prices.length !== outcomes.length || outcomes.length !== 2) return [];

    const upIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === 'up');
    const downIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === 'down');
    const upPrice = Number(prices[upIndex]);
    const downPrice = Number(prices[downIndex]);
    const id = record.id != null ? String(record.id) : '';
    const upTokenId = typeof tokenIds[upIndex] === 'string' || Number.isSafeInteger(tokenIds[upIndex])
      ? String(tokenIds[upIndex]) : '';
    const downTokenId = typeof tokenIds[downIndex] === 'string' || Number.isSafeInteger(tokenIds[downIndex])
      ? String(tokenIds[downIndex]) : '';
    if (!id || upIndex < 0 || downIndex < 0 || upTokenId === downTokenId || !upTokenId || !downTokenId ||
      !Number.isFinite(upPrice) || upPrice < 0 || upPrice > 1 ||
      !Number.isFinite(downPrice) || downPrice < 0 || downPrice > 1 ||
      record.enableOrderBook === false) {
      return [];
    }

    const slugStart = Number(slug.match(/-(\d+)$/)?.[1]);
    const timeframeMinutes = match[1] ? Number(match[1]) : 60;
    if (!Number.isSafeInteger(slugStart)) return [];
    const apiStart = Date.parse(record.startDateIso ?? record.startDate ?? '');
    const apiEnd = Date.parse(record.endDateIso ?? record.endDate ?? '');
    const expectedEnd = slugStart + timeframeMinutes * 60;
    if ((Number.isFinite(apiStart) && Math.abs(apiStart / 1_000 - slugStart) > 5) ||
      (Number.isFinite(apiEnd) && Math.abs(apiEnd / 1_000 - expectedEnd) > 5)) return [];
    const market = {
      id,
      slug,
      timeframeMinutes,
      startTime: slugStart,
      endTime: expectedEnd,
      upTokenId,
      downTokenId,
      upPrice,
    };
    const feeRate = parseFeeRate(record);
    if (feeRate !== null) market.feeRate = feeRate;
    const tickSize = Number(record.orderPriceMinTickSize);
    const minimumOrderSize = Number(record.orderMinSize);
    if (Number.isFinite(tickSize) && tickSize > 0) market.tickSize = tickSize;
    if (Number.isFinite(minimumOrderSize) && minimumOrderSize > 0) {
      market.minimumOrderSize = minimumOrderSize;
    }
    return [market];
  });
}

export function normalizeResolution(record) {
  if (!record || record.closed !== true) return null;
  const outcomes = parseArray(record.outcomes);
  const prices = parseArray(record.outcomePrices)?.map(Number);
  if (!outcomes || !prices || outcomes.length !== prices.length) return null;
  const winner = prices.findIndex((price) => Number.isFinite(price) && price >= 0.999);
  if (winner < 0 || prices.some((price, index) => index !== winner && price > 0.001)) return null;
  const outcome = String(outcomes[winner]).toUpperCase();
  return ['UP', 'DOWN'].includes(outcome) ? outcome : null;
}

export async function fetchMarketResolution(slug, fetchImpl = fetch) {
  if (!/^btc-updown-(5|15)m-\d+$/.test(slug) && !/^btc-updown-1h-\d+$/.test(slug)) {
    throw new Error('Invalid BTC market slug');
  }
  const record = await getJson(`${GAMMA_MARKET_BY_SLUG_URL}/${slug}`, fetchImpl);
  return normalizeResolution(record);
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'btc-paper-bot/0.1' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Market API returned HTTP ${response.status}`);
  return response.json();
}

async function postJson(url, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'btc-paper-bot/0.2',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Market API returned HTTP ${response.status}`);
  return response.json();
}

function bestAsk(book) {
  if (!book || !Array.isArray(book.asks)) return null;
  const levels = book.asks
    .map((level) => ({ price: Number(level?.price), size: Number(level?.size) }))
    .filter((level) => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((a, b) => a.price - b.price);
  return levels[0] ?? null;
}

function bestBid(book) {
  if (!book || !Array.isArray(book.bids)) return null;
  const levels = book.bids
    .map((level) => ({ price: Number(level?.price), size: Number(level?.size) }))
    .filter((level) => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((a, b) => b.price - a.price);
  return levels[0] ?? null;
}

function askLevels(book) {
  if (!book || !Array.isArray(book.asks)) return [];
  return book.asks
    .map((level) => ({ price: Number(level?.price), size: Number(level?.size) }))
    .filter((level) => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((left, right) => left.price - right.price);
}

export function normalizeOrderBooks(books, market) {
  if (!Array.isArray(books) || !market) return null;
  const upBook = books.find((book) => String(book?.asset_id) === market.upTokenId);
  const downBook = books.find((book) => String(book?.asset_id) === market.downTokenId);
  const up = { bid: bestBid(upBook), ask: bestAsk(upBook) };
  const down = { bid: bestBid(downBook), ask: bestAsk(downBook) };
  if (!up.bid || !up.ask || !down.bid || !down.ask) return null;
  return {
    upBid: up.bid.price,
    upBidSize: up.bid.size,
    upAsk: up.ask.price,
    upSize: up.ask.size,
    downBid: down.bid.price,
    downBidSize: down.bid.size,
    downAsk: down.ask.price,
    downSize: down.ask.size,
    upAsks: askLevels(upBook),
    downAsks: askLevels(downBook),
    midpointUp: Number((
      ((up.bid.price + up.ask.price) / 2 + (1 - (down.bid.price + down.ask.price) / 2)) / 2
    ).toFixed(6)),
  };
}

export async function fetchExecutableQuote(market, fetchImpl = fetch) {
  const books = await postJson(
    CLOB_BOOKS_URL,
    [{ token_id: market.upTokenId }, { token_id: market.downTokenId }],
    fetchImpl,
  );
  const quote = normalizeOrderBooks(books, market);
  if (!quote) throw new Error('CLOB returned incomplete order books');
  return quote;
}

export async function fetchExecutableQuotes(markets, fetchImpl = fetch) {
  if (!Array.isArray(markets) || markets.length === 0) return new Map();
  const requests = markets.flatMap((market) => [
    { token_id: market.upTokenId },
    { token_id: market.downTokenId },
  ]);
  const books = await postJson(CLOB_BOOKS_URL, requests, fetchImpl);
  return new Map(
    markets.flatMap((market) => {
      const quote = normalizeOrderBooks(books, market);
      return quote ? [[market.id, quote]] : [];
    }),
  );
}

export async function discoverBtcMarkets(fetchImpl = fetch, timeframes = [5, 15]) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const slugs = timeframes.flatMap((minutes) => {
    const windowSeconds = minutes * 60;
    const suffix = minutes === 60 ? '1h' : `${minutes}m`;
    const currentStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    return [currentStart, currentStart + windowSeconds].map((start) => `btc-updown-${suffix}-${start}`);
  });
  const settled = await Promise.allSettled(
    slugs.map((slug) => getJson(`${GAMMA_MARKET_BY_SLUG_URL}/${slug}`, fetchImpl)),
  );
  const records = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (records.length === 0) throw new Error('Market discovery returned no records');
  const markets = normalizeBtcMarkets(records);
  if (markets.length === 0) throw new Error('Market discovery returned no valid BTC markets');
  return markets;
}

export async function fetchUpMidpoint(tokenId, fetchImpl = fetch) {
  if (!/^\d+$/.test(tokenId) && !/^[\w-]+$/.test(tokenId)) throw new Error('Invalid token ID');
  const url = `${CLOB_MIDPOINT_URL}?token_id=${encodeURIComponent(tokenId)}`;
  const payload = await getJson(url, fetchImpl);
  const midpoint = Number(payload?.mid);
  if (!Number.isFinite(midpoint) || midpoint < 0 || midpoint > 1) {
    throw new Error('CLOB returned an invalid midpoint');
  }
  return midpoint;
}
