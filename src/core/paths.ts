import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Where Runbook keeps its data.
 *
 * Both the VS Code extension and the CLI resolve paths through this module, so
 * the two frontends always read and write the same files. Nothing here touches
 * VS Code APIs.
 */

export const GLOBAL_FILE_NAME = 'commands.json';
export const PROJECT_DIR_NAME = '.runbook';

/**
 * Global storage directory.
 *
 * `RUNBOOK_HOME` wins, then the platform convention. Keeping this overridable
 * is what makes the storage tests hermetic.
 */
export function globalStorageDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RUNBOOK_HOME;
  if (override && override.length > 0) {
    return override;
  }
  if (process.platform === 'win32') {
    const appData = env.APPDATA;
    if (appData && appData.length > 0) {
      return path.join(appData, 'runbook');
    }
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'runbook');
  }
  return path.join(os.homedir(), '.config', 'runbook');
}

export function globalStorageFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(globalStorageDir(env), GLOBAL_FILE_NAME);
}

/**
 * Per-project storage, inside the project itself so a team can commit it and
 * share a project's commands the same way they share a Makefile.
 */
export function projectStorageDir(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_DIR_NAME);
}

export function projectStorageFile(projectRoot: string): string {
  return path.join(projectStorageDir(projectRoot), GLOBAL_FILE_NAME);
}

/**
 * Walks up from `start` looking for a project root: an existing `.runbook`
 * directory first, then a `.git` directory. Used by the CLI, which — unlike the
 * extension — has no workspace to ask.
 */
export function findProjectRoot(start: string): string | undefined {
  let current = path.resolve(start);
  let gitRoot: string | undefined;

  for (;;) {
    if (isDirectory(path.join(current, PROJECT_DIR_NAME))) {
      return current;
    }
    if (gitRoot === undefined && exists(path.join(current, '.git'))) {
      gitRoot = current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return gitRoot;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function exists(target: string): boolean {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}
