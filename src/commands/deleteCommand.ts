import * as vscode from 'vscode';
import { confirmDelete } from '../services/prompts';
import { RunbookContext, resolveTarget } from './shared';
import { log } from '../util/logger';

/**
 * "Delete" — always confirmed, and offers a single-step undo because the
 * confirmation dialog is easy to click through.
 */
export async function deleteCommand(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg, 'Select a command to delete');
  if (!saved) {
    return;
  }

  if (!(await confirmDelete(saved))) {
    return;
  }

  const removed = await ctx.store.delete(saved.id);
  ctx.refresh();
  if (!removed) {
    void vscode.window.showWarningMessage('Runbook: that command no longer exists.');
    return;
  }
  log(`Deleted command ${saved.id}`);

  const choice = await vscode.window.showInformationMessage(
    `Runbook: deleted "${saved.description}".`,
    'Undo'
  );
  if (choice === 'Undo') {
    await ctx.store.add({
      command: saved.command,
      description: saved.description,
      scope: saved.scope,
      tags: saved.tags,
      projectPath: saved.projectPath
    });
    ctx.refresh();
  }
}
