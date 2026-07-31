import * as vscode from 'vscode';
import { RunbookContext, saveCommandFlow } from './shared';

/**
 * "Runbook: Add Command" — manual entry. The command text is asked for first,
 * then the shared save pipeline handles secrets, duplicates and the rest.
 */
export async function addCommand(ctx: RunbookContext): Promise<void> {
  const command = await vscode.window.showInputBox({
    title: 'Add Command — Command',
    prompt: 'The terminal command you want to remember',
    placeHolder: 'docker compose up -d --build',
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 ? 'A command cannot be empty.' : undefined
  });
  if (command === undefined) {
    return;
  }

  await saveCommandFlow(ctx, { command, title: 'Add Command' });
}
