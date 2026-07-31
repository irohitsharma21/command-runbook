import * as vscode from 'vscode';
import { log } from '../util/logger';

export type CaptureConfidence = 'low' | 'medium' | 'high';

export interface CapturedCommand {
  commandLine: string;
  confidence: CaptureConfidence;
  /** False when VS Code could not verify the command line came from the shell. */
  isTrusted: boolean;
  exitCode?: number;
  startedAt: number;
  cwd?: string;
  terminalName: string;
}

const MAX_HISTORY = 50;
/** Window in which a command we sent ourselves is ignored by the capture. */
const SELF_ISSUED_WINDOW_MS = 10_000;

/**
 * Tracks commands executed in integrated terminals and provides the run/insert
 * primitives.
 *
 * Capture uses the stable Terminal Shell Integration API
 * (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`,
 * finalised in VS Code 1.93). There is no supported API for reading terminal
 * scrollback or shell history, so when shell integration is unavailable the
 * history is simply empty and the caller falls back to manual entry.
 */
export class TerminalService implements vscode.Disposable {
  private readonly history: CapturedCommand[] = [];
  private readonly pending = new Map<vscode.TerminalShellExecution, CapturedCommand>();
  private readonly selfIssued: Array<{ text: string; at: number }> = [];
  private readonly disposables: vscode.Disposable[] = [];
  private sawShellIntegration = false;

  constructor() {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((event) => this.onStart(event)),
      vscode.window.onDidEndTerminalShellExecution((event) => this.onEnd(event)),
      vscode.window.onDidChangeTerminalShellIntegration(() => {
        this.sawShellIntegration = true;
      })
    );

    if (vscode.window.terminals.some((t) => t.shellIntegration !== undefined)) {
      this.sawShellIntegration = true;
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  /** True once any terminal in this window has reported shell integration. */
  get shellIntegrationAvailable(): boolean {
    return (
      this.sawShellIntegration ||
      vscode.window.terminals.some((t) => t.shellIntegration !== undefined)
    );
  }

  /** The most recent command the user ran, or undefined if none was captured. */
  getLastCommand(): CapturedCommand | undefined {
    return this.history[0];
  }

  /**
   * Recent commands, newest first and de-duplicated by command line, for the
   * "save from history" picker.
   */
  getHistory(limit = MAX_HISTORY): CapturedCommand[] {
    const seen = new Set<string>();
    const result: CapturedCommand[] = [];
    for (const entry of this.history) {
      const key = entry.commandLine.trim();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(entry);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }

  // ------------------------------------------------------------- terminal use

  /**
   * Prefers the active terminal, then the most recently opened one, and only
   * creates a terminal when none exists — so Runbook never leaves a trail of
   * empty terminals behind.
   */
  targetTerminal(): vscode.Terminal {
    const active = vscode.window.activeTerminal;
    if (active && active.exitStatus === undefined) {
      return active;
    }
    const alive = vscode.window.terminals.filter((t) => t.exitStatus === undefined);
    if (alive.length > 0) {
      return alive[alive.length - 1];
    }
    return vscode.window.createTerminal('Runbook');
  }

  /** Sends the command and presses Enter. The text is never modified. */
  runInTerminal(command: string): vscode.Terminal {
    const terminal = this.targetTerminal();
    terminal.show(true);
    this.markSelfIssued(command);
    terminal.sendText(command, true);
    return terminal;
  }

  /** Types the command into the terminal without executing it. */
  insertIntoTerminal(command: string): vscode.Terminal {
    const terminal = this.targetTerminal();
    terminal.show(false);
    this.markSelfIssued(command);
    terminal.sendText(command, false);
    return terminal;
  }

  // ---------------------------------------------------------------- internals

  private onStart(event: vscode.TerminalShellExecutionStartEvent): void {
    this.sawShellIntegration = true;
    const commandLine = event.execution.commandLine;
    const value = commandLine.value?.trim() ?? '';
    if (value.length === 0) {
      return;
    }

    const entry: CapturedCommand = {
      commandLine: value,
      confidence: toConfidence(commandLine.confidence),
      isTrusted: commandLine.isTrusted,
      startedAt: Date.now(),
      terminalName: event.terminal.name
    };
    const cwd = event.shellIntegration.cwd;
    if (cwd) {
      entry.cwd = cwd.fsPath;
    }

    this.pending.set(event.execution, entry);
    this.record(entry);
  }

  private onEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const entry = this.pending.get(event.execution);
    this.pending.delete(event.execution);
    if (!entry) {
      return;
    }
    entry.exitCode = event.exitCode;

    // The command line is often refined by the time execution ends.
    const refined = event.execution.commandLine;
    const refinedValue = refined.value?.trim() ?? '';
    if (
      refinedValue.length > 0 &&
      refined.confidence >= confidenceRank(entry.confidence) &&
      refinedValue !== entry.commandLine
    ) {
      entry.commandLine = refinedValue;
      entry.confidence = toConfidence(refined.confidence);
      entry.isTrusted = refined.isTrusted;
    }
  }

  /**
   * Adds to the history unless Runbook itself issued the command a moment ago —
   * otherwise running a saved command would immediately become "the last
   * command" and shadow whatever the user actually typed.
   */
  private record(entry: CapturedCommand): void {
    const now = Date.now();
    while (this.selfIssued.length > 0 && now - this.selfIssued[0].at > SELF_ISSUED_WINDOW_MS) {
      this.selfIssued.shift();
    }
    const index = this.selfIssued.findIndex((s) => s.text === entry.commandLine);
    if (index !== -1) {
      this.selfIssued.splice(index, 1);
      log(`Ignoring self-issued command: ${entry.commandLine}`);
      return;
    }

    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
  }

  private markSelfIssued(command: string): void {
    this.selfIssued.push({ text: command.trim(), at: Date.now() });
  }
}

function toConfidence(value: vscode.TerminalShellExecutionCommandLineConfidence): CaptureConfidence {
  switch (value) {
    case vscode.TerminalShellExecutionCommandLineConfidence.High:
      return 'high';
    case vscode.TerminalShellExecutionCommandLineConfidence.Medium:
      return 'medium';
    default:
      return 'low';
  }
}

function confidenceRank(value: CaptureConfidence): number {
  switch (value) {
    case 'high':
      return vscode.TerminalShellExecutionCommandLineConfidence.High;
    case 'medium':
      return vscode.TerminalShellExecutionCommandLineConfidence.Medium;
    default:
      return vscode.TerminalShellExecutionCommandLineConfidence.Low;
  }
}

/** Message shown when there is nothing to save because shell integration is off. */
export const SHELL_INTEGRATION_HELP =
  'Runbook could not read the last terminal command. This needs VS Code shell integration, ' +
  'which is enabled by default for bash, zsh, fish and PowerShell — check the ' +
  '"terminal.integrated.shellIntegration.enabled" setting, or open a new terminal and try again.';
