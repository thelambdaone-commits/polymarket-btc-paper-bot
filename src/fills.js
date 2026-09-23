function validAsks(asks) {
  if (!Array.isArray(asks)) return [];
  return asks
    .map((level) => ({ price: Number(level?.price), size: Number(level?.size) }))
    .filter(({ price, size }) => price > 0 && price < 1 && size > 0)
    .sort((left, right) => left.price - right.price);
}

export function simulateTakerFill({ stake, asks, feeRate, maximumSlippage }) {
  if (
    !Number.isFinite(stake) || stake <= 0 ||
    !Number.isFinite(feeRate) || feeRate < 0 ||
    !Number.isFinite(maximumSlippage) || maximumSlippage < 0
  ) return null;
  const levels = validAsks(asks);
  if (levels.length === 0) return null;
  const bestPrice = levels[0].price;
  let remaining = stake;
  let shares = 0;
  let fee = 0;
  let levelsConsumed = 0;
  for (const level of levels) {
    if ((level.price - bestPrice) / bestPrice > maximumSlippage) break;
    const cost = Math.min(remaining, level.price * level.size);
    if (cost <= 0) continue;
    const levelShares = cost / level.price;
    shares += levelShares;
    fee += levelShares * feeRate * level.price * (1 - level.price);
    remaining -= cost;
    levelsConsumed += 1;
    if (remaining <= 1e-9) break;
  }
  if (remaining > 1e-9 || shares <= 0) return null;
  const averagePrice = stake / shares;
  return {
    shares: Number(shares.toFixed(8)),
    averagePrice: Number(averagePrice.toFixed(6)),
    fee: Number(fee.toFixed(5)),
    totalCost: Number((stake + fee).toFixed(8)),
    levelsConsumed,
  };
}

export function applyFillToSignal(signal, fill, config) {
  if (!signal || signal.side === 'HOLD' || !fill) return signal;
  const probability = Number(signal.adjustedProbability ?? signal.estimatedProbability);
  const feePerShare = fill.fee / fill.shares;
  const netEdge = probability - fill.averagePrice - feePerShare - config.edgeBuffer;
  if (!Number.isFinite(netEdge) || netEdge <= 0) {
    return {
      ...signal,
      side: 'HOLD',
      reason: 'fill_removed_edge',
      entryPrice: fill.averagePrice,
      netEdge: Number(netEdge.toFixed(6)),
      fill,
    };
  }
  return {
    ...signal,
    entryPrice: fill.averagePrice,
    netEdge: Number(netEdge.toFixed(6)),
    fill,
  };
}
