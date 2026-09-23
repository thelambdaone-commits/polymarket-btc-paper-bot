export function classifyRegime({ oracle, features } = {}) {
  const samples = Array.isArray(oracle?.samples) ? oracle.samples : [];
  const move = Number(oracle?.currentPrice) / Number(oracle?.startPrice) - 1;
  const twapDeviation = Number(features?.twapDeviation ?? 0);
  if (!Number.isFinite(move) || samples.length < 5) {
    return { regime: 'insufficient_data', confidence: 0, tradeAllowed: false };
  }
  const changes = samples.slice(1).map((value, index) => value / samples[index] - 1);
  const path = changes.reduce((total, value) => total + Math.abs(value), 0);
  const efficiency = path === 0 ? 0 : Math.min(1, Math.abs(move) / path);
  const volatility = Math.sqrt(changes.reduce((total, value) => total + value ** 2, 0) / changes.length);
  if (efficiency < 0.25 && Math.abs(twapDeviation) > 0.0025) {
    return { regime: 'trap', confidence: Number((1 - efficiency).toFixed(6)), tradeAllowed: false };
  }
  if (efficiency < 0.45) {
    return { regime: 'ranging', confidence: Number((1 - efficiency).toFixed(6)), tradeAllowed: false };
  }
  if (volatility > 0.0015) {
    return { regime: 'volatile', confidence: Number(Math.min(1, volatility / 0.003).toFixed(6)), tradeAllowed: true };
  }
  if (Math.abs(move) >= 0.001) {
    return { regime: efficiency > 0.7 ? 'trending' : 'mild_trend', confidence: Number(efficiency.toFixed(6)), tradeAllowed: true };
  }
  return { regime: 'news_driven', confidence: Number(efficiency.toFixed(6)), tradeAllowed: true };
}
