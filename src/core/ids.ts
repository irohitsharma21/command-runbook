import { randomUUID } from 'node:crypto';

/**
 * Unique id for a saved command. `crypto.randomUUID` is available in every
 * Node runtime VS Code 1.93+ ships with; the fallback exists only so the module
 * stays usable if it is ever loaded in a stripped-down environment.
 */
export function newId(): string {
  try {
    return randomUUID();
  } catch {
    return `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
