import { SavedCommand } from '../models/SavedCommand';

/**
 * Commands that differ only in surrounding or repeated whitespace are the same
 * command. Everything else — flag order, quoting style — is left alone: Runbook
 * must never decide two shell commands are equivalent when they might not be.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/**
 * Returns every already-saved command whose text matches `command`, most
 * recently updated first. `excludeId` skips the command being edited so it does
 * not report itself as its own duplicate.
 */
export function findDuplicates(
  commands: readonly SavedCommand[],
  command: string,
  excludeId?: string
): SavedCommand[] {
  const needle = normalizeCommand(command);
  if (needle.length === 0) {
    return [];
  }
  return commands
    .filter((c) => c.id !== excludeId && normalizeCommand(c.command) === needle)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
