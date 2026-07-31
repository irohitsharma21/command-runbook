import * as vscode from 'vscode';

/**
 * Single output channel for the extension. Nothing here leaves the machine —
 * it exists so failures are diagnosable without a debugger attached.
 */
let channel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Runbook');
  context.subscriptions.push(channel);
}

export function log(message: string): void {
  channel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logError(message: string, error: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  log(`ERROR ${message} :: ${detail}`);
}

/**
 * Reports a failure to the user without ever letting it escape into the
 * extension host as an unhandled rejection.
 */
export function reportError(message: string, error: unknown): void {
  logError(message, error);
  const detail = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`Runbook: ${message} (${detail})`);
}

/** Wraps a command handler so a thrown error becomes a message, not a crash. */
export function guard<A extends unknown[]>(
  label: string,
  handler: (...args: A) => Promise<void> | void
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await handler(...args);
    } catch (error) {
      reportError(`${label} failed.`, error);
    }
  };
}
