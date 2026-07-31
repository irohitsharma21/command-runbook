import * as vscode from 'vscode';
import { CommandStore, STORAGE_KEY } from '../core/commandStore';
import { KeyValueStore } from '../core/keyValueStore';
import { JsonFileStore } from '../core/jsonFileStore';
import { globalStorageFile, projectStorageFile } from '../core/paths';
import { logError, log } from '../util/logger';

/**
 * Adapts a VS Code `Memento` to the storage-agnostic `KeyValueStore` contract.
 * Only used when project storage is explicitly configured to stay inside VS
 * Code, and by the one-time migration off the old storage.
 */
class MementoStore implements KeyValueStore {
  constructor(private readonly memento: vscode.Memento) {}

  get<T>(key: string): T | undefined {
    return this.memento.get<T>(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.memento.update(key, value);
  }
}

export interface StoreBundle {
  store: CommandStore;
  /** Files to watch, so edits made by the CLI show up in the sidebar. */
  watchedFiles: string[];
  globalFile: JsonFileStore;
  projectFile?: JsonFileStore;
  projectRoot?: string;
}

/** Flags recording that the one-time move off VS Code storage has happened. */
const GLOBAL_MIGRATION_FLAG = 'runbook.migratedToFiles.v1';
const PROJECT_MIGRATION_FLAG = 'runbook.migratedProjectToFiles.v1';

/**
 * Builds the store for this window.
 *
 * Global commands always live in a JSON file so the CLI can read the same
 * library. Project commands default to a committable `.runbook/commands.json`
 * inside the project, which can be switched back to VS Code's private
 * workspace storage with `runbook.projectStorage`.
 */
export function createCommandStore(context: vscode.ExtensionContext): StoreBundle {
  const onError = (message: string, error: unknown) => logError(message, error);

  const globalPath = globalStorageFile();
  const globalFile = new JsonFileStore(globalPath, { primaryKey: STORAGE_KEY, onError });
  const watchedFiles = [globalPath];

  const projectRoot = currentProjectPath();
  const useFileForProject =
    vscode.workspace.getConfiguration('runbook').get<string>('projectStorage', 'file') === 'file';

  let projectStore: KeyValueStore | undefined;
  let projectFile: JsonFileStore | undefined;

  if (projectRoot && useFileForProject) {
    const projectPath = projectStorageFile(projectRoot);
    projectFile = new JsonFileStore(projectPath, { primaryKey: STORAGE_KEY, onError });
    projectStore = projectFile;
    watchedFiles.push(projectPath);
  } else if (projectRoot) {
    projectStore = new MementoStore(context.workspaceState);
  }

  const store = new CommandStore(globalFile, projectStore, { onError });

  const bundle: StoreBundle = { store, watchedFiles, globalFile };
  if (projectFile) {
    bundle.projectFile = projectFile;
  }
  if (projectRoot) {
    bundle.projectRoot = projectRoot;
  }
  return bundle;
}

/**
 * One-time move of commands saved by earlier versions, which used VS Code's
 * `globalState` / `workspaceState`.
 *
 * The original data is left in place rather than deleted — if something goes
 * wrong the user's library is still recoverable.
 */
export async function migrateLegacyStorage(
  context: vscode.ExtensionContext,
  bundle: StoreBundle
): Promise<number> {
  let migrated = 0;

  migrated += await migrateOne(
    context.globalState,
    bundle.globalFile,
    GLOBAL_MIGRATION_FLAG,
    context.globalState
  );

  if (bundle.projectFile) {
    migrated += await migrateOne(
      context.workspaceState,
      bundle.projectFile,
      PROJECT_MIGRATION_FLAG,
      context.workspaceState
    );
  }

  if (migrated > 0) {
    log(`Migrated ${migrated} commands from VS Code storage to files.`);
    void vscode.window.showInformationMessage(
      `Runbook: moved ${migrated} saved command${migrated === 1 ? '' : 's'} into files so the CLI can read them too.`,
      'Show Location'
    ).then((choice) => {
      if (choice === 'Show Location') {
        void vscode.window.showInformationMessage(
          `Global: ${bundle.globalFile.filePath}${
            bundle.projectFile ? `\nProject: ${bundle.projectFile.filePath}` : ''
          }`
        );
      }
    });
  }
  return migrated;
}

async function migrateOne(
  source: vscode.Memento,
  target: JsonFileStore,
  flagKey: string,
  flagStore: vscode.Memento
): Promise<number> {
  if (flagStore.get<boolean>(flagKey) === true) {
    return 0;
  }

  const legacy = source.get<unknown>(STORAGE_KEY);
  const existing = target.get<unknown[]>(STORAGE_KEY) ?? [];

  // Only migrate into an empty file, so a re-run can never duplicate a library.
  if (Array.isArray(legacy) && legacy.length > 0 && existing.length === 0) {
    await target.update(STORAGE_KEY, legacy);
    await flagStore.update(flagKey, true);
    return legacy.length;
  }

  await flagStore.update(flagKey, true);
  return 0;
}

/**
 * Root of the current project. For a multi-root workspace this is the first
 * folder — the folder whose `.runbook/commands.json` is used.
 */
export function currentProjectPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Display name of the current project, for section headers. */
export function currentProjectName(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return 'No Folder Open';
  }
  if (folders.length === 1) {
    return folders[0].name;
  }
  return `${folders[0].name} (+${folders.length - 1})`;
}
