const SOURCES = new Set(['clob', 'chainlink', 'binance', 'coinbase', 'decision']);
const MAX_LINE_LENGTH = 1_000_000;

export function sortEventFilenames(filenames) {
  return [...filenames].sort((left, right) => {
    const leftMatch = /^(\d{4}-\d{2}-\d{2})\.(\d+)\.jsonl(?:\.gz)?$/.exec(left);
    const rightMatch = /^(\d{4}-\d{2}-\d{2})\.(\d+)\.jsonl(?:\.gz)?$/.exec(right);
    if (!leftMatch || !rightMatch) return left.localeCompare(right);
    const dateOrder = leftMatch[1].localeCompare(rightMatch[1]);
    return dateOrder || Number(leftMatch[2]) - Number(rightMatch[2]);
  });
}

function validateEvent(event) {
  if (
    !event || event.schemaVersion !== 1 ||
    !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
    !Number.isSafeInteger(event.receivedAt) || event.receivedAt < 1 ||
    !SOURCES.has(event.source) ||
    typeof event.type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event.type) ||
    (event.sourceTimestamp !== null && !Number.isSafeInteger(event.sourceTimestamp)) ||
    !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)
  ) throw new Error('Invalid recorded event schema');
  return event;
}

export function parseRecordedEvent(line) {
  if (typeof line !== 'string' || line.length > MAX_LINE_LENGTH) {
    throw new Error('Recorded event line is too large');
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error('Invalid recorded event JSON');
  }
  return validateEvent(event);
}

export async function replayEvents(events, { onEvent = null } = {}) {
  const summary = {
    events: 0,
    firstReceivedAt: null,
    lastReceivedAt: null,
    sources: {},
    decisions: 0,
    holds: 0,
    actionable: 0,
    settlements: 0,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
  };
  let previousTimestamp = -Infinity;
  for await (const raw of events) {
    const event = typeof raw === 'string' ? parseRecordedEvent(raw) : validateEvent(raw);
    if (event.receivedAt < previousTimestamp) {
      throw new Error('Recorded events are not chronological');
    }
    previousTimestamp = event.receivedAt;
    summary.events += 1;
    summary.firstReceivedAt ??= event.receivedAt;
    summary.lastReceivedAt = event.receivedAt;
    summary.sources[event.source] = (summary.sources[event.source] ?? 0) + 1;
    if (event.source === 'decision' && event.type === 'evaluation') {
      summary.decisions += 1;
      if (event.payload.signal?.side === 'HOLD') summary.holds += 1;
      if (['UP', 'DOWN'].includes(event.payload.signal?.side)) summary.actionable += 1;
    }
    if (event.source === 'decision' && event.type === 'settlement') {
      const pnl = Number(event.payload.pnl);
      if (!Number.isFinite(pnl) || !['UP', 'DOWN'].includes(event.payload.side) ||
        !['UP', 'DOWN'].includes(event.payload.winningSide)) {
        throw new Error('Invalid settlement event');
      }
      summary.settlements += 1;
      summary.wins += event.payload.side === event.payload.winningSide ? 1 : 0;
      summary.losses += event.payload.side === event.payload.winningSide ? 0 : 1;
      summary.realizedPnl = Number((summary.realizedPnl + pnl).toFixed(2));
    }
    if (typeof onEvent === 'function') await onEvent(event);
  }
  return summary;
}
