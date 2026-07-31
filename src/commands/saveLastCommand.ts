import * as vscode from 'vscode';
import { CapturedCommand, SHELL_INTEGRATION_HELP } from '../services/terminalService';
import { RunbookContext, saveCommandFlow } from './shared';

/**
 * "Runbook: Save Last Command" — takes the most recent command captured from the
 * integrated terminal via the shell integration API.
 *
 * Nothing is captured until the extension is active and shell integration is
 * running, so this degrades to an explanatory message plus a manual fallback
 * rather than failing silently.
 */
export async function saveLastCommand(ctx: RunbookContext): Promise<void> {
  const last = ctx.terminals.getLastCommand();
  if (!last) {
    await offerFallback(ctx);
    return;
  }
  await saveCaptured(ctx, last, 'Save Last Command');
}

/** "Runbook: Save Command from Recent History" — pick from this session's commands. */
export async function saveFromHistory(ctx: RunbookContext): Promise<void> {
  const history = ctx.terminals.getHistory();
  if (history.length === 0) {
    await offerFallback(ctx);
    return;
  }

  interface HistoryItem extends vscode.QuickPickItem {
    captured: CapturedCommand;
  }

  const items: HistoryItem[] = history.map((captured) => ({
    captured,
    label: captured.commandLine,
    description: describeCapture(captured),
    detail: captured.cwd
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Save Command from Recent History',
    placeHolder: 'Pick a command you ran in this window',
    matchOnDescription: true
  });
  if (!picked) {
    return;
  }
  await saveCaptured(ctx, picked.captured, 'Save Command');
}

async function saveCaptured(
  ctx: RunbookContext,
  captured: CapturedCommand,
  title: string
): Promise<void> {
  // A low-confidence capture may be a partial or mangled command line, so let
  // the user correct it instead of saving something that will not run.
  const editCommand = captured.confidence === 'low' || !captured.isTrusted;
  if (editCommand) {
    void vscode.window.showWarningMessage(
      'Runbook could not read that command with full confidence — please check the text before saving.'
    );
  }

  await saveCommandFlow(ctx, {
    command: captured.commandLine,
    title,
    editCommand
  });
}

function describeCapture(captured: CapturedCommand): string {
  const bits: string[] = [captured.terminalName];
  if (captured.exitCode === 0) {
    bits.push('$(check) succeeded');
  } else if (typeof captured.exitCode === 'number') {
    bits.push(`$(error) exit ${captured.exitCode}`);
  }
  if (captured.confidence !== 'high') {
    bits.push(`${captured.confidence} confidence`);
  }
  return bits.join(' · ');
}

/**
 * Nothing was captured. Explain why (usually shell integration) and offer the
 * manual path rather than leaving the user at a dead end.
 */
async function offerFallback(ctx: RunbookContext): Promise<void> {
  const message = ctx.terminals.shellIntegrationAvailable
    ? 'Runbook has not seen a terminal command yet in this window. Run something in the integrated terminal, then try again.'
    : SHELL_INTEGRATION_HELP;

  const choice = await vscode.window.showInformationMessage(message, 'Add Command Manually');
  if (choice === 'Add Command Manually') {
    await vscode.commands.executeCommand('runbook.addCommand');
  }
}
