/**
 * Command templates: `ssh -i {{key}} {{user}}@{{host}}`.
 *
 * Pure string handling so the prompting UI stays a thin wrapper. Substitution
 * is literal — Runbook does not quote or escape values, because silently
 * altering a command the user is about to run would be worse than a command
 * that fails visibly.
 */

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

/** Distinct variable names, in the order they first appear. */
export function extractVariables(command: string): string[] {
  VARIABLE_PATTERN.lastIndex = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_PATTERN.exec(command)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  VARIABLE_PATTERN.lastIndex = 0;
  return names;
}

export function hasVariables(command: string): boolean {
  return extractVariables(command).length > 0;
}

/**
 * Replaces every `{{name}}` for which a value was supplied. Placeholders with
 * no value are left untouched rather than replaced with an empty string.
 */
export function applyVariables(command: string, values: Record<string, string>): string {
  VARIABLE_PATTERN.lastIndex = 0;
  return command.replace(VARIABLE_PATTERN, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value;
  });
}

/** Turns `db-host` into `Db host` for use as an input-box prompt. */
export function humanizeVariableName(name: string): string {
  const words = name.replace(/[_.-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
