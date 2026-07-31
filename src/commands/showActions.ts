import * as vscode from 'vscode';
import { RunbookContext, resolveTarget } from './shared';

interface ActionItem extends vscode.QuickPickItem {
  commandId: string;
}

/**
 * The menu shown when a sidebar item is clicked: Run, Insert, Copy, Edit,
 * Delete. Insert is listed second on purpose — it is the safe way to reuse a
 * command you want to tweak first.
 */
export async function showActions(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg);
  if (!saved) {
    return;
  }

  const items: ActionItem[] = [
    {
      commandId: 'runbook.run',
      label: '$(play) Run',
      description: 'Execute in the active terminal'
    },
    {
      commandId: 'runbook.insert',
      label: '$(terminal) Insert into Terminal',
      description: 'Type it without running, so you can edit first'
    },
    { commandId: 'runbook.copy', label: '$(copy) Copy', description: 'Copy to the clipboard' },
    {
      commandId: 'runbook.edit',
      label: '$(edit) Edit',
      description: 'Change the command, description, tags or scope'
    },
    { commandId: 'runbook.delete', label: '$(trash) Delete', description: 'Remove from Runbook' }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: saved.description,
    placeHolder: saved.command
  });
  if (!picked) {
    return;
  }
  await vscode.commands.executeCommand(picked.commandId, {
    kind: 'command',
    id: `command:${saved.id}`,
    command: saved
  });
}
