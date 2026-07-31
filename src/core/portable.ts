import { SavedCommand, isCommandScope, parseTags } from '../models/SavedCommand';
import { newId } from './ids';

/** Bumped only if the on-disk shape changes incompatibly. */
export const EXPORT_VERSION = 1;

export interface RunbookExport {
  version: number;
  exportedAt: number;
  commands: SavedCommand[];
}

export interface ImportResult {
  commands: SavedCommand[];
  /** Non-fatal problems: entries that were skipped, and why. */
  warnings: string[];
}

export class ImportError extends Error {}

export function buildExport(commands: readonly SavedCommand[], now: number): RunbookExport {
  return {
    version: EXPORT_VERSION,
    exportedAt: now,
    commands: [...commands]
  };
}

export function serializeExport(commands: readonly SavedCommand[], now: number): string {
  return `${JSON.stringify(buildExport(commands, now), null, 2)}\n`;
}

/**
 * Parses an exported file. Throws `ImportError` only when the file as a whole is
 * unusable; individual bad entries are skipped and reported as warnings so one
 * corrupt record cannot block an entire restore.
 */
export function parseImport(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ImportError(
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Accept both the wrapped export format and a bare array of commands.
  let entries: unknown[];
  let version = EXPORT_VERSION;

  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.commands)) {
      throw new ImportError('The file does not contain a "commands" array.');
    }
    entries = record.commands;
    if (typeof record.version === 'number') {
      version = record.version;
    }
  } else {
    throw new ImportError('The file does not contain Runbook command data.');
  }

  if (version > EXPORT_VERSION) {
    throw new ImportError(
      `This file was written by a newer version of Runbook (format v${version}). Update the extension and try again.`
    );
  }

  const warnings: string[] = [];
  const commands: SavedCommand[] = [];

  entries.forEach((entry, index) => {
    const result = coerceImportedCommand(entry, index);
    if (typeof result === 'string') {
      warnings.push(result);
    } else {
      commands.push(result);
    }
  });

  if (commands.length === 0) {
    throw new ImportError(
      warnings.length > 0
        ? `No valid commands found. ${warnings[0]}`
        : 'The file contained no commands.'
    );
  }

  return { commands, warnings };
}

/** Returns the coerced command, or an error string describing why it was skipped. */
function coerceImportedCommand(entry: unknown, index: number): SavedCommand | string {
  const position = `Entry ${index + 1}`;
  if (typeof entry !== 'object' || entry === null) {
    return `${position} was not an object and was skipped.`;
  }
  const value = entry as Record<string, unknown>;

  if (typeof value.command !== 'string' || value.command.trim().length === 0) {
    return `${position} has no command text and was skipped.`;
  }
  const command = value.command.trim();

  const description =
    typeof value.description === 'string' && value.description.trim().length > 0
      ? value.description.trim()
      : command;

  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;

  const result: SavedCommand = {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : newId(),
    command,
    description,
    scope: isCommandScope(value.scope) ? value.scope : 'global',
    tags: parseTags(Array.isArray(value.tags) ? (value.tags as string[]) : []),
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
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
  return result;
}
