import * as vscode from 'vscode';
import { CommandScope, SavedCommand } from '../models/SavedCommand';
import { CommandStore } from '../core/commandStore';
import { describeCommand } from '../core/describer';
import { detectSecrets } from '../core/secretDetector';
import { detectDangers } from '../core/dangerDetector';
import { findDuplicates } from '../core/duplicates';
import { applyVariables, extractVariables, humanizeVariableName } from '../core/templates';
import { config } from './config';
import { currentProjectName, currentProjectPath } from './storageService';

/** Result of the shared "describe this command" flow. */
export interface CommandDetails {
  command: string;
  description: string;
  tags: string[];
  scope: CommandScope;
  projectPath?: string;
}

export interface DetailsSeed {
  command: string;
  description?: string;
  tags?: string[];
  scope?: CommandScope;
  /** Shown in the step counter, e.g. "Save Last Command". */
  title: string;
  /** Allows the command text itself to be edited as the first step. */
  editCommand?: boolean;
}

/**
 * Multi-step prompt used by add, save-last and edit.
 *
 * The description step is pre-filled with an automatically generated summary
 * (fully offline, see `core/describer`) and pre-selected, so the user can accept
 * it with Enter or start typing to replace it.
 */
export async function promptForDetails(
  store: CommandStore,
  seed: DetailsSeed
): Promise<CommandDetails | undefined> {
  let command = seed.command.trim();

  if (seed.editCommand) {
    const edited = await vscode.window.showInputBox({
      title: `${seed.title} — Command`,
      prompt: 'The terminal command to save',
      value: command,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length === 0 ? 'A command cannot be empty.' : undefined
    });
    if (edited === undefined) {
      return undefined;
    }
    command = edited.trim();
  }

  const suggestion =
    seed.description ?? (config.autoDescription() ? describeCommand(command) : '');

  const description = await vscode.window.showInputBox({
    title: `${seed.title} — Description`,
    prompt: 'What does this command do? This is what you will search for later.',
    value: suggestion,
    // Pre-select the suggestion so typing overwrites it and Enter accepts it.
    valueSelection: suggestion.length > 0 ? [0, suggestion.length] : undefined,
    placeHolder: 'e.g. Rebuild and start Docker services',
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 ? 'A description makes the command findable later.' : undefined
  });
  if (description === undefined) {
    return undefined;
  }

  const knownTags = store.allTags();
  const tagInput = await vscode.window.showInputBox({
    title: `${seed.title} — Tags (optional)`,
    prompt:
      knownTags.length > 0
        ? `Comma-separated. Already in use: ${knownTags.slice(0, 12).join(', ')}`
        : 'Comma-separated, e.g. docker, deployment. Leave empty to skip.',
    value: (seed.tags ?? []).join(', '),
    placeHolder: 'docker, deployment',
    ignoreFocusOut: true
  });
  if (tagInput === undefined) {
    return undefined;
  }

  const scope = await promptForScope(store, seed.scope ?? config.defaultScope(), seed.title);
  if (scope === undefined) {
    return undefined;
  }

  const details: CommandDetails = {
    command,
    description: description.trim(),
    tags: tagInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
    scope
  };
  if (scope === 'project') {
    const projectPath = currentProjectPath();
    if (projectPath) {
      details.projectPath = projectPath;
    }
  }
  return details;
}

/** Scope picker. Skipped entirely when no folder is open. */
export async function promptForScope(
  store: CommandStore,
  preselected: CommandScope,
  title: string
): Promise<CommandScope | undefined> {
  if (!store.supportsProjectScope) {
    return 'global';
  }

  const items: Array<vscode.QuickPickItem & { scope: CommandScope }> = [
    {
      scope: 'project',
      label: '$(folder) Project',
      description: currentProjectName(),
      detail: 'Available only in this workspace'
    },
    {
      scope: 'global',
      label: '$(globe) Global',
      description: 'All workspaces',
      detail: 'Available in every project you open'
    }
  ];
  // Put the configured default first so Enter picks it.
  items.sort((a) => (a.scope === preselected ? -1 : 1));

  const picked = await vscode.window.showQuickPick(items, {
    title: `${title} — Scope`,
    placeHolder: 'Where should this command be saved?',
    ignoreFocusOut: true
  });
  return picked?.scope;
}

