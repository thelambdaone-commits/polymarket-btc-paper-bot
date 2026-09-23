function clamp(value) {
  return Math.min(0.999, Math.max(0.001, value));
}

export function calibrateSignal(signal, history, timeframeMinutes, config) {
  if (!signal || signal.side === 'HOLD') return signal;
  const sameStrategyAndTimeframe = (item) =>
    item.timeframeMinutes === timeframeMinutes && item.strategy === signal.strategy;
  if (history.some(
    (item) => item.status === 'PENDING' && sameStrategyAndTimeframe(item),
  )) {
    return {
      ...signal,
      side: 'HOLD',
      reason: 'awaiting_strategy_feedback',
      adjustedProbability: Number(signal.estimatedProbability.toFixed(6)),
      calibrationBias: 0,
      cohortSamples: 0,
    };
  }
  const cohort = history.filter(
    (item) =>
      item.status === 'SETTLED' &&
      sameStrategyAndTimeframe(item) &&
      Number.isFinite(item.estimatedProbability),
  );

  let adjustedProbability = signal.estimatedProbability;
  let calibrationBias = 0;
  if (cohort.length > 0) {
    calibrationBias = cohort.reduce((total, item) => {
      const observed = item.winningSide === item.side ? 1 : 0;
      return total + observed - item.estimatedProbability;
    }, 0) / cohort.length;
    const priorStrength = Math.max(20, config.minimumLearningSamples * 4);
    const shrinkage = cohort.length / (cohort.length + priorStrength);
    adjustedProbability = clamp(signal.estimatedProbability + calibrationBias * shrinkage);
  }

  const feePerShare = config.feeRate * signal.entryPrice * (1 - signal.entryPrice);
  const netEdge = adjustedProbability - signal.entryPrice - feePerShare - config.edgeBuffer;
  if (netEdge <= 0) {
    return {
      ...signal,
      side: 'HOLD',
      reason: 'learning_removed_edge',
      adjustedProbability: Number(adjustedProbability.toFixed(6)),
      calibrationBias: Number(calibrationBias.toFixed(6)),
      cohortSamples: cohort.length,
      netEdge: Number(netEdge.toFixed(6)),
    };
  }
  return {
    ...signal,
    adjustedProbability: Number(adjustedProbability.toFixed(6)),
    calibrationBias: Number(calibrationBias.toFixed(6)),
    cohortSamples: cohort.length,
    netEdge: Number(netEdge.toFixed(6)),
  };
}
