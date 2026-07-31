import {
  CommandPatch,
  CommandScope,
  NewCommandInput,
  SavedCommand,
  isCommandScope,
  parseTags
} from '../models/SavedCommand';
import { KeyValueStore } from './keyValueStore';
import { newId as defaultNewId } from './ids';

/** Storage key. Versioned so a future migration can read the old shape. */
export const STORAGE_KEY = 'runbook.commands.v1';

export interface CommandStoreOptions {
  /** Injected for deterministic tests. */
  now?: () => number;
  newId?: () => string;
  /** Called when persisted data is unreadable, so the caller can log it. */
  onError?: (message: string, error: unknown) => void;
}

/**
 * CRUD over two independent backing stores — one global, one per workspace.
 *
 * The class is intentionally free of VS Code imports. `workspaceStore` is
 * `undefined` when no folder is open, in which case the project scope is simply
 * unavailable rather than silently writing to a store that will not persist.
 */
export class CommandStore {
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly onError: (message: string, error: unknown) => void;

  constructor(
    private readonly globalStore: KeyValueStore,
    private readonly workspaceStore: KeyValueStore | undefined,
    options: CommandStoreOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.makeId = options.newId ?? defaultNewId;
    this.onError = options.onError ?? (() => undefined);
  }

  /** False when no workspace folder is open, so project scope cannot be used. */
  get supportsProjectScope(): boolean {
    return this.workspaceStore !== undefined;
  }

  all(): SavedCommand[] {
    return [...this.read('global'), ...this.read('project')];
  }

  byScope(scope: CommandScope): SavedCommand[] {
    return this.read(scope);
  }

  get(id: string): SavedCommand | undefined {
    return this.all().find((c) => c.id === id);
  }

  isEmpty(): boolean {
    return this.all().length === 0;
  }

  async add(input: NewCommandInput): Promise<SavedCommand> {
    const scope = this.resolveScope(input.scope);
    const timestamp = this.now();
    const command: SavedCommand = {
      id: this.makeId(),
      command: input.command.trim(),
      description: input.description.trim(),
      scope,
      tags: parseTags(input.tags),
      createdAt: timestamp,
      updatedAt: timestamp,
      usageCount: 0
    };
    if (scope === 'project' && input.projectPath) {
      command.projectPath = input.projectPath;
    }

    const existing = this.read(scope);
    await this.write(scope, [...existing, command]);
    return command;
  }

