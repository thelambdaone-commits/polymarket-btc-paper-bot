export class PaperPortfolio {
  constructor(balance, stake, initialBalance = balance) {
    this.balance = balance;
    this.initialBalance = initialBalance;
    this.stake = stake;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
    this.predictionHistory = [];
    this.arbitrageHistory = [];
  }

  open(market, side, price, feeRate = 0, metadata = {}) {
    if (!['UP', 'DOWN'].includes(side) || !Number.isFinite(price) || price <= 0 || price >= 1) {
      return null;
    }
    const entryPrice = price;
    const stake = Number.isFinite(metadata.stake) ? metadata.stake : this.stake;
    if (stake <= 0) return null;
    const suppliedFill = metadata.fill;
    if (suppliedFill && (
      !Number.isFinite(suppliedFill.shares) || suppliedFill.shares <= 0 ||
      !Number.isFinite(suppliedFill.averagePrice) ||
      Math.abs(suppliedFill.averagePrice - entryPrice) > 1e-6 ||
      !Number.isFinite(suppliedFill.fee) || suppliedFill.fee < 0 ||
      !Number.isFinite(suppliedFill.totalCost) || suppliedFill.totalCost < stake ||
      Math.abs(suppliedFill.totalCost - stake - suppliedFill.fee) > 1e-6
    )) return null;
    const shares = suppliedFill?.shares ?? stake / entryPrice;
    const fee = suppliedFill?.fee ?? Number(
      (shares * feeRate * entryPrice * (1 - entryPrice)).toFixed(5),
    );
    const totalCost = suppliedFill?.totalCost ?? Number((stake + fee).toFixed(8));
    if (this.positions.has(market.id) || this.balance < totalCost) return null;
    const position = {
      marketId: market.id,
      slug: market.slug,
      side,
      entryPrice,
      stake,
      shares,
      fee: Number(fee.toFixed(5)),
      totalCost: Number(totalCost.toFixed(5)),
      endTime: market.endTime ?? null,
    };
    this.balance -= totalCost;
    this.positions.set(market.id, position);
    this.predictionHistory.push({
      marketId: market.id,
      slug: market.slug,
      side,
      timeframeMinutes: metadata.timeframeMinutes ?? market.timeframeMinutes ?? null,
      createdAt: metadata.createdAt ?? Date.now(),
      entryPrice,
      estimatedProbability: metadata.estimatedProbability ?? null,
      netEdge: metadata.netEdge ?? null,
      ...(metadata.strategy ? { strategy: String(metadata.strategy) } : {}),
      ...(metadata.regime ? { regime: String(metadata.regime) } : {}),
      ...(suppliedFill ? { fill: { ...suppliedFill } } : {}),
      stake,
      fee: position.fee,
      status: 'PENDING',
    });
    return position;
  }

  settle(marketId, winningSide, settledAt = Date.now()) {
    const position = this.positions.get(marketId);
    if (!position || !['UP', 'DOWN'].includes(winningSide)) return null;

    const won = position.side === winningSide;
    const payout = won ? position.shares : 0;
    this.balance += payout;
    this.positions.delete(marketId);
    if (won) this.wins += 1;
    else this.losses += 1;
    const result = {
      ...position,
      winningSide,
      pnl: Number((payout - position.totalCost).toFixed(2)),
    };
    const prediction = this.predictionHistory.find(
      (item) => item.marketId === marketId && item.status === 'PENDING',
    );
    if (prediction) Object.assign(prediction, {
      status: 'SETTLED',
      settledAt,
      winningSide,
      pnl: result.pnl,
    });
    return result;
  }

  stats() {
    const resolved = this.wins + this.losses;
    const settled = this.predictionHistory.filter((item) => item.status === 'SETTLED');
    const realizedPnl = settled.reduce((total, item) => total + item.pnl, 0);
    const settledCost = settled.reduce((total, item) => total + item.stake + item.fee, 0);
    const committedCapital = [...this.positions.values()].reduce(
      (total, position) => total + position.totalCost,
      0,
    );
    const grossProfit = settled.reduce((total, item) => total + Math.max(0, item.pnl), 0);
    const grossLoss = Math.abs(
      settled.reduce((total, item) => total + Math.min(0, item.pnl), 0),
    );
    const recentForm = settled.slice(-5).map((item) => item.side === item.winningSide ? 'W' : 'L');
    const timeframes = new Map();
    for (const item of settled) {
      const timeframeMinutes = item.timeframeMinutes ?? null;
      const current = timeframes.get(timeframeMinutes) ?? {
        timeframeMinutes,
        settled: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
      };
      const won = item.side === item.winningSide;
      current.settled += 1;
      current.wins += won ? 1 : 0;
      current.losses += won ? 0 : 1;
      current.realizedPnl += item.pnl;
      timeframes.set(timeframeMinutes, current);
    }
    const timeframeBreakdown = [...timeframes.values()]
      .sort((left, right) => (left.timeframeMinutes ?? Infinity) - (right.timeframeMinutes ?? Infinity))
      .map((item) => ({
        ...item,
        winRate: item.wins / item.settled,
        realizedPnl: Number(item.realizedPnl.toFixed(2)),
      }));
    return {
      balance: Number(this.balance.toFixed(2)),
      committedCapital: Number(committedCapital.toFixed(2)),
      openPositions: this.positions.size,
      wins: this.wins,
      losses: this.losses,
      winRate: resolved === 0 ? null : this.wins / resolved,
      predictions: this.predictionHistory.length,
      settledPredictions: settled.length,
      realizedPnl: Number(realizedPnl.toFixed(2)),
      roi: settledCost === 0 ? null : realizedPnl / settledCost,
      averagePnl: settled.length === 0 ? null : Number((realizedPnl / settled.length).toFixed(2)),
      profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
      recentForm,
      timeframeBreakdown,
      arbitrageOpportunities: this.arbitrageHistory.length,
    };
  }

  history() {
    return this.predictionHistory.map((item) => ({ ...item }));
  }

  openPositions() {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  recordArbitrage(market, opportunity, observedAt = Date.now()) {
    if (this.arbitrageHistory.some((item) => item.marketId === market.id)) return null;
    const record = {
      marketId: market.id,
      slug: market.slug,
      timeframeMinutes: market.timeframeMinutes,
      observedAt,
      ...opportunity,
    };
    this.arbitrageHistory.push(record);
    return { ...record };
  }

  snapshot() {
    return {
      version: 1,
      balance: this.balance,
      initialBalance: this.initialBalance,
      stake: this.stake,
      wins: this.wins,
      losses: this.losses,
      positions: [...this.positions.values()],
      history: this.history(),
      arbitrageHistory: this.arbitrageHistory.map((item) => ({ ...item })),
    };
  }

  static restore(state) {
    if (
      !state || state.version !== 1 ||
      !Number.isFinite(state.balance) || state.balance < 0 ||
      !Number.isFinite(state.stake) || state.stake <= 0 ||
      !Number.isFinite(state.initialBalance) || state.initialBalance <= 0 ||
      !Number.isSafeInteger(state.wins) || state.wins < 0 ||
      !Number.isSafeInteger(state.losses) || state.losses < 0 ||
      !Array.isArray(state.positions) || !Array.isArray(state.history) ||
      !Array.isArray(state.arbitrageHistory)
    ) throw new Error('Invalid paper portfolio state');
    const portfolio = new PaperPortfolio(state.balance, state.stake, state.initialBalance);
    portfolio.wins = state.wins;
    portfolio.losses = state.losses;
    for (const position of state.positions) {
      if (!position?.marketId || portfolio.positions.has(position.marketId)) {
        throw new Error('Invalid paper position state');
      }
      portfolio.positions.set(position.marketId, Object.freeze({ ...position }));
    }
    portfolio.predictionHistory = state.history.map((item) => ({ ...item }));
    portfolio.arbitrageHistory = state.arbitrageHistory.map((item) => ({ ...item }));
    return portfolio;
  }
}
