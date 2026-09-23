const DEFAULT_START_TOLERANCE_MS = 2_000;
const DEFAULT_MAX_CLOSE_LAG_MS = 10_000;
const LOG_LOSS_CLAMP = 1e-12;
const BIN_WIDTH = 0.05;
const BIN_COUNT = 10;

function validSamples(samples) {
  if (!Array.isArray(samples)) return [];
  return samples.filter((sample) => sample &&
    Number.isFinite(sample.value) && sample.value > 0 &&
    Number.isSafeInteger(sample.timestamp));
}

export function deriveMarketOutcome(samples, market, {
  startToleranceMs = DEFAULT_START_TOLERANCE_MS,
  maxCloseLagMs = DEFAULT_MAX_CLOSE_LAG_MS,
} = {}) {
  if (!market ||
    !Number.isSafeInteger(market.startTime) || !Number.isSafeInteger(market.endTime) ||
    market.startTime >= market.endTime
  ) return null;
  const sorted = validSamples(samples).sort((left, right) => left.timestamp - right.timestamp);
  const startMs = market.startTime * 1_000;
  const endMs = market.endTime * 1_000;
  let open = null;
  for (const sample of sorted) {
    const distance = Math.abs(sample.timestamp - startMs);
    if (distance > startToleranceMs) continue;
    if (!open || distance < Math.abs(open.timestamp - startMs)) open = sample;
  }
  if (!open) return null;
  let close = null;
  for (const sample of sorted) {
    if (sample.timestamp > endMs) break;
    close = sample;
  }
  if (!close || close.timestamp < open.timestamp) return null;
  if (endMs - close.timestamp > maxCloseLagMs) return null;
  if (close.value === open.value) return null;
  return {
    outcome: close.value > open.value ? 'UP' : 'DOWN',
    source: 'chainlink_twap_derived',
    openValue: open.value,
    closeValue: close.value,
    openTimestamp: open.timestamp,
    closeTimestamp: close.timestamp,
  };
}

export function applyOfficialSettlements(trades, settlements) {
  const winningSides = new Map();
  for (const settlement of settlements ?? []) {
    const marketId = settlement?.marketId != null ? String(settlement.marketId) : null;
    if (!marketId || !['UP', 'DOWN'].includes(settlement?.winningSide)) continue;
    winningSides.set(marketId, settlement.winningSide);
  }
  return trades.map((trade) => {
    const marketId = trade.market?.id != null ? String(trade.market.id) : null;
    const officialSide = marketId ? winningSides.get(marketId) : null;
    if (!officialSide) return trade;
    return {
      ...trade,
      resolution: trade.resolution
        ? { ...trade.resolution, outcome: officialSide, source: 'official' }
        : { outcome: officialSide, source: 'official' },
    };
  });
}

export function selectFirstActionablePerMarket(evaluations) {
  const selected = new Map();
  for (const event of evaluations) {
    const payload = event?.payload ?? event;
    const marketId = payload?.market?.id;
    const signal = payload?.signal;
    if (!Number.isSafeInteger(event?.receivedAt)) continue;
    if (!marketId || !signal || !['UP', 'DOWN'].includes(signal.side)) continue;
    if (selected.has(marketId)) continue;
    selected.set(marketId, { receivedAt: event.receivedAt, market: payload.market, signal });
  }
  return [...selected.values()].sort((left, right) => left.receivedAt - right.receivedAt);
}

export function resolveTradeOutcomes(trades, samples, options = {}) {
  return trades.map((trade) => ({
    ...trade,
    resolution: deriveMarketOutcome(samples, trade.market, options),
  }));
}

function scoreable(trade) {
  const probability = Number(trade?.signal?.estimatedProbability);
  return ['UP', 'DOWN'].includes(trade?.resolution?.outcome) &&
    ['UP', 'DOWN'].includes(trade?.signal?.side) &&
    Number.isFinite(probability) && probability > 0.5 && probability < 1;
}

