import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

test('loads conservative paper-trading defaults', () => {
  const config = loadConfig({});

  assert.equal(config.paperOnly, true);
  assert.equal(config.observationIntervalMs, 100);
  assert.equal(config.clobMaxFreshnessMs, 2_000);
  assert.equal(config.rawEventRecording, true);
  assert.equal(config.eventMaxFileBytes, 25_000_000);
  assert.equal(config.maximumFillSlippage, 0.03);
  assert.equal(config.referenceFeedsEnabled, true);
  assert.equal(config.referenceFeedFreshnessMs, 5_000);
  assert.equal(config.clobRecordIntervalMs, 250);
  assert.equal(config.startingBalance, 20);
  assert.equal(config.stake, 1);
  assert.deepEqual(config.timeframes, [5, 15]);
  assert.equal(config.regimeGateEnabled, true);
  assert.equal(config.kellyFraction, 0.25);
  assert.equal(config.maxOpenExposure, 5);
  assert.equal(config.bayesianAnchorEnabled, false);
  assert.deepEqual(loadConfig({ BTC_1H_ENABLED: 'true' }).timeframes, [5, 15, 60]);
});

test('rejects an observation interval below 100 ms', () => {
  assert.throws(() => loadConfig({ OBSERVATION_INTERVAL_MS: '99' }), /at least 100/);
});

test('rejects invalid numeric configuration', () => {
  assert.throws(() => loadConfig({ PAPER_STAKE: 'all' }), /PAPER_STAKE/);
  assert.throws(() => loadConfig({ PAPER_STAKE: '1.01' }), /PAPER_STAKE/);
  assert.throws(() => loadConfig({ CLOB_MAX_FRESHNESS_MS: '99' }), /CLOB_MAX_FRESHNESS_MS/);
  assert.throws(() => loadConfig({ RAW_EVENT_RECORDING: 'sometimes' }), /RAW_EVENT_RECORDING/);
});
