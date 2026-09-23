function validProbability(value) {
  return Number.isFinite(value) && value > 0 && value < 1;
}

export function takerFee(shares, price, feeRate) {
  if (!Number.isFinite(shares) || shares < 0 || !validProbability(price)) return Number.NaN;
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) return Number.NaN;
  return Number((shares * feeRate * price * (1 - price)).toFixed(5));
}

export function detectCompleteSetArbitrage(input) {
  const { upAsk, downAsk, upSize, downSize, feeRate, buffer } = input;
  if (
    !validProbability(upAsk) ||
    !validProbability(downAsk) ||
    !Number.isFinite(upSize) || upSize <= 0 ||
    !Number.isFinite(downSize) || downSize <= 0 ||
    !Number.isFinite(buffer) || buffer < 0
  ) return null;

  const feePerShare = takerFee(1, upAsk, feeRate) + takerFee(1, downAsk, feeRate);
  const edgePerShare = 1 - upAsk - downAsk - feePerShare - buffer;
  if (edgePerShare <= 0) return null;
  const shares = Math.min(upSize, downSize);
  return {
    shares,
    upAsk,
    downAsk,
    feePerShare: Number(feePerShare.toFixed(8)),
    edgePerShare: Number(edgePerShare.toFixed(8)),
    expectedPnl: Number((shares * edgePerShare).toFixed(2)),
  };
}
