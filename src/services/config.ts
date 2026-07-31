import * as vscode from 'vscode';
import { CommandScope, SortOrder, isCommandScope, isSortOrder } from '../models/SavedCommand';

export const CONFIG_SECTION = 'runbook';

/**
 * Typed, defensive access to the extension's settings. Reading through this
 * module means a malformed user setting degrades to the documented default
 * instead of propagating a bad value into the UI.
 */
export const config = {
  confirmBeforeRun(): boolean {
    return read<boolean>('confirmBeforeRun', false);
  },

  defaultScope(): CommandScope {
    const value = read<string>('defaultScope', 'project');
    return isCommandScope(value) ? value : 'project';
  },

  showGlobalCommands(): boolean {
    return read<boolean>('showGlobalCommands', true);
  },

  sortBy(): SortOrder {
    const value = read<string>('sortBy', 'recent');
    return isSortOrder(value) ? value : 'recent';
  },

  groupByTag(): boolean {
    return read<boolean>('groupByTag', true);
  },

  autoDescription(): boolean {
    return read<boolean>('autoDescription', true);
  },

  warnOnSecrets(): boolean {
    return read<boolean>('warnOnSecrets', true);
  },

  confirmDangerousCommands(): boolean {
    return read<boolean>('confirmDangerousCommands', true);
  },

  async setSortBy(order: SortOrder): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update('sortBy', order, vscode.ConfigurationTarget.Global);
  }
};

function read<T>(key: string, fallback: T): T {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key);
  return value === undefined ? fallback : value;
}
