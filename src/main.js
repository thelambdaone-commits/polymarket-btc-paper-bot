import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { ClobOrderBookFeed } from './clob-feed.js';
import { ChainlinkPriceFeed } from './crypto-feed.js';
import { createIntervalSampler, RawEventRecorder } from './event-recorder.js';
import { loadRecentChainlinkSamples } from './event-history.js';
import { applyFillToSignal, simulateTakerFill } from './fills.js';
import { ReferencePriceFeeds } from './reference-feeds.js';
import { calibrateSignal } from './learning.js';
import {
  discoverBtcMarkets,
  fetchExecutableQuotes,
  fetchMarketResolution,
} from './markets.js';
import { PaperPortfolio } from './paper.js';
import { detectCompleteSetArbitrage } from './pricing.js';
import { extractMarketFeatures } from './features.js';
import { classifyRegime } from './regime.js';
import { evaluatePaperRisk } from './risk.js';
import { applyBayesianAnchor } from './bayesian.js';
import { buildMetricsReport } from './metrics.js';
import { createStatusServer } from './status-server.js';
import { reconcileDuePositions } from './settlement.js';
import { evaluateAdaptiveStrategy } from './strategy.js';
import { loadState, saveState } from './store.js';
import {
  createTelegramClient,
  formatArbitrage,
  formatSettlement,
  formatSignal,
  parseTelegramConfig,
  pollTelegramWithRetry,
} from './telegram.js';

const STATE_PATH = fileURLToPath(new URL('../data/paper-state.json', import.meta.url));
const EVENT_DIRECTORY = fileURLToPath(new URL('../data/events/', import.meta.url));
const config = loadConfig();
const savedState = await loadState(STATE_PATH);
const initialChainlinkSamples = await loadRecentChainlinkSamples(EVENT_DIRECTORY);
const portfolio = savedState
  ? PaperPortfolio.restore(savedState)
  : new PaperPortfolio(config.startingBalance, config.stake);
const eventRecorder = config.rawEventRecording
  ? new RawEventRecorder({ directory: EVENT_DIRECTORY, maxFileBytes: config.eventMaxFileBytes })
  : null;
const shouldRecordClobDelta = createIntervalSampler(config.clobRecordIntervalMs);
const shouldRecordClobBook = createIntervalSampler(config.clobRecordIntervalMs);
function recordEvent(source, type, payload, sourceTimestamp) {
  if (source === 'clob' && type === 'price_change' && !shouldRecordClobDelta()) return;
  if (source === 'clob' && type === 'book' && !shouldRecordClobBook()) return;
  eventRecorder?.record(source, type, payload, sourceTimestamp).catch((error) => {
    console.error(JSON.stringify({ event: 'event_recording_error', message: error.message }));
  });
}
const priceFeed = new ChainlinkPriceFeed({
  initialSamples: initialChainlinkSamples,
  onEvent: (type, payload, timestamp) => recordEvent('chainlink', type, payload, timestamp),
});
const clobFeed = new ClobOrderBookFeed({
  maxFreshnessMs: config.clobMaxFreshnessMs,
  onEvent: (type, payload, timestamp) => recordEvent('clob', type, payload, timestamp),
});
const referenceFeeds = new ReferencePriceFeeds({
  enabled: config.referenceFeedsEnabled,
  maxFreshnessMs: config.referenceFeedFreshnessMs,
  onEvent: (source, type, payload, timestamp) => recordEvent(source, type, payload, timestamp),
});
let markets = [];
let lastDiscovery = 0;
let stopping = false;
const telegramConfig = parseTelegramConfig();
const telegram = telegramConfig ? createTelegramClient(telegramConfig) : null;
const statusServer = config.statusEnabled ? createStatusServer({
  port: config.statusPort,
  getStatus: () => ({
    paperOnly: config.paperOnly,
    markets: markets.length,
    clobConnected: clobFeed.connected,
    telegram: Boolean(telegram),
    stats: portfolio.stats(),
  }),
  getMetrics: () => buildMetricsReport({
    history: portfolio.history(),
    initialBalance: portfolio.initialBalance,
  }),
}) : null;
const telegramAbort = new AbortController();
let persistQueue = Promise.resolve();
const ERROR_LOG_SUPPRESS_MS = 60_000;
let lastObservationError = { message: '', at: 0, suppressed: 0 };