  /**
   * Applies a patch. Changing the scope physically moves the record between the
   * global and workspace stores.
   */
  async update(id: string, patch: CommandPatch): Promise<SavedCommand | undefined> {
    const current = this.get(id);
    if (!current) {
      return undefined;
    }

    const targetScope = this.resolveScope(patch.scope ?? current.scope);
    const updated: SavedCommand = {
      ...current,
      command: patch.command !== undefined ? patch.command.trim() : current.command,
      description:
        patch.description !== undefined ? patch.description.trim() : current.description,
      tags: patch.tags !== undefined ? parseTags(patch.tags) : current.tags,
      scope: targetScope,
      updatedAt: this.now()
    };

    if (targetScope === 'project') {
      const projectPath = patch.projectPath ?? current.projectPath;
      if (projectPath) {
        updated.projectPath = projectPath;
      }
    } else {
      delete updated.projectPath;
    }

    if (targetScope === current.scope) {
      await this.write(
        targetScope,
        this.read(targetScope).map((c) => (c.id === id ? updated : c))
      );
    } else {
      await this.write(
        current.scope,
        this.read(current.scope).filter((c) => c.id !== id)
      );
      await this.write(targetScope, [...this.read(targetScope), updated]);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const current = this.get(id);
    if (!current) {
      return false;
    }
    await this.write(
      current.scope,
      this.read(current.scope).filter((c) => c.id !== id)
    );
    return true;
  }

  /** Increments usage counters after a command is actually executed. */
  async recordUsage(id: string): Promise<SavedCommand | undefined> {
    const current = this.get(id);
    if (!current) {
      return undefined;
    }
    const updated: SavedCommand = {
      ...current,
      usageCount: current.usageCount + 1,
      lastUsedAt: this.now()
    };
    await this.write(
      current.scope,
      this.read(current.scope).map((c) => (c.id === id ? updated : c))
    );
    return updated;
  }

  /** Bulk write, used by import. Records are re-stamped and re-scoped. */
  async replaceScope(scope: CommandScope, commands: readonly SavedCommand[]): Promise<void> {
    const target = this.resolveScope(scope);
    await this.write(
      target,
      commands.map((c) => ({ ...c, scope: target }))
    );
  }

  async addMany(commands: readonly NewCommandInput[]): Promise<SavedCommand[]> {
    const created: SavedCommand[] = [];
    for (const input of commands) {
      created.push(await this.add(input));
    }
    return created;
  }

  /** Every distinct tag currently in use, alphabetically. */
  allTags(): string[] {
    const tags = new Set<string>();
    for (const command of this.all()) {
      for (const tag of command.tags) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  // ---------------------------------------------------------------- internals

  /** Falls back to global when no workspace is open. */
  private resolveScope(scope: CommandScope): CommandScope {
    if (scope === 'project' && !this.supportsProjectScope) {
      return 'global';
    }
    return scope;
  }

  private storeFor(scope: CommandScope): KeyValueStore | undefined {
    return scope === 'global' ? this.globalStore : this.workspaceStore;
  }

  private read(scope: CommandScope): SavedCommand[] {
    const store = this.storeFor(scope);
    if (!store) {
      return [];
    }
    let raw: unknown;
    try {
      raw = store.get<unknown>(STORAGE_KEY);
    } catch (error) {
      this.onError(`Could not read ${scope} commands from storage.`, error);
      return [];
    }
    if (raw === undefined) {
      return [];
    }
    if (!Array.isArray(raw)) {
      this.onError(`Stored ${scope} commands were not an array; ignoring them.`, raw);
      return [];
    }
    const commands: SavedCommand[] = [];
    for (const entry of raw) {
      const command = sanitizeStoredCommand(entry, scope);
      if (command) {
        commands.push(command);
      }
    }
    return commands;
  }

  private async write(scope: CommandScope, commands: readonly SavedCommand[]): Promise<void> {
    const store = this.storeFor(scope);
    if (!store) {
      throw new Error(
        'No workspace folder is open, so project-scoped commands cannot be saved.'
      );
    }
    await store.update(STORAGE_KEY, commands);
  }
}

/**
 * Defensive read of a single persisted record. Anything unusable is dropped
 * instead of being allowed to break the tree view. Exported for tests.
 */
export function sanitizeStoredCommand(entry: unknown, scope: CommandScope): SavedCommand | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const value = entry as Record<string, unknown>;
  const command = typeof value.command === 'string' ? value.command : '';
  if (command.trim().length === 0) {
    return null;
  }
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : defaultNewId();
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt;

  const result: SavedCommand = {
    id,
    command,
    description:
      typeof value.description === 'string' && value.description.trim().length > 0
        ? value.description
        : command,
    scope: isCommandScope(value.scope) ? value.scope : scope,
    tags: parseTags(Array.isArray(value.tags) ? (value.tags as string[]) : []),
    createdAt,
    updatedAt,
    usageCount:
      typeof value.usageCount === 'number' && value.usageCount >= 0
        ? Math.floor(value.usageCount)
        : 0
  };
  if (typeof value.projectPath === 'string' && value.projectPath.length > 0) {
    result.projectPath = value.projectPath;
  }
  if (typeof value.lastUsedAt === 'number') {
    result.lastUsedAt = value.lastUsedAt;
  }
  // A record stored under the workspace key is a project command regardless of
  // what its own `scope` field claims, and vice versa.
  result.scope = scope;
  return result;
}
