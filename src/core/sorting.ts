import { SavedCommand, SortOrder } from '../models/SavedCommand';

/** Timestamp used by the "recent" order: last execution, else creation. */
function recency(command: SavedCommand): number {
  return command.lastUsedAt ?? command.createdAt;
}

/** Returns a new sorted array; the input is never mutated. */
export function sortCommands(
  commands: readonly SavedCommand[],
  order: SortOrder
): SavedCommand[] {
  const sorted = [...commands];
  switch (order) {
    case 'mostUsed':
      sorted.sort(
        (a, b) => b.usageCount - a.usageCount || recency(b) - recency(a) || byLabel(a, b)
      );
      break;
    case 'recentlyAdded':
      sorted.sort((a, b) => b.createdAt - a.createdAt || byLabel(a, b));
      break;
    case 'alphabetical':
      sorted.sort(byLabel);
      break;
    case 'recent':
    default:
      sorted.sort((a, b) => recency(b) - recency(a) || byLabel(a, b));
      break;
  }
  return sorted;
}

function byLabel(a: SavedCommand, b: SavedCommand): number {
  return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
}

export const SORT_ORDER_LABELS: Record<SortOrder, string> = {
  recent: 'Recently used',
  mostUsed: 'Most used',
  recentlyAdded: 'Recently added',
  alphabetical: 'Alphabetical'
};
