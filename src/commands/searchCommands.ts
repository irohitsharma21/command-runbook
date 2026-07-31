import * as vscode from 'vscode';
import { SavedCommand } from '../models/SavedCommand';
import { searchCommands as rankCommands } from '../core/search';
import { sortCommands } from '../core/sorting';
import { config } from '../services/config';
import { RunbookContext, describeMeta } from './shared';

const RUN_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('play'),
  tooltip: 'Run in terminal'
};
const INSERT_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('terminal'),
  tooltip: 'Insert into terminal'
};
const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('copy'),
  tooltip: 'Copy to clipboard'
};
const EDIT_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('edit'),
  tooltip: 'Edit'
};

interface SearchItem extends vscode.QuickPickItem {
  saved: SavedCommand;
}

/**
 * "Runbook: Search Commands" — the keyboard-first entry point.
 *
 * Ranking is done by the extension rather than by QuickPick's own filter so a
 * match on the description outranks an incidental match inside the raw command.
 */
export async function searchCommands(ctx: RunbookContext): Promise<void> {
  const all = sortCommands(ctx.store.all(), config.sortBy());
  if (all.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'Runbook has no saved commands yet.',
      'Save Last Command',
      'Add Command'
    );
    if (choice === 'Save Last Command') {
      await vscode.commands.executeCommand('runbook.saveLastCommand');
    } else if (choice === 'Add Command') {
      await vscode.commands.executeCommand('runbook.addCommand');
    }
    return;
  }

  const quickPick = vscode.window.createQuickPick<SearchItem>();
  quickPick.title = 'Search Runbook';
  quickPick.placeholder = 'Search by description, command or tag — Enter runs the command';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;
  quickPick.items = toItems(all);

  // Ranking is ours, so disable QuickPick's own filtering.
  quickPick.onDidChangeValue((value) => {
    quickPick.items = toItems(rankCommands(all, value));
  });

  const done = new Promise<void>((resolve) => {
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve();
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (selected) {
        void vscode.commands.executeCommand('runbook.run', nodeFor(selected.saved));
      }
    });

    quickPick.onDidTriggerItemButton((event) => {
      const saved = event.item.saved;
      quickPick.hide();
      const target = nodeFor(saved);
      switch (event.button) {
        case INSERT_BUTTON:
          void vscode.commands.executeCommand('runbook.insert', target);
          break;
        case COPY_BUTTON:
          void vscode.commands.executeCommand('runbook.copy', target);
          break;
        case EDIT_BUTTON:
          void vscode.commands.executeCommand('runbook.edit', target);
          break;
        case RUN_BUTTON:
        default:
          void vscode.commands.executeCommand('runbook.run', target);
          break;
      }
    });
  });

  quickPick.show();
  await done;
}

function toItems(commands: readonly SavedCommand[]): SearchItem[] {
  return commands.map((saved) => ({
    saved,
    label: saved.description,
    detail: saved.command,
    description: describeMeta(saved),
    buttons: [RUN_BUTTON, INSERT_BUTTON, COPY_BUTTON, EDIT_BUTTON]
  }));
}

/** Shapes a SavedCommand like a tree node so the shared resolver accepts it. */
function nodeFor(saved: SavedCommand): { kind: 'command'; id: string; command: SavedCommand } {
  return { kind: 'command', id: `command:${saved.id}`, command: saved };
}
