import * as vscode from 'vscode';
import { SavedCommand } from '../models/SavedCommand';
import { CommandStore } from '../core/commandStore';
import { sortCommands } from '../core/sorting';
import { CommandTreeProvider, RunbookNode } from '../providers/commandTreeProvider';
import { TerminalService } from '../services/terminalService';
import { config } from '../services/config';
import {
  DetailsSeed,
  confirmSecrets,
  promptForDetails,
  resolveDuplicate
} from '../services/prompts';
import { log } from '../util/logger';

/** Everything a command handler needs. Passed explicitly to keep handlers pure-ish. */
export interface RunbookContext {
  store: CommandStore;
  terminals: TerminalService;
  tree: CommandTreeProvider;
  treeView: vscode.TreeView<RunbookNode>;
  /** Rebuilds the tree and refreshes the `runbook.*` context keys. */
  refresh(): void;
}

/**
 * Command handlers are invoked both from the tree (with a node) and from the
 * Command Palette (with nothing), so every entry point normalises its argument
 * through here.
 */
export async function resolveTarget(
  ctx: RunbookContext,
  arg: unknown,
  placeHolder = 'Select a command'
): Promise<SavedCommand | undefined> {
  if (arg && typeof arg === 'object') {
    const node = arg as Partial<RunbookNode> & { command?: unknown };
    if (node.kind === 'command' && node.command) {
      // Re-read so we act on the current record, not a stale tree snapshot.
      const current = ctx.store.get((node.command as SavedCommand).id);
      return current ?? (node.command as SavedCommand);
    }
    if ('id' in node && 'command' in node && typeof node.command === 'string') {
      return ctx.store.get(String(node.id));
    }
  }
  return pickCommand(ctx, placeHolder);
}

interface CommandPickItem extends vscode.QuickPickItem {
  saved: SavedCommand;
}

/** Simple picker used when a handler is invoked without a target. */
export async function pickCommand(
  ctx: RunbookContext,
  placeHolder: string
): Promise<SavedCommand | undefined> {
  const all = sortCommands(ctx.store.all(), config.sortBy());
  if (all.length === 0) {
    void vscode.window.showInformationMessage(
      'Runbook has no saved commands yet. Run "Runbook: Add Command" to create one.'
    );
    return undefined;
  }

  const items: CommandPickItem[] = all.map((saved) => ({
    saved,
    label: saved.description,
    detail: saved.command,
    description: describeMeta(saved)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDetail: true,
    matchOnDescription: true
  });
  return picked?.saved;
}

export function describeMeta(saved: SavedCommand): string {
  const bits: string[] = [saved.scope === 'global' ? '$(globe) global' : '$(folder) project'];
  if (saved.tags.length > 0) {
    bits.push(saved.tags.join(', '));
  }
  if (saved.usageCount > 0) {
    bits.push(`used ${saved.usageCount}×`);
  }
  return bits.join(' · ');
}

/**
 * The shared save pipeline: secret warning, then duplicate resolution, then the
 * description/tags/scope prompts. Used by both "Add Command" and
 * "Save Last Command" so the two flows can never drift apart.
 */
export async function saveCommandFlow(
  ctx: RunbookContext,
  seed: DetailsSeed
): Promise<SavedCommand | undefined> {
  const commandText = seed.command.trim();
  if (commandText.length === 0) {
    void vscode.window.showWarningMessage('Runbook: there is no command text to save.');
    return undefined;
  }

  if (!(await confirmSecrets(commandText, 'Saving'))) {
    return undefined;
  }

  const duplicate = await resolveDuplicate(ctx.store, commandText);
  if (duplicate.choice === 'cancel') {
    return undefined;
  }

  if (duplicate.choice === 'update' && duplicate.existing) {
    const existing = duplicate.existing;
    const details = await promptForDetails(ctx.store, {
      ...seed,
      title: 'Update Command',
      command: commandText,
      description: existing.description,
      tags: existing.tags,
      scope: existing.scope,
      editCommand: false
    });
    if (!details) {
      return undefined;
    }
    const updated = await ctx.store.update(existing.id, {
      command: details.command,
      description: details.description,
      tags: details.tags,
      scope: details.scope,
      projectPath: details.projectPath
    });
    ctx.refresh();
    if (updated) {
      log(`Updated command ${updated.id}`);
      void vscode.window.showInformationMessage(`Runbook: updated "${updated.description}".`);
    }
    return updated;
  }

  const details = await promptForDetails(ctx.store, { ...seed, command: commandText });
  if (!details) {
    return undefined;
  }

  const created = await ctx.store.add({
    command: details.command,
    description: details.description,
    scope: details.scope,
    tags: details.tags,
    projectPath: details.projectPath
  });
  ctx.refresh();
  log(`Saved command ${created.id} (${created.scope})`);

  const scopeLabel = created.scope === 'global' ? 'globally' : 'for this project';
  void vscode.window.showInformationMessage(
    `Runbook: saved "${created.description}" ${scopeLabel}.`
  );
  await revealCommand(ctx, created);
  return created;
}

/** Scrolls the sidebar to a command, ignoring failures (the view may be hidden). */
export async function revealCommand(ctx: RunbookContext, saved: SavedCommand): Promise<void> {
  const node = ctx.tree.findNodeForCommand(saved.id);
  if (!node || !ctx.treeView.visible) {
    return;
  }
  try {
    await ctx.treeView.reveal(node, { select: true, focus: false });
  } catch {
    // reveal throws if the item is filtered out; not worth surfacing.
  }
}
