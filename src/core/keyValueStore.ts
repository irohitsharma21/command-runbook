/**
 * Minimal persistence contract. VS Code's `Memento` satisfies this shape, but
 * so does a plain in-memory object, which is what the unit tests use.
 *
 * Keeping the store behind this interface is what lets every piece of Runbook's
 * business logic run outside the extension host — and is the seam where a
 * future sync/file backend would plug in.
 */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

/** In-memory implementation, used by tests and as a safe fallback. */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }
}
