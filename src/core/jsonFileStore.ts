import * as fs from 'node:fs';
import * as path from 'node:path';
import { KeyValueStore } from './keyValueStore';
import { EXPORT_VERSION } from './portable';

/**
 * A `KeyValueStore` backed by a human-readable JSON file.
 *
 * This is what lets the VS Code extension and the CLI share one library. The
 * on-disk shape is deliberately identical to the export format, so a storage
 * file can be committed to a repo, diffed in a review, hand-edited, or fed
 * straight into `runbook import`:
 *
 * ```json
 * { "version": 1, "updatedAt": 0, "commands": [ ... ] }
 * ```
 *
 * Reads are cached and revalidated against the file's mtime, so a change made
 * by the other frontend is picked up without any coordination between them.
 */

interface StorageDocument {
  version: number;
  updatedAt: number;
  commands: unknown[];
  /** Any non-command keys, so the interface stays generic. */
  state?: Record<string, unknown>;
}

export interface JsonFileStoreOptions {
  /** The key whose value is stored as the document's `commands` array. */
  primaryKey: string;
  onError?: (message: string, error: unknown) => void;
  now?: () => number;
}

export class JsonFileStore implements KeyValueStore {
  private readonly primaryKey: string;
  private readonly onError: (message: string, error: unknown) => void;
  private readonly now: () => number;

  private cache: StorageDocument | undefined;
  private cacheKey = '';
  /** Set when the file exists but could not be parsed. */
  private corrupt = false;

  constructor(readonly filePath: string, options: JsonFileStoreOptions) {
    this.primaryKey = options.primaryKey;
    this.onError = options.onError ?? (() => undefined);
    this.now = options.now ?? (() => Date.now());
  }

  get<T>(key: string): T | undefined {
    const doc = this.load();
    if (key === this.primaryKey) {
      return doc.commands as unknown as T;
    }
    return doc.state?.[key] as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    // Re-read first so a concurrent write from the other frontend is not lost
    // wholesale. Last writer still wins per-key; this narrows the window.
    const doc = this.load(true);

    if (key === this.primaryKey) {
      doc.commands = Array.isArray(value) ? value : [];
    } else {
      const state = doc.state ?? {};
      if (value === undefined) {
        delete state[key];
      } else {
        state[key] = value;
      }
      doc.state = Object.keys(state).length > 0 ? state : undefined;
    }
    doc.version = EXPORT_VERSION;
    doc.updatedAt = this.now();

    await this.write(doc);
  }

  /** Drops the cache so the next read hits the disk. */
  invalidate(): void {
    this.cache = undefined;
    this.cacheKey = '';
  }

  // ---------------------------------------------------------------- internals

  private load(force = false): StorageDocument {
    let stamp = '';
    try {
      const stat = fs.statSync(this.filePath);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // Missing file is the normal empty state, not an error.
      if (!force && this.cache && this.cacheKey === '') {
        return this.cache;
      }
      this.cache = emptyDocument();
      this.cacheKey = '';
      this.corrupt = false;
      return this.cache;
    }

    if (!force && this.cache && this.cacheKey === stamp) {
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.cache = parseDocument(raw);
      this.cacheKey = stamp;
      this.corrupt = false;
    } catch (error) {
      // Do not destroy an unreadable file — keep it and start from empty. The
      // next write backs the original up rather than overwriting it.
      this.onError(`Could not read ${this.filePath}.`, error);
      this.cache = emptyDocument();
      this.cacheKey = stamp;
      this.corrupt = true;
    }
    return this.cache;
  }

  private async write(doc: StorageDocument): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    if (this.corrupt) {
      const backup = `${this.filePath}.${this.now()}.bak`;
      try {
        await fs.promises.rename(this.filePath, backup);
        this.onError(`Unreadable storage file backed up to ${backup}.`, undefined);
      } catch {
        // If it cannot be moved it probably no longer exists; carry on.
      }
      this.corrupt = false;
    }

    const payload: StorageDocument = {
      version: doc.version,
      updatedAt: doc.updatedAt,
      commands: doc.commands
    };
    if (doc.state && Object.keys(doc.state).length > 0) {
      payload.state = doc.state;
    }

    // Write-then-rename so an interrupted write cannot truncate the library.
    const temp = `${this.filePath}.tmp`;
    await fs.promises.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.promises.rename(temp, this.filePath);

    this.cache = payload;
    try {
      const stat = fs.statSync(this.filePath);
      this.cacheKey = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      this.cacheKey = '';
    }
  }
}

function emptyDocument(): StorageDocument {
  return { version: EXPORT_VERSION, updatedAt: 0, commands: [] };
}

function parseDocument(raw: string): StorageDocument {
  if (raw.trim().length === 0) {
    return emptyDocument();
  }
  const parsed: unknown = JSON.parse(raw);

  // Tolerate a bare array, which is what a hand-written file tends to be.
  if (Array.isArray(parsed)) {
    return { version: EXPORT_VERSION, updatedAt: 0, commands: parsed };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Storage file is not a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  return {
    version: typeof record.version === 'number' ? record.version : EXPORT_VERSION,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    commands: Array.isArray(record.commands) ? record.commands : [],
    state:
      typeof record.state === 'object' && record.state !== null
        ? (record.state as Record<string, unknown>)
        : undefined
  };
}
