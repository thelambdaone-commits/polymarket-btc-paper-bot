function clamp(value) {
  return Math.min(0.999, Math.max(0.001, value));
}

function logit(value) {
  return Math.log(value / (1 - value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function applyBayesianAnchor(signal, quote, { damping = 0.65 } = {}) {
  if (!signal || signal.side === 'HOLD') return signal;
  const modelProbability = Number(signal.adjustedProbability ?? signal.estimatedProbability);
  const midpoint = Number(quote?.midpointUp);
  if (!Number.isFinite(modelProbability) || modelProbability <= 0 || modelProbability >= 1 ||
    !Number.isFinite(midpoint) || midpoint <= 0 || midpoint >= 1 || !Number.isFinite(damping)) return signal;
  const posterior = clamp(sigmoid(logit(midpoint) + (logit(modelProbability) - logit(midpoint)) * damping));
  const sideProbability = signal.side === 'UP' ? posterior : 1 - posterior;
  return {
    ...signal,
    estimatedProbability: Number(sideProbability.toFixed(6)),
    adjustedProbability: Number(sideProbability.toFixed(6)),
    bayesianPrior: Number(midpoint.toFixed(6)),
    bayesianDamping: damping,
  };
}
