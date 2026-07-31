import { SavedCommand } from '../models/SavedCommand';

/**
 * Terminal output helpers. Colour is disabled when stdout is not a TTY, when
 * `NO_COLOR` is set, or when `TERM=dumb`, so piping into another tool produces
 * clean text.
 */
const useColor =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb';

function paint(code: string, text: string): string {
  return useColor ? `[${code}m${text}[0m` : text;
}

export const style = {
  bold: (text: string) => paint('1', text),
  dim: (text: string) => paint('2', text),
  cyan: (text: string) => paint('36', text),
  yellow: (text: string) => paint('33', text),
  red: (text: string) => paint('31', text),
  green: (text: string) => paint('32', text)
};

/** Short, stable prefix of a UUID, used to address commands on the CLI. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

export function formatCommand(saved: SavedCommand, index?: number): string {
  const number = index === undefined ? '' : style.dim(`${String(index + 1).padStart(2)}. `);
  const scope = saved.scope === 'global' ? 'global' : 'project';
  const meta: string[] = [scope];
  if (saved.tags.length > 0) {
    meta.push(saved.tags.join(','));
  }
  if (saved.usageCount > 0) {
    meta.push(`${saved.usageCount}x`);
  }
  return [
    `${number}${style.bold(saved.description)}  ${style.dim(`[${shortId(saved.id)}]`)}`,
    `    ${style.cyan(saved.command)}`,
    `    ${style.dim(meta.join(' · '))}`
  ].join('\n');
}

export function formatList(commands: readonly SavedCommand[]): string {
  if (commands.length === 0) {
    return style.dim('No commands found.');
  }
  return commands.map((c, i) => formatCommand(c, i)).join('\n\n');
}

export function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeError(text: string): void {
  process.stderr.write(`${style.red('runbook:')} ${text}\n`);
}
