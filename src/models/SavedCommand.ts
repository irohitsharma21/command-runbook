/**
 * The single data type Runbook stores. Deliberately plain JSON so it can be
 * persisted in a VS Code Memento, exported to a file, and unit tested without
 * any VS Code dependency.
 */

export type CommandScope = 'global' | 'project';

export interface SavedCommand {
  id: string;
  command: string;
  description: string;
  scope: CommandScope;
  tags: string[];
  /** Absolute path of the workspace folder a project command belongs to. */
  projectPath?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt?: number;
}

/** Fields accepted when creating a command; the store fills in the rest. */
export interface NewCommandInput {
  command: string;
  description: string;
  scope: CommandScope;
  tags?: string[];
  projectPath?: string;
}

/** Fields that may be changed on an existing command. */
export interface CommandPatch {
  command?: string;
  description?: string;
  scope?: CommandScope;
  tags?: string[];
  projectPath?: string;
}

export const SORT_ORDERS = ['recent', 'mostUsed', 'recentlyAdded', 'alphabetical'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export function isCommandScope(value: unknown): value is CommandScope {
  return value === 'global' || value === 'project';
}

export function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === 'string' && (SORT_ORDERS as readonly string[]).includes(value);
}

/**
 * Normalises a free-form tag string ("  Docker , deployment ") into a clean,
 * de-duplicated, lower-case tag list.
 */
export function parseTags(input: string | string[] | undefined): string[] {
  if (input === undefined || input === null) {
    return [];
  }
  const parts = Array.isArray(input) ? input : input.split(/[,\n]/);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') {
      continue;
    }
    const tag = part.trim().replace(/\s+/g, '-').toLowerCase();
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}
