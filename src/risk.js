function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateFractionalKelly({
  probability,
  entryPrice,
  bankroll,
  fraction = 0.25,
  maximumStake,
  feeRate = 0,
}) {
  if (![probability, entryPrice, bankroll, fraction, maximumStake].every(Number.isFinite) ||
    probability <= 0 || probability >= 1 || entryPrice <= 0 || entryPrice >= 1 || bankroll <= 0 ||
    fraction <= 0 || maximumStake <= 0 || !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) return 0;
  const effectivePrice = entryPrice + feeRate * entryPrice * (1 - entryPrice);
  if (effectivePrice >= 1) return 0;
  const odds = (1 - effectivePrice) / effectivePrice;
  const rawFraction = (odds * probability - (1 - probability)) / odds;
  if (rawFraction <= 0) return 0;
  return Number(clamp(bankroll * rawFraction * fraction, 0, maximumStake).toFixed(8));
}

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function evaluatePaperRisk({ portfolio, market, signal, now = Date.now(), config }) {
  if (!portfolio || !market || !signal || signal.side === 'HOLD') {
    return { allowed: false, reason: 'invalid_signal', stake: 0 };
  }
  if (portfolio.openPositions().some((position) => position.marketId === market.id)) {
    return { allowed: false, reason: 'market_already_open', stake: 0 };
  }
  const history = portfolio.history();
  const todayLoss = history
    .filter((item) => item.status === 'SETTLED' && item.settledAt && utcDay(item.settledAt) === utcDay(now))
    .reduce((total, item) => total + Math.min(0, Number(item.pnl) || 0), 0);
  if (Math.abs(todayLoss) >= config.maxDailyLoss) {
    return { allowed: false, reason: 'daily_loss_limit', stake: 0, todayLoss };
  }
  const recent = history.filter((item) => item.status === 'SETTLED').slice(-config.maxConsecutiveLosses);
  if (recent.length >= config.maxConsecutiveLosses && recent.every((item) => item.side !== item.winningSide)) {
    return { allowed: false, reason: 'loss_streak_cooldown', stake: 0 };
  }
  const committed = portfolio.stats().committedCapital;
  if (committed >= config.maxOpenExposure) {
    return { allowed: false, reason: 'open_exposure_limit', stake: 0 };
  }
  const remainingExposure = config.maxOpenExposure - committed;
  const maximumStake = Math.min(config.maxStake, remainingExposure, portfolio.balance);
  const probability = Number(signal.adjustedProbability ?? signal.estimatedProbability);
  const stake = calculateFractionalKelly({
    probability,
    entryPrice: signal.entryPrice,
    bankroll: portfolio.balance,
    fraction: config.kellyFraction,
    maximumStake,
    feeRate: config.feeRate,
  });
  if (stake < config.minimumStake) return { allowed: false, reason: 'risk_size_below_minimum', stake: 0 };
  return { allowed: true, reason: 'risk_limits_passed', stake, todayLoss };
}
