function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function depth(levels, count = 3) {
  if (!Array.isArray(levels)) return 0;
  return levels.slice(0, count).reduce((total, level) => total + Math.max(0, finite(level?.size) ?? 0), 0);
}

export function extractClobFeatures(quote, { secondsRemaining = null } = {}) {
  const upBid = finite(quote?.upBid);
  const upAsk = finite(quote?.upAsk);
  const downBid = finite(quote?.downBid);
  const downAsk = finite(quote?.downAsk);
  if ([upBid, upAsk, downBid, downAsk].some((value) => value === null)) return null;
  if (upBid <= 0 || upAsk >= 1 || downBid <= 0 || downAsk >= 1 || upBid > upAsk || downBid > downAsk) {
    return null;
  }
  const midpoint = (upBid + upAsk) / 2;
  const spread = upAsk - upBid;
  const downMidpoint = (downBid + downAsk) / 2;
  const upDepth = depth(quote?.upAsks) + Math.max(0, finite(quote?.upBidSize) ?? 0);
  const downDepth = depth(quote?.downAsks) + Math.max(0, finite(quote?.downBidSize) ?? 0);
  const totalDepth = upDepth + downDepth;
  return {
    midpointUp: Number(midpoint.toFixed(6)),
    spread: Number(spread.toFixed(6)),
    downSpread: Number((downAsk - downBid).toFixed(6)),
    micropriceUp: Number(((upAsk * (finite(quote?.upBidSize) ?? 0) + upBid * (finite(quote?.upSize) ?? 0))
      / Math.max(1e-9, (finite(quote?.upBidSize) ?? 0) + (finite(quote?.upSize) ?? 0))).toFixed(6)),
    imbalance: totalDepth === 0 ? 0 : Number(((upDepth - downDepth) / totalDepth).toFixed(6)),
    upDepth: Number(upDepth.toFixed(6)),
    downDepth: Number(downDepth.toFixed(6)),
    complementMidpoint: Number((1 - downMidpoint).toFixed(6)),
    secondsRemaining: Number.isFinite(secondsRemaining) ? Math.max(0, secondsRemaining) : null,
  };
}

export function extractMarketFeatures({ oracle, quote, market, nowSeconds }) {
  const features = extractClobFeatures(quote, {
    secondsRemaining: Number(market?.endTime) - Number(nowSeconds),
  });
  if (!features) return null;
  const current = finite(oracle?.currentPrice);
  const start = finite(oracle?.startPrice);
  const twap = finite(oracle?.twap60);
  return {
    ...features,
    oracleMove: current !== null && start > 0 ? Number((current / start - 1).toFixed(8)) : null,
    twapDeviation: current !== null && twap > 0 ? Number((current / twap - 1).toFixed(8)) : null,
    sampleCount: Array.isArray(oracle?.samples) ? oracle.samples.length : 0,
    timeframeMinutes: Number(market?.timeframeMinutes) || null,
  };
}
