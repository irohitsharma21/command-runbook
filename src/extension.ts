import * as vscode from 'vscode';
import { CommandTreeProvider, RunbookNode } from './providers/commandTreeProvider';
import { TerminalService } from './services/terminalService';
import { createCommandStore, migrateLegacyStorage } from './services/storageService';
import { CONFIG_SECTION } from './services/config';
import { RunbookContext } from './commands/shared';
import { addCommand } from './commands/addCommand';
import { saveFromHistory, saveLastCommand } from './commands/saveLastCommand';
import { copyCommand, insertCommand, runCommand } from './commands/runCommand';
import { editCommand } from './commands/editCommand';
import { deleteCommand } from './commands/deleteCommand';
import { searchCommands } from './commands/searchCommands';
import { showActions } from './commands/showActions';
import { exportCommands, importCommands } from './commands/exportImport';
import { clearFilter, filterView, setSortOrder } from './commands/viewCommands';
import { guard, initLogger, log, reportError } from './util/logger';

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log('Runbook activating');

  const bundle = createCommandStore(context);
  const store = bundle.store;
  const terminals = new TerminalService();
  const tree = new CommandTreeProvider(store);

  const treeView = vscode.window.createTreeView<RunbookNode>('runbook.commands', {
    treeDataProvider: tree,
    showCollapseAll: true
  });

  const ctx: RunbookContext = {
    store,
    terminals,
    tree,
    treeView,
    refresh: () => {
      tree.refresh();
      syncViewState(tree, treeView, store.isEmpty());
    }
  };

  syncViewState(tree, treeView, store.isEmpty());

  const register = (id: string, handler: (...args: unknown[]) => Promise<void> | void) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, guard(id, handler)));

  register('runbook.saveLastCommand', () => saveLastCommand(ctx));
  register('runbook.saveFromHistory', () => saveFromHistory(ctx));
  register('runbook.addCommand', () => addCommand(ctx));
  register('runbook.searchCommands', () => searchCommands(ctx));
  register('runbook.refresh', () => ctx.refresh());
  register('runbook.filter', () => filterView(ctx));
  register('runbook.clearFilter', () => clearFilter(ctx));
  register('runbook.setSortOrder', () => setSortOrder(ctx));
  register('runbook.export', () => exportCommands(ctx));
  register('runbook.import', () => importCommands(ctx));
  register('runbook.run', (arg) => runCommand(ctx, arg));
  register('runbook.insert', (arg) => insertCommand(ctx, arg));
  register('runbook.copy', (arg) => copyCommand(ctx, arg));
  register('runbook.edit', (arg) => editCommand(ctx, arg));
  register('runbook.delete', (arg) => deleteCommand(ctx, arg));
  register('runbook.showActions', (arg) => showActions(ctx, arg));

  context.subscriptions.push(
    treeView,
    terminals,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        ctx.refresh();
      }
    }),
    // Adding or removing a root in a multi-root workspace changes which project
    // commands are relevant.
    vscode.workspace.onDidChangeWorkspaceFolders(() => ctx.refresh()),
    // The CLI writes the same files, so pick up its changes live.
    ...watchStorageFiles(bundle.watchedFiles, () => {
      bundle.globalFile.invalidate();
      bundle.projectFile?.invalidate();
      ctx.refresh();
    })
  );

  // Move anything saved by an earlier version out of VS Code's private storage
  // and into the shared files, then show it.
  void migrateLegacyStorage(context, bundle)
    .then((count) => {
      if (count > 0) {
        ctx.refresh();
      }
    })
    .catch((error) => reportError('Could not migrate saved commands.', error));

  log('Runbook activated');
}

export function deactivate(): void {
  // Disposables registered on the context are released by VS Code.
}

/**
 * Watches the JSON storage files so a command saved from the CLI appears in the
 * sidebar without a reload. Watchers are created per file rather than per
 * workspace because the global file lives outside any workspace folder.
 */
function watchStorageFiles(files: readonly string[], onChange: () => void): vscode.Disposable[] {
  return files.map((file) => {
    const watcher = vscode.workspace.createFileSystemWatcher(file);
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    return watcher;
  });
}

/**
 * Keeps the `when`-clause context keys and the view header in sync with the
 * current state. `runbook.isEmpty` drives the welcome view.
 */
function syncViewState(
  tree: CommandTreeProvider,
  treeView: vscode.TreeView<RunbookNode>,
  isEmpty: boolean
): void {
  const filter = tree.filterQuery;
  void vscode.commands.executeCommand('setContext', 'runbook.isEmpty', isEmpty);
  void vscode.commands.executeCommand('setContext', 'runbook.hasFilter', filter.length > 0);

  if (filter.length > 0) {
    const count = tree.filterMatchCount;
    treeView.message = `Filtering "${filter}" — ${count} match${count === 1 ? '' : 'es'}`;
  } else {
    treeView.message = undefined;
  }
}
