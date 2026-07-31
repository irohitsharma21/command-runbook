import * as vscode from 'vscode';
import { SavedCommand } from '../models/SavedCommand';
import { confirmRun, resolveTemplate } from '../services/prompts';
import { RunbookContext, resolveTarget } from './shared';
import { log } from '../util/logger';

/**
 * Executes a saved command in the terminal.
 *
 * The stored text is never rewritten: template variables are substituted only
 * with values the user typed, and a dangerous-command confirmation can redirect
 * to "insert" but never to a modified command.
 */
export async function runCommand(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg, 'Select a command to run');
  if (!saved) {
    return;
  }

  const resolved = await resolveTemplate(saved.command, `Run: ${saved.description}`);
  if (resolved === undefined) {
    return;
  }

  const action = await confirmRun(resolved);
  if (action === undefined) {
    return;
  }
  if (action === 'insert') {
    ctx.terminals.insertIntoTerminal(resolved);
    return;
  }

  ctx.terminals.runInTerminal(resolved);
  await trackUsage(ctx, saved);
}

/** Types the command into the terminal without running it. */
export async function insertCommand(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg, 'Select a command to insert');
  if (!saved) {
    return;
  }

  const resolved = await resolveTemplate(saved.command, `Insert: ${saved.description}`);
  if (resolved === undefined) {
    return;
  }

  ctx.terminals.insertIntoTerminal(resolved);
  // Inserting is not executing, so usage counters are deliberately untouched.
}

export async function copyCommand(ctx: RunbookContext, arg?: unknown): Promise<void> {
  const saved = await resolveTarget(ctx, arg, 'Select a command to copy');
  if (!saved) {
    return;
  }
  await vscode.env.clipboard.writeText(saved.command);
  void vscode.window.showInformationMessage('Runbook: command copied to the clipboard.');
}

/** Bumps usage counters; a storage failure here must not break execution. */
async function trackUsage(ctx: RunbookContext, saved: SavedCommand): Promise<void> {
  try {
    await ctx.store.recordUsage(saved.id);
    ctx.refresh();
  } catch (error) {
    log(`Could not record usage for ${saved.id}: ${String(error)}`);
  }
}