export function scoreCalibration(trades) {
  const scored = (trades ?? []).filter(scoreable);
  const bins = Array.from({ length: BIN_COUNT }, (_, index) => {
    const lower = Number((0.5 + index * BIN_WIDTH).toFixed(2));
    const upper = Number((0.5 + (index + 1) * BIN_WIDTH).toFixed(2));
    return { range: `${lower.toFixed(2)}-${upper.toFixed(2)}`, count: 0, hits: 0, probabilitySum: 0 };
  });
  let brierSum = 0;
  let logLossSum = 0;
  let hits = 0;
  let probabilitySum = 0;
  for (const trade of scored) {
    const probability = Number(trade.signal?.estimatedProbability);
    const won = trade.signal.side === trade.resolution.outcome;
    const outcomeValue = won ? 1 : 0;
    brierSum += (probability - outcomeValue) ** 2;
    logLossSum -= outcomeValue * Math.log(Math.max(LOG_LOSS_CLAMP, probability))
      + (1 - outcomeValue) * Math.log(Math.max(LOG_LOSS_CLAMP, 1 - probability));
    hits += won ? 1 : 0;
    probabilitySum += probability;
    const binIndex = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((probability - 0.5) / BIN_WIDTH)));
    bins[binIndex].count += 1;
    bins[binIndex].probabilitySum += probability;
    bins[binIndex].hits += won ? 1 : 0;
  }
  const total = scored.length;
  return {
    scored: total,
    wins: hits,
    losses: total - hits,
    winRate: total === 0 ? null : hits / total,
    averageProbability: total === 0 ? null : probabilitySum / total,
    brier: total === 0 ? null : brierSum / total,
    logLoss: total === 0 ? null : logLossSum / total,
    bins: bins.map(({ range, count, hits: binHits, probabilitySum: binProbabilitySum }) => ({
      range,
      count,
      hits: binHits,
      hitRate: count === 0 ? null : binHits / count,
      averageProbability: count === 0 ? null : binProbabilitySum / count,
    })),
  };
}

export function simulateFixedStakeTrades(trades, { stake = 1, feeRate = 0.07 } = {}) {
  let costBasis = 0;
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  const perTrade = [];
  for (const trade of trades) {
    const entryPrice = Number(trade.signal?.entryPrice);
    if (!['UP', 'DOWN'].includes(trade.resolution?.outcome)) continue;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) continue;
    const shares = stake / entryPrice;
    const fee = Number((shares * feeRate * entryPrice * (1 - entryPrice)).toFixed(5));
    const totalCost = stake + fee;
    const won = trade.signal.side === trade.resolution.outcome;
    const pnl = (won ? shares : 0) - totalCost;
    realizedPnl += pnl;
    costBasis += totalCost;
    wins += won ? 1 : 0;
    losses += won ? 0 : 1;
    perTrade.push({
      marketId: trade.market.id,
      slug: trade.market.slug ?? null,
      side: trade.signal.side,
      strategy: trade.signal.strategy ?? null,
      regime: trade.signal.regime ?? null,
      timeframeMinutes: trade.market.timeframeMinutes ?? null,
      entryPrice,
      estimatedProbability: trade.signal.estimatedProbability ?? null,
      netEdge: trade.signal.netEdge ?? null,
      resolution: trade.resolution.outcome,
      won,
      pnl: Number(pnl.toFixed(6)),
    });
  }
  return {
    trades: perTrade.length,
    wins,
    losses,
    winRate: perTrade.length === 0 ? null : wins / perTrade.length,
    realizedPnl: Number(realizedPnl.toFixed(4)),
    roi: costBasis === 0 ? null : realizedPnl / costBasis,
    detail: perTrade,
  };
}

export function summarizeMomentumPersistence(samples, markets, {
  startToleranceMs = DEFAULT_START_TOLERANCE_MS,
  maxCloseLagMs = DEFAULT_MAX_CLOSE_LAG_MS,
} = {}) {
  const sorted = validSamples(samples).sort((left, right) => left.timestamp - right.timestamp);
  const counts = {
    UP_then_UP: 0,
    UP_then_DOWN: 0,
    DOWN_then_UP: 0,
    DOWN_then_DOWN: 0,
    flatEarlyMove: 0,
    unresolvable: 0,
  };
  if (!Array.isArray(markets)) return { windows: 0, ...counts, persistence: null };
  let directional = 0;
  for (const market of markets) {
    const resolution = deriveMarketOutcome(sorted, market, { startToleranceMs, maxCloseLagMs });
    if (!resolution) {
      counts.unresolvable += 1;
      continue;
    }
    const midpointSeconds = Math.floor((market.startTime + market.endTime) / 2);
    const midpointMs = midpointSeconds * 1_000;
    let mid = null;
    for (const sample of sorted) {
      if (sample.timestamp > midpointMs) break;
      mid = sample;
    }
    if (!mid || mid.timestamp < resolution.openTimestamp) {
      counts.unresolvable += 1;
      continue;
    }
    const earlyDirection = mid.value > resolution.openValue ? 'UP'
      : mid.value < resolution.openValue ? 'DOWN' : null;
    if (!earlyDirection) {
      counts.flatEarlyMove += 1;
      continue;
    }
    directional += 1;
    const key = `${earlyDirection}_then_${resolution.outcome}`;
    counts[key] += 1;
  }
  const agreeing = counts.UP_then_UP + counts.DOWN_then_DOWN;
  return {
    windows: markets.length,
    ...counts,
    persistence: directional === 0 ? null : agreeing / directional,
  };
}