/**
 * Warns when a command looks like it contains credentials. Returns true if the
 * caller may proceed. Nothing is ever uploaded — the warning is about what gets
 * written to local storage and to export files.
 */
export async function confirmSecrets(command: string, action: string): Promise<boolean> {
  if (!config.warnOnSecrets()) {
    return true;
  }
  const findings = detectSecrets(command);
  if (findings.length === 0) {
    return true;
  }

  const detail = findings.map((f) => `• ${f.label}: ${f.preview}`).join('\n');
  const choice = await vscode.window.showWarningMessage(
    'This command may contain sensitive information.',
    {
      modal: true,
      detail: `${detail}\n\nRunbook stores commands locally and never uploads them, but ${action} will keep this value in plain text.`
    },
    `${action} anyway`
  );
  return choice !== undefined;
}

/**
 * Confirmation before running. Returns the action to take.
 * "Insert instead" is always offered as the safe alternative.
 */
export async function confirmRun(command: string): Promise<'run' | 'insert' | undefined> {
  const dangers = config.confirmDangerousCommands() ? detectDangers(command) : [];
  const needsConfirm = dangers.length > 0 || config.confirmBeforeRun();
  if (!needsConfirm) {
    return 'run';
  }

  const detail =
    dangers.length > 0
      ? `${command}\n\nThis looks potentially destructive:\n${dangers
          .map((d) => `• ${d.label}`)
          .join('\n')}`
      : command;

  const choice = await vscode.window.showWarningMessage(
    dangers.length > 0 ? 'Run this potentially destructive command?' : 'Run this command?',
    { modal: true, detail },
    'Run',
    'Insert into Terminal'
  );
  if (choice === 'Run') {
    return 'run';
  }
  if (choice === 'Insert into Terminal') {
    return 'insert';
  }
  return undefined;
}

export type DuplicateChoice = 'update' | 'duplicate' | 'cancel';

/**
 * Offers to update the existing entry rather than silently creating a second
 * copy of the same command.
 */
export async function resolveDuplicate(
  store: CommandStore,
  command: string,
  excludeId?: string
): Promise<{ choice: DuplicateChoice; existing?: SavedCommand }> {
  const duplicates = findDuplicates(store.all(), command, excludeId);
  if (duplicates.length === 0) {
    return { choice: 'duplicate' };
  }
  const existing = duplicates[0];
  const scopeLabel = existing.scope === 'global' ? 'Global' : 'Project';

  const choice = await vscode.window.showWarningMessage(
    'This command is already saved.',
    {
      modal: true,
      detail: `"${existing.description}"  (${scopeLabel})\n\n${existing.command}`
    },
    'Update existing',
    'Save duplicate'
  );
  if (choice === 'Update existing') {
    return { choice: 'update', existing };
  }
  if (choice === 'Save duplicate') {
    return { choice: 'duplicate', existing };
  }
  return { choice: 'cancel', existing };
}

export async function confirmDelete(command: SavedCommand): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Delete "${command.description}"?`,
    { modal: true, detail: `${command.command}\n\nThis cannot be undone.` },
    'Delete'
  );
  return choice === 'Delete';
}

/**
 * Fills in `{{variables}}` before a templated command is used. Returns the
 * resolved command, or undefined if the user cancelled.
 */
export async function resolveTemplate(
  command: string,
  purpose: string
): Promise<string | undefined> {
  const variables = extractVariables(command);
  if (variables.length === 0) {
    return command;
  }

  const values: Record<string, string> = {};
  for (let i = 0; i < variables.length; i += 1) {
    const name = variables[i];
    const value = await vscode.window.showInputBox({
      title: `${purpose} (${i + 1}/${variables.length})`,
      prompt: command,
      placeHolder: `Value for ${name}`,
      value: '',
      ignoreFocusOut: true,
      validateInput: (input) =>
        input.trim().length === 0 ? `${humanizeVariableName(name)} is required.` : undefined
    });
    if (value === undefined) {
      return undefined;
    }
    values[name] = value;
  }
  return applyVariables(command, values);
}
