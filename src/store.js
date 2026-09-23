import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_STATE_BYTES = 1024 * 1024;

export async function loadState(path) {
  try {
    const info = await stat(path);
    if (info.size > MAX_STATE_BYTES) throw new Error('Paper state file is too large');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveState(path, state) {
  const payload = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new Error('Paper state is too large');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, payload, { mode: 0o600 });
  await rename(temporaryPath, path);
}
