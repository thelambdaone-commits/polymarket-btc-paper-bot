import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadState, saveState } from '../src/store.js';

test('persists state atomically and returns null for a missing file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'btc-paper-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');

  assert.equal(await loadState(path), null);
  await saveState(path, { version: 1, balance: 100 });
  assert.deepEqual(await loadState(path), { version: 1, balance: 100 });
});