function persist() {
  const write = () => saveState(STATE_PATH, portfolio.snapshot());
  persistQueue = persistQueue.then(write, write);
  return persistQueue;
}

async function notify(text) {
  if (telegram) await telegram.send(text, telegramAbort.signal);
}

async function settleDuePositions(nowSeconds) {
  await reconcileDuePositions({
    portfolio,
    nowSeconds,
    fetchResolution: fetchMarketResolution,
    onSettled: async (result) => {
      recordEvent('decision', 'settlement', result, Date.now());
      await persist();
      console.log(JSON.stringify({ event: 'paper_settled', ...result }));
      await notify(formatSettlement(result));
    },
    onError: (error, position) => console.error(JSON.stringify({
      event: 'resolution_error',
      marketId: position.marketId,
      message: error.message,
    })),
  });
}

async function observeMarket(market, quote) {
  const marketConfig = { ...config, feeRate: market.feeRate ?? config.feeRate };
  const opportunity = detectCompleteSetArbitrage({
    ...quote,
    feeRate: marketConfig.feeRate,
    buffer: marketConfig.arbitrageBuffer,
  });
  if (opportunity) {
    const record = portfolio.recordArbitrage(market, opportunity);
    if (record) {
      await persist();
      console.log(JSON.stringify({ event: 'sure_bet_observed', ...record }));
      await notify(formatArbitrage(record));
    }
  }

  const oracle = priceFeed.snapshot(market.startTime);
  const marketFeatures = extractMarketFeatures({
    oracle,
    quote,
    market,
    nowSeconds: Math.floor(Date.now() / 1_000),
  });
  const marketRegime = classifyRegime({ oracle, features: marketFeatures });
  const rawSignal = evaluateAdaptiveStrategy(
    oracle,
    quote,
    market,
    Math.floor(Date.now() / 1_000),
    marketConfig,
  );
  const anchoredSignal = marketConfig.bayesianAnchorEnabled
    ? applyBayesianAnchor(rawSignal, quote, { damping: marketConfig.bayesianDamping })
    : rawSignal;
  let signal = calibrateSignal(anchoredSignal, portfolio.history(), market.timeframeMinutes, marketConfig);
  if (marketConfig.regimeGateEnabled && signal.side !== 'HOLD' && !marketRegime.tradeAllowed) {
    signal = {
      ...signal,
      side: 'HOLD',
      reason: 'regime_gate_blocked',
      marketRegime: marketRegime.regime,
      regimeConfidence: marketRegime.confidence,
    };
  }
  let riskDecision = signal.side === 'HOLD' ? null : evaluatePaperRisk({
    portfolio,
    market,
    signal,
    config: marketConfig,
  });
  if (riskDecision && !riskDecision.allowed) {
    signal = { ...signal, side: 'HOLD', reason: riskDecision.reason, risk: riskDecision };
  }
  if (signal.side !== 'HOLD') {
    const asks = signal.side === 'UP' ? quote.upAsks : quote.downAsks;
    let fill = simulateTakerFill({
      stake: riskDecision.stake,
      asks,
      feeRate: marketConfig.feeRate,
      maximumSlippage: marketConfig.maximumFillSlippage,
    });
    if (fill && Number.isFinite(market.minimumOrderSize) && fill.shares < market.minimumOrderSize) {
      fill = null;
    }
    if (fill) {
      const fillRisk = evaluatePaperRisk({
        portfolio,
        market,
        signal: { ...signal, entryPrice: fill.averagePrice },
        config: marketConfig,
      });
      if (!fillRisk.allowed) {
        fill = null;
        riskDecision = fillRisk;
      } else if (fillRisk.stake + 1e-9 < riskDecision.stake) {
        riskDecision = fillRisk;
        fill = simulateTakerFill({
          stake: fillRisk.stake,
          asks,
          feeRate: marketConfig.feeRate,
          maximumSlippage: marketConfig.maximumFillSlippage,
        });
      }
    }
    signal = fill
      ? applyFillToSignal(signal, fill, marketConfig)
      : { ...signal, side: 'HOLD', reason: 'insufficient_executable_liquidity' };
  }
  recordEvent('decision', 'evaluation', {
    market,
    quote,
    oracle,
    features: marketFeatures,
    marketRegime,
    references: referenceFeeds.snapshot(),
    signal,
  }, Date.now());
  if (signal.side === 'HOLD') return;
  const position = portfolio.open(market, signal.side, signal.entryPrice, marketConfig.feeRate, {
    timeframeMinutes: market.timeframeMinutes,
    estimatedProbability: signal.adjustedProbability,
    netEdge: signal.netEdge,
    strategy: signal.strategy,
    regime: signal.regime,
    stake: riskDecision?.stake,
    fill: signal.fill,
  });
  if (!position) return;
  await persist();
  console.log(JSON.stringify({ event: 'paper_prediction', ...position, signal }));
  await notify(formatSignal(position, signal));
}

