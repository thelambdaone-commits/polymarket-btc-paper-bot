import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const SOURCES = new Set(['clob', 'chainlink', 'binance', 'coinbase', 'decision']);
const MAX_EVENT_BYTES = 1_000_000;

export function createIntervalSampler(intervalMs, now = Date.now) {
  let lastRecordedAt = -Infinity;
  return () => {
    const current = now();
    if (current - lastRecordedAt < intervalMs) return false;
    lastRecordedAt = current;
    return true;
  };
}

export class RawEventRecorder {
  constructor({ directory, now = Date.now, maxFileBytes = 25_000_000 } = {}) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new Error('Event directory is required');
    }
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 128) {
      throw new Error('maxFileBytes must be an integer of at least 128');
    }
    this.directory = directory;
    this.now = now;
    this.maxFileBytes = maxFileBytes;
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.files = new Map();
  }

  record(source, type, payload, sourceTimestamp = null) {
    if (!SOURCES.has(source)) return Promise.reject(new Error('Invalid event source'));
    if (typeof type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(type)) {
      return Promise.reject(new Error('Invalid event type'));
    }
    const receivedAt = this.now();
    const event = {
      schemaVersion: 1,
      sequence: ++this.sequence,
      receivedAt,
      source,
      type,
      sourceTimestamp: Number.isSafeInteger(Number(sourceTimestamp)) ? Number(sourceTimestamp) : null,
      payload,
    };
    let line;
    try {
      line = `${JSON.stringify(event)}\n`;
    } catch {
      return Promise.reject(new Error('Event payload is not serializable'));
    }
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
      return Promise.reject(new Error('Event payload is too large'));
    }
    const write = () => this.append(receivedAt, line);
    this.queue = this.queue.then(write, write);
    return this.queue;
  }

  async append(timestamp, line) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const lineBytes = Buffer.byteLength(line);
    let file = await this.currentFile(day);
    if (file.bytes > 0 && file.bytes + lineBytes > this.maxFileBytes) {
      await this.compress(day, file.index);
      file = { index: file.index + 1, bytes: 0 };
      this.files.set(day, file);
    }
    await appendFile(join(this.directory, this.filename(day, file.index)), line, {
      encoding: 'utf8',
      mode: 0o600,
    });
    file.bytes += lineBytes;
  }

  async currentFile(day) {
    const cached = this.files.get(day);
    if (cached) return cached;
    const names = await readdir(this.directory);
    const pattern = new RegExp(`^${day}\\.(\\d+)\\.jsonl$`);
    const indices = names.flatMap((name) => {
      const match = name.match(pattern);
      return match ? [Number(match[1])] : [];
    });
    const index = indices.length === 0 ? 0 : Math.max(...indices);
    const path = join(this.directory, this.filename(day, index));
    let bytes = 0;
    try {
      bytes = (await stat(path)).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const file = { index, bytes };
    this.files.set(day, file);
    return file;
  }

  filename(day, index) {
    return `${day}.${index}.jsonl`;
  }

  async compress(day, index) {
    const path = join(this.directory, this.filename(day, index));
    const compressedPath = `${path}.gz`;
    await pipeline(
      createReadStream(path),
      createGzip({ level: 6 }),
      createWriteStream(compressedPath, { mode: 0o600 }),
    );
    await unlink(path);
  }

  flush() {
    return this.queue;
  }
}
