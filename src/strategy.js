export function evaluateTrend(samples, threshold) {
  if (
    !Array.isArray(samples) ||
    samples.length < 2 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    samples.some((price) => !Number.isFinite(price) || price < 0 || price > 1)
  ) {
    return { side: 'HOLD', change: 0 };
  }

  const change = Number((samples.at(-1) - samples[0]).toFixed(6));
  if (change >= threshold) return { side: 'UP', change };
  if (change <= -threshold) return { side: 'DOWN', change };
  return { side: 'HOLD', change };
}

function adaptiveSignal(side, strategy, regime, estimatedProbability, quote, config) {
  const entryPrice = side === 'UP' ? quote.upAsk : quote.downAsk;
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice < config.minimumEntryPrice ||
    entryPrice > config.maximumEntryPrice
  ) return { side: 'HOLD', reason: 'entry_outside_range', strategy, regime };
  const feePerShare = config.feeRate * entryPrice * (1 - entryPrice);
  const netEdge = estimatedProbability - entryPrice - feePerShare - config.edgeBuffer;
  if (netEdge <= 0) return { side: 'HOLD', reason: 'no_net_edge', strategy, regime };
  return {
    side,
    entryPrice,
    estimatedProbability: Number(estimatedProbability.toFixed(6)),
    netEdge: Number(netEdge.toFixed(6)),
    strategy,
    regime,
  };
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741)
    * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * approximation);
}

export function estimateExpiryProbability(
  samples,
  startPrice,
  projectedPrice,
  secondsRemaining,
  sampleIntervalSeconds = 30,
) {
  const logReturns = samples.slice(1).map(
    (value, index) => Math.log(value / samples[index]),
  );
  const observedVariance = logReturns.reduce((total, value) => total + value ** 2, 0)
    / Math.max(1, logReturns.length);
  // Chainlink's 30-second TWAP is deliberately smooth. The floor prevents that smoothing from
  // producing unrealistically certain predictions when only a few seconds of data are available.
  const intervalSeconds = Number.isFinite(sampleIntervalSeconds) && sampleIntervalSeconds > 0
    ? sampleIntervalSeconds : 30;
  const volatilityPerRootSecond = Math.max(0.000001, Math.sqrt(observedVariance / intervalSeconds));
  const expiryDeviation = volatilityPerRootSecond * Math.sqrt(Math.max(1, secondsRemaining));
  return normalCdf(Math.log(projectedPrice / startPrice) / expiryDeviation);
}

export function evaluateAdaptiveStrategy(oracle, quote, market, nowSeconds, config) {
  if (!oracle?.fresh) return { side: 'HOLD', reason: 'stale_oracle' };
  if (!Number.isFinite(oracle.startPrice)) return { side: 'HOLD', reason: 'missing_oracle_start' };
  if (
    !Number.isFinite(oracle.currentPrice) ||
    !Number.isFinite(oracle.twap60) ||
    !Array.isArray(oracle.samples) || oracle.samples.length < 5
  ) return { side: 'HOLD', reason: 'insufficient_oracle_history' };
  if (nowSeconds - market.startTime < 20 || market.endTime - nowSeconds < 15) {
    return { side: 'HOLD', reason: 'outside_entry_window' };
  }

  const returns = oracle.samples.slice(1).map(
    (value, index) => Math.abs(value / oracle.samples[index] - 1),
  );
  const pathMove = returns.reduce((total, value) => total + value, 0);
  const netMove = oracle.currentPrice / oracle.startPrice - 1;
  const efficiency = pathMove === 0 ? 0 : Math.min(1, Math.abs(netMove) / pathMove);
  const secondsRemaining = market.endTime - nowSeconds;

  if (efficiency >= 0.5 && Math.abs(netMove) >= 0.0003) {
    const side = netMove > 0 ? 'UP' : 'DOWN';
    const upProbability = estimateExpiryProbability(
      oracle.samples,
      oracle.startPrice,
      oracle.currentPrice,
      secondsRemaining,
      oracle.sampleIntervalSeconds,
    );
    const probability = side === 'UP' ? upProbability : 1 - upProbability;
    return adaptiveSignal(side, 'trend_following', 'directional', probability, quote, config);
  }

  const twapDeviation = oracle.currentPrice / oracle.twap60 - 1;
  if (efficiency <= 0.4 && Math.abs(twapDeviation) >= 0.003) {
    const projectedPrice = (oracle.currentPrice + oracle.twap60) / 2;
    const projectedMove = projectedPrice / oracle.startPrice - 1;
    if (Math.abs(projectedMove) < 0.0005) {
      return { side: 'HOLD', reason: 'uncertain_reversion', strategy: 'mean_reversion' };
    }
    const side = projectedMove > 0 ? 'UP' : 'DOWN';
    const probability = 0.5 + Math.min(
      0.2,
      Math.abs(projectedMove) * 40 + (1 - efficiency) * 0.08,
    );
    return adaptiveSignal(side, 'mean_reversion', 'choppy', probability, quote, config);
  }

  return { side: 'HOLD', reason: 'no_regime_edge', strategy: 'market_making_observation' };
}
