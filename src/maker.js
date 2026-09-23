export function simulateMakerFill({ orderPrice, orderSize, bestBid, bestAsk, queueAhead = 0, matchedVolume = 0,
  latencyMs = 0, adverseSelectionBps = 0 } = {}) {
  if (![orderPrice, orderSize, bestBid, bestAsk, queueAhead, matchedVolume, latencyMs, adverseSelectionBps]
    .every(Number.isFinite) || orderPrice <= 0 || orderPrice >= 1 || orderSize <= 0 || bestBid <= 0 ||
    bestAsk <= bestBid || queueAhead < 0 || matchedVolume < 0 || latencyMs < 0 || adverseSelectionBps < 0) {
    return null;
  }
  if (orderPrice > bestBid || orderPrice >= bestAsk) {
    return { filled: 0, remaining: orderSize, status: 'not_maker' };
  }
  const executable = Math.max(0, matchedVolume - queueAhead);
  const filled = Math.min(orderSize, executable);
  const adversePrice = Number((orderPrice + orderPrice * adverseSelectionBps / 10_000).toFixed(8));
  return {
    filled: Number(filled.toFixed(8)),
    remaining: Number((orderSize - filled).toFixed(8)),
    status: filled >= orderSize ? 'filled' : filled > 0 ? 'partial' : 'queued',
    effectivePrice: adversePrice,
    latencyMs,
    queueAhead,
  };
}