async function observe() {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (Date.now() - lastDiscovery >= config.marketRefreshMs) {
    lastDiscovery = Date.now();
    await settleDuePositions(nowSeconds);
    markets = await discoverBtcMarkets(fetch, config.timeframes);
    clobFeed.setMarkets(markets);
  }
  const currentMarkets = markets.filter(
    (market) => market.startTime <= nowSeconds && nowSeconds < market.endTime,
  );
  const quotes = await clobFeed.getQuotes(currentMarkets, fetchExecutableQuotes);
  await Promise.all(
    currentMarkets
      .filter((market) => quotes.has(market.id))
      .map((market) => observeMarket(market, quotes.get(market.id))),
  );
}

async function run() {
  priceFeed.start();
  clobFeed.start();
  referenceFeeds.start();
  if (statusServer) await statusServer.start();
  console.log(JSON.stringify({
    event: 'started',
    name: 'Paper Prediction Bot',
    paperOnly: true,
    telegram: Boolean(telegram),
    restoredPredictions: portfolio.stats().predictions,
    restoredChainlinkSamples: initialChainlinkSamples.length,
    config,
  }));
  if (telegram) {
    pollTelegramWithRetry(telegram, {
      getStats: () => portfolio.stats(),
      signal: telegramAbort.signal,
      onError: (error) => {
        console.error(JSON.stringify({ event: 'telegram_error', message: error.message }));
      },
    });
  }
  while (!stopping) {
    const startedAt = Date.now();
    try {
      await observe();
    } catch (error) {
      const nowMs = Date.now();
      if (error.message === lastObservationError.message
        && nowMs - lastObservationError.at < ERROR_LOG_SUPPRESS_MS) {
        lastObservationError.suppressed += 1;
      } else {
        if (lastObservationError.suppressed > 0) {
          console.error(JSON.stringify({
            event: 'observation_error_summary',
            message: lastObservationError.message,
            suppressed: lastObservationError.suppressed,
          }));
        }
        console.error(JSON.stringify({ event: 'observation_error', message: error.message }));
        lastObservationError = { message: error.message, at: nowMs, suppressed: 0 };
      }
    }
    const remaining = Math.max(0, config.observationIntervalMs - (Date.now() - startedAt));
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  telegramAbort.abort();
  priceFeed.stop();
  clobFeed.stop();
  referenceFeeds.stop();
  await statusServer?.stop();
  await eventRecorder?.flush();
  await persist();
  console.log(JSON.stringify({ event: 'stopped', stats: portfolio.stats() }));
}

process.on('SIGINT', () => {
  stopping = true;
  telegramAbort.abort();
  priceFeed.stop();
  clobFeed.stop();
  referenceFeeds.stop();
});
process.on('SIGTERM', () => {
  stopping = true;
  telegramAbort.abort();
  priceFeed.stop();
  clobFeed.stop();
  referenceFeeds.stop();
});

await run();
