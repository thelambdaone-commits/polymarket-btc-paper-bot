function validProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function observations(history) {
  return (Array.isArray(history) ? history : []).filter((item) =>
    item?.status === 'SETTLED' && validProbability(Number(item.estimatedProbability)) &&
    ['UP', 'DOWN'].includes(item.side) && ['UP', 'DOWN'].includes(item.winningSide),
  );
}

export function calculateCalibrationMetrics(history) {
  const items = observations(history);
  if (items.length === 0) return { samples: 0, brierScore: null, logLoss: null, ece: null, reliability: [] };
  const bins = Array.from({ length: 10 }, () => ({ count: 0, probability: 0, outcome: 0 }));
  let brier = 0;
  let logLoss = 0;
  for (const item of items) {
    const probability = Number(item.estimatedProbability);
    const p = item.side === 'UP' ? probability : 1 - probability;
    const outcome = item.side === item.winningSide ? 1 : 0;
    brier += (p - outcome) ** 2;
    logLoss -= outcome * Math.log(Math.max(1e-12, p)) + (1 - outcome) * Math.log(Math.max(1e-12, 1 - p));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count += 1;
    bin.probability += p;
    bin.outcome += outcome;
  }
  const reliability = bins.filter((bin) => bin.count > 0).map((bin) => ({
    samples: bin.count,
    meanProbability: Number((bin.probability / bin.count).toFixed(6)),
    observedRate: Number((bin.outcome / bin.count).toFixed(6)),
  }));
  const ece = bins.reduce((total, bin) => bin.count === 0 ? total : total +
    (bin.count / items.length) * Math.abs(bin.probability / bin.count - bin.outcome / bin.count), 0);
  return {
    samples: items.length,
    brierScore: Number((brier / items.length).toFixed(8)),
    logLoss: Number((logLoss / items.length).toFixed(8)),
    ece: Number(ece.toFixed(8)),
    reliability,
  };
}
