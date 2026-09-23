const TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{20,}$/;

export function parseTelegramConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  if (!env.TELEGRAM_ADMIN_ID) throw new Error('TELEGRAM_ADMIN_ID is required');
  if (!TOKEN_PATTERN.test(token)) throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
  if (!/^-?\d+$/.test(env.TELEGRAM_ADMIN_ID)) {
    throw new Error('TELEGRAM_ADMIN_ID must be an integer');
  }
  return Object.freeze({ token, adminId: Number(env.TELEGRAM_ADMIN_ID) });
}

export function routeCommand(message, adminId) {
  if (!message || message.chatId !== adminId) return { type: 'ignore' };
  const command = String(message.text ?? '').trim().split(/\s+/, 1)[0].split('@', 1)[0];
  if (command === '/status' || command === '/start') return { type: 'status' };
  return { type: 'help' };
}

export function formatStatus(stats) {
  const money = (value, signed = false) => {
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${value.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} $`;
  };
  const percent = (value, signed = false) => {
    if (value === null || value === undefined) return '—';
    const numeric = (value * 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${signed && value > 0 ? '+' : ''}${numeric} %`;
  };
  const metric = (label, value) => `${label.padEnd(22)}${value}`;
  const recentForm = (stats.recentForm ?? []).map((result) => result === 'W' ? '✅' : '❌');
  const settled = stats.settledPredictions ?? 0;
  const timeframeLines = (stats.timeframeBreakdown ?? []).map((item) => {
    const label = item.timeframeMinutes === null ? 'Autre' : `${item.timeframeMinutes} min`;
    return metric(
      label,
      `${item.wins}V · ${item.losses}D · ${percent(item.winRate)} · ${money(item.realizedPnl, true)}`,
    );
  });

  return [
    '🤖 PAPER PREDICTION BOT',
    '🟢 EN LIGNE  ·  🧪 SIMULATION UNIQUEMENT',
    '',
    '💼 PORTEFEUILLE',
    metric('Cash disponible', money(stats.balance)),
    metric('Capital engagé', money(stats.committedCapital ?? 0)),
    metric('P&L réalisé', money(stats.realizedPnl, true)),
    metric('ROI réalisé', percent(stats.roi, true)),
    '',
    '📊 PERFORMANCE',
    metric('Prédictions', String(stats.predictions)),
    metric('Réglées / ouvertes', `${settled} / ${stats.openPositions}`),
    metric('Victoires / défaites', `${stats.wins} / ${stats.losses}`),
    metric('Taux de réussite', percent(stats.winRate)),
    metric('P&L moyen / pari', stats.averagePnl === null ? '—' : money(stats.averagePnl, true)),
    metric(
      'Facteur de profit',
      stats.profitFactor === null ? '—' : stats.profitFactor.toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ),
    metric('Forme récente', recentForm.length === 0 ? '—' : recentForm.join(' ')),
    '',
    ...(timeframeLines.length === 0 ? [] : ['⏱ PERFORMANCE PAR HORIZON', ...timeframeLines, '']),
    `🎯 Sure bets observés   ${stats.arbitrageOpportunities ?? 0}`,
  ].join('\n');
}

export function formatSettlement(result) {
  const won = result.side === result.winningSide;
  const pnl = `${result.pnl > 0 ? '+' : ''}${result.pnl.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
  const side = (value) => value === 'UP' ? '📈 HAUSSE' : '📉 BAISSE';
  return [
    won ? '✅ PRÉDICTION GAGNÉE' : '❌ PRÉDICTION PERDUE',
    '',
    `Marché       ${result.slug}`,
    `Prédiction   ${side(result.side)}`,
    `Résultat     ${side(result.winningSide)}`,
    `P&L réalisé  ${pnl}`,
  ].join('\n');
}

export function formatSignal(position, signal) {
  const strategy = signal.strategy ? String(signal.strategy).replaceAll('_', ' ') : null;
  return [
    `📣 NOUVELLE PRÉDICTION PAPER · ${position.side === 'UP' ? '📈 HAUSSE' : '📉 BAISSE'}`,
    '',
    `Marché     ${position.slug}`,
    `Entrée     ${(position.entryPrice * 100).toFixed(1)} ¢`,
    `Mise       ${position.stake.toFixed(2)} $`,
    `Probabilité estimée  ${(signal.adjustedProbability * 100).toFixed(1)} %`,
    `Avantage net estimé  ${(signal.netEdge * 100).toFixed(2)} points`,
    ...(strategy ? [
      `Stratégie   ${strategy}`,
      `Régime      ${signal.regime ?? 'indéterminé'}`,
    ] : []),
    `Échantillon du modèle  ${signal.cohortSamples}`,
  ].join('\n');
}

export function formatArbitrage(record) {
  return [
    '🎯 SURE BET POTENTIEL · OBSERVATION PAPER',
    '',
    `Marché               ${record.slug}`,
    `Ask HAUSSE + BAISSE  ${((record.upAsk + record.downAsk) * 100).toFixed(1)} ¢`,
    `Avantage net estimé  ${(record.edgePerShare * 100).toFixed(2)} ¢/part`,
    `Volume exécutable    ${record.shares.toFixed(2)} parts`,
    `P&L théorique        ${record.expectedPnl.toFixed(2)} $`,
    '',
    '⚠️ Observation seulement : les deux exécutions simultanées ne sont jamais garanties.',
  ].join('\n');
}

export function createTelegramClient(config, fetchImpl = fetch) {
  const endpoint = (method) => `https://api.telegram.org/bot${config.token}/${method}`;

  async function call(method, payload, signal) {
    const response = await fetchImpl(endpoint(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) throw new Error(`Telegram API returned HTTP ${response.status}`);
    const body = await response.json();
    if (body?.ok !== true) throw new Error('Telegram API rejected the request');
    return body.result;
  }

  return {
    send(text, signal) {
      return call('sendMessage', { chat_id: config.adminId, text }, signal);
    },
    async poll({ getStats, signal }) {
      let offset = 0;
      while (!signal.aborted) {
        const updates = await call(
          'getUpdates',
          { offset, timeout: 20, allowed_updates: ['message'] },
          signal,
        );
        for (const update of updates) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          const message = update.message;
          const action = routeCommand(
            { chatId: message?.chat?.id, text: message?.text },
            config.adminId,
          );
          if (action.type === 'status') await this.send(formatStatus(getStats()), signal);
          if (action.type === 'help') await this.send('Commands: /status', signal);
        }
      }
    },
  };
}

export async function pollTelegramWithRetry(client, {
  getStats,
  signal,
  onError = () => {},
  retryDelayMs = 2_000,
}) {
  while (!signal.aborted) {
    try {
      await client.poll({ getStats, signal });
    } catch (error) {
      if (signal.aborted) return;
      onError(error);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, retryDelayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }
}
