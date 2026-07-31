import * as vscode from 'vscode';
import { confirmSecrets, promptForDetails, resolveDuplicate } from '../services/prompts';
import { RunbookContext, resolveTarget, revealCommand } from './shared';
import { log } from '../util/logger';

/**
 * "Edit" — re-runs the full detail prompt seeded with the existing values, so
 * command text, description, tags and scope can all be changed in one pass.
 */
export async function editCommand(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg, 'Select a command to edit');
  if (!saved) {
    return;
  }

  const details = await promptForDetails(ctx.store, {
    command: saved.command,
    description: saved.description,
    tags: saved.tags,
    scope: saved.scope,
    title: 'Edit Command',
    editCommand: true
  });
  if (!details) {
    return;
  }

  if (details.command !== saved.command) {
    if (!(await confirmSecrets(details.command, 'Saving'))) {
      return;
    }
    const duplicate = await resolveDuplicate(ctx.store, details.command, saved.id);
    if (duplicate.choice === 'cancel') {
      return;
    }
  }

  const updated = await ctx.store.update(saved.id, {
    command: details.command,
    description: details.description,
    tags: details.tags,
    scope: details.scope,
    projectPath: details.projectPath
  });
  ctx.refresh();

  if (updated) {
    log(`Edited command ${updated.id}`);
    void vscode.window.showInformationMessage(`Runbook: updated "${updated.description}".`);
    await revealCommand(ctx, updated);
  }
}
