import { SavedCommand } from '../models/SavedCommand';

export interface SearchHit {
  command: SavedCommand;
  score: number;
}

/**
 * Case-insensitive, whitespace-separated AND search across description, raw
 * command and tags. Every term must match somewhere, so "docker logs" narrows
 * rather than widens.
 */
export function matchesQuery(command: SavedCommand, query: string): boolean {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return true;
  }
  const haystack = haystackFor(command);
  return terms.every((term) => haystack.includes(term));
}

/**
 * Higher is better. Description matches outrank command matches because the
 * description is what the user is expected to remember.
 */
export function scoreCommand(command: SavedCommand, query: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return 0;
  }
  const description = command.description.toLowerCase();
  const raw = command.command.toLowerCase();
  const tags = command.tags.map((t) => t.toLowerCase());

  let score = 0;
  for (const term of terms) {
    if (description.startsWith(term)) {
      score += 100;
    } else if (wordBoundaryHit(description, term)) {
      score += 60;
    } else if (description.includes(term)) {
      score += 40;
    }

    if (tags.some((tag) => tag === term)) {
      score += 45;
    } else if (tags.some((tag) => tag.includes(term))) {
      score += 20;
    }

    if (raw.startsWith(term)) {
      score += 25;
    } else if (raw.includes(term)) {
      score += 12;
    }
  }
  return score;
}

/**
 * Filters and ranks. Ties keep the order of the input array, so the caller's
 * sort preference (recent / most used / ...) still decides among equals.
 */
export function searchCommands(
  commands: readonly SavedCommand[],
  query: string
): SavedCommand[] {
  if (tokenize(query).length === 0) {
    return [...commands];
  }
  const hits: Array<SearchHit & { index: number }> = [];
  commands.forEach((command, index) => {
    if (!matchesQuery(command, query)) {
      return;
    }
    hits.push({ command, score: scoreCommand(command, query), index });
  });
  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return hits.map((hit) => hit.command);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function haystackFor(command: SavedCommand): string {
  return `${command.description}\n${command.command}\n${command.tags.join(' ')}`.toLowerCase();
}

function wordBoundaryHit(text: string, term: string): boolean {
  const index = text.indexOf(term);
  if (index <= 0) {
    return index === 0;
  }
  return /[\s\-_/:.]/.test(text.charAt(index - 1));
}
