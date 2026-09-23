import { calculateCalibrationMetrics } from './calibration-metrics.js';

function round(value, digits = 8) {
  return Number(value.toFixed(digits));
}

function breakdown(history, key) {
  const groups = new Map();
  for (const item of history.filter((entry) => entry.status === 'SETTLED')) {
    const group = item[key] ?? 'unknown';
    const current = groups.get(group) ?? { group, settled: 0, wins: 0, pnl: 0 };
    current.settled += 1;
    current.wins += item.side === item.winningSide ? 1 : 0;
    current.pnl += Number(item.pnl) || 0;
    groups.set(group, current);
  }
  return [...groups.values()].map((item) => ({
    ...item,
    winRate: round(item.wins / item.settled, 6),
    pnl: round(item.pnl, 2),
  }));
}

export function buildMetricsReport({ history = [], initialBalance = null } = {}) {
  const settled = history.filter((item) => item.status === 'SETTLED' && Number.isFinite(Number(item.pnl)));
  const returns = settled.map((item) => Number(item.pnl) / Math.max(1e-9, Number(item.stake) + Number(item.fee || 0)));
  let equity = Number(initialBalance) || 0;
  let peak = equity;
  let maxDrawdown = 0;
  for (const item of settled) {
    equity += Number(item.pnl);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const mean = returns.length === 0 ? 0 : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length < 2 ? 0 : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return {
    generatedAt: new Date().toISOString(),
    samples: settled.length,
    realizedPnl: round(settled.reduce((sum, item) => sum + Number(item.pnl), 0), 2),
    maxDrawdown: round(maxDrawdown, 2),
    sharpePerTrade: returns.length < 2 || variance === 0 ? null : round(mean / Math.sqrt(variance), 6),
    calibration: calculateCalibrationMetrics(history),
    byTimeframe: breakdown(history, 'timeframeMinutes'),
    byRegime: breakdown(history, 'regime'),
    byStrategy: breakdown(history, 'strategy'),
  };
}
