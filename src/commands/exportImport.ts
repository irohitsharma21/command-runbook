import * as vscode from 'vscode';
import { CommandScope, SavedCommand } from '../models/SavedCommand';
import { ImportError, parseImport, serializeExport } from '../core/portable';
import { detectSecrets } from '../core/secretDetector';
import { findDuplicates } from '../core/duplicates';
import { config } from '../services/config';
import { currentProjectPath } from '../services/storageService';
import { RunbookContext } from './shared';
import { log } from '../util/logger';

/**
 * "Runbook: Export Commands" — writes a plain JSON file the user chooses.
 * Nothing is uploaded; this is a local backup/transfer format.
 */
export async function exportCommands(ctx: RunbookContext): Promise<void> {
  const all = ctx.store.all();
  if (all.length === 0) {
    void vscode.window.showInformationMessage('Runbook: there is nothing to export yet.');
    return;
  }

  const scope = await pickExportScope(ctx);
  if (!scope) {
    return;
  }
  const commands = scope === 'all' ? all : all.filter((c) => c.scope === scope);
  if (commands.length === 0) {
    void vscode.window.showInformationMessage('Runbook: no commands match that selection.');
    return;
  }

  // An export file leaves the extension's storage, so warn before writing
  // anything that looks like a credential into it.
  if (config.warnOnSecrets()) {
    const risky = commands.filter((c) => detectSecrets(c.command).length > 0);
    if (risky.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `${risky.length} command${risky.length > 1 ? 's' : ''} may contain sensitive information.`,
        {
          modal: true,
          detail: `${risky
            .slice(0, 5)
            .map((c) => `• ${c.description}`)
            .join('\n')}\n\nThey will be written to the export file in plain text.`
        },
        'Export anyway',
        'Skip those commands'
      );
      if (choice === undefined) {
        return;
      }
      if (choice === 'Skip those commands') {
        const safe = commands.filter((c) => detectSecrets(c.command).length === 0);
        if (safe.length === 0) {
          void vscode.window.showInformationMessage('Runbook: nothing left to export.');
          return;
        }
        await writeExport(safe);
        return;
      }
    }
  }

  await writeExport(commands);
}

async function writeExport(commands: readonly SavedCommand[]): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const target = await vscode.window.showSaveDialog({
    title: 'Export Runbook Commands',
    defaultUri: vscode.Uri.file(`runbook-commands-${stamp}.json`),
    filters: { JSON: ['json'] }
  });
  if (!target) {
    return;
  }

  const content = serializeExport(commands, Date.now());
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  log(`Exported ${commands.length} commands to ${target.fsPath}`);

  const choice = await vscode.window.showInformationMessage(
    `Runbook: exported ${commands.length} command${commands.length > 1 ? 's' : ''}.`,
    'Open File'
  );
  if (choice === 'Open File') {
    await vscode.window.showTextDocument(target);
  }
}

async function pickExportScope(
  ctx: RunbookContext
): Promise<CommandScope | 'all' | undefined> {
  if (!ctx.store.supportsProjectScope) {
    return 'all';
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(archive) Everything', value: 'all' as const },
      { label: '$(globe) Global commands only', value: 'global' as const },
      { label: '$(folder) This project only', value: 'project' as const }
    ],
    { title: 'Export Commands', placeHolder: 'What should be exported?' }
  );
  return picked?.value;
}

/**
 * "Runbook: Import Commands" — reads an export file. Invalid entries are
 * skipped and reported rather than aborting the whole import, and existing
 * commands are never overwritten without the user asking for it.
 */
export async function importCommands(ctx: RunbookContext): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Import Runbook Commands',
    canSelectMany: false,
    filters: { JSON: ['json'] },
    openLabel: 'Import'
  });
  if (!picked || picked.length === 0) {
    return;
  }

  let raw: string;
  try {
    raw = Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8');
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Runbook: could not read that file (${error instanceof Error ? error.message : String(error)}).`
    );
    return;
  }

  let commands: SavedCommand[];
  let warnings: string[];
  try {
    ({ commands, warnings } = parseImport(raw));
  } catch (error) {
    const message = error instanceof ImportError ? error.message : String(error);
    void vscode.window.showErrorMessage(`Runbook: import failed. ${message}`);
    return;
  }

  const scope = await pickImportScope(ctx);
  if (!scope) {
    return;
  }

  const existing = ctx.store.all();
  const skipped: SavedCommand[] = [];
  const toAdd: SavedCommand[] = [];
  for (const command of commands) {
    if (findDuplicates(existing, command.command).length > 0) {
      skipped.push(command);
    } else {
      toAdd.push(command);
    }
  }

  if (toAdd.length === 0) {
    void vscode.window.showInformationMessage(
      `Runbook: all ${commands.length} command${commands.length > 1 ? 's are' : ' is'} already saved.`
    );
    return;
  }

  if (skipped.length > 0) {
    const choice = await vscode.window.showInformationMessage(
      `Import ${toAdd.length} new command${toAdd.length > 1 ? 's' : ''}?`,
      {
        modal: true,
        detail: `${skipped.length} command${skipped.length > 1 ? 's are' : ' is'} already saved and will be skipped.`
      },
      'Import'
    );
    if (choice !== 'Import') {
      return;
    }
  }

  const projectPath = currentProjectPath();
  await ctx.store.addMany(
    toAdd.map((command) => ({
      command: command.command,
      description: command.description,
      scope: scope === 'keep' ? command.scope : scope,
      tags: command.tags,
      projectPath
    }))
  );
  ctx.refresh();
  log(`Imported ${toAdd.length} commands from ${picked[0].fsPath}`);

  const parts = [`Runbook: imported ${toAdd.length} command${toAdd.length > 1 ? 's' : ''}.`];
  if (skipped.length > 0) {
    parts.push(`${skipped.length} duplicate${skipped.length > 1 ? 's' : ''} skipped.`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} entr${warnings.length > 1 ? 'ies were' : 'y was'} invalid.`);
    warnings.forEach((warning) => log(`Import warning: ${warning}`));
  }
  void vscode.window.showInformationMessage(parts.join(' '));
}

async function pickImportScope(
  ctx: RunbookContext
): Promise<CommandScope | 'keep' | undefined> {
  if (!ctx.store.supportsProjectScope) {
    return 'global';
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(archive) Keep the scope from the file', value: 'keep' as const },
      { label: '$(globe) Import everything as global', value: 'global' as const },
      { label: '$(folder) Import everything into this project', value: 'project' as const }
    ],
    { title: 'Import Commands', placeHolder: 'Where should the imported commands go?' }
  );
  return picked?.value;
}
