import { SavedCommand } from '../models/SavedCommand';
import { searchCommands } from '../core/search';
import { shortId } from './output';

export type Resolution =
  | { kind: 'found'; command: SavedCommand }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: SavedCommand[] };

/**
 * Turns a CLI argument into exactly one command.
 *
 * Tries identifiers first (full id, then the short id shown in listings), then
 * falls back to search. An ambiguous query is reported rather than guessed —
 * silently running the wrong command would be the worst possible failure mode
 * for this tool.
 */
export function resolveCommand(
  commands: readonly SavedCommand[],
  query: string,
  options: { first?: boolean } = {}
): Resolution {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { kind: 'none' };
  }

  const byId = commands.find((c) => c.id === trimmed);
  if (byId) {
    return { kind: 'found', command: byId };
  }

  const byShortId = commands.filter((c) => shortId(c.id) === trimmed.toLowerCase());
  if (byShortId.length === 1) {
    return { kind: 'found', command: byShortId[0] };
  }

  const exactDescription = commands.filter(
    (c) => c.description.toLowerCase() === trimmed.toLowerCase()
  );
  if (exactDescription.length === 1) {
    return { kind: 'found', command: exactDescription[0] };
  }

  const matches = searchCommands(commands, trimmed);
  if (matches.length === 0) {
    return { kind: 'none' };
  }
  if (matches.length === 1 || options.first) {
    return { kind: 'found', command: matches[0] };
  }
  return { kind: 'ambiguous', matches };
}
