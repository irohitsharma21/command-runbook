import * as vscode from 'vscode';
import { CommandScope, SavedCommand } from '../models/SavedCommand';
import { CommandStore } from '../core/commandStore';
import { searchCommands } from '../core/search';
import { sortCommands } from '../core/sorting';
import { hasVariables } from '../core/templates';
import { config } from '../services/config';
import { currentProjectName } from '../services/storageService';

export interface ScopeNode {
  kind: 'scope';
  id: string;
  scope: CommandScope;
  children: RunbookNode[];
  count: number;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  label: string;
  parent: ScopeNode;
  children: CommandNode[];
}

export interface CommandNode {
  kind: 'command';
  id: string;
  command: SavedCommand;
  parent: ScopeNode | GroupNode;
}

export interface MessageNode {
  kind: 'message';
  id: string;
  label: string;
  parent: ScopeNode;
}

export type RunbookNode = ScopeNode | GroupNode | CommandNode | MessageNode;

const UNTAGGED = 'Untagged';

/**
 * Renders the sidebar. The tree is rebuilt eagerly on every refresh so that
 * `getParent` (needed by `TreeView.reveal`) is a simple lookup, and so a single
 * consistent snapshot backs the whole render pass.
 */
export class CommandTreeProvider implements vscode.TreeDataProvider<RunbookNode> {
  private readonly emitter = new vscode.EventEmitter<RunbookNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private roots: RunbookNode[] = [];
  private nodesById = new Map<string, RunbookNode>();
  private filter = '';
  private matchCount = 0;

  constructor(private readonly store: CommandStore) {
    this.rebuild();
  }

  get filterQuery(): string {
    return this.filter;
  }

  get filterMatchCount(): number {
    return this.matchCount;
  }

  setFilter(query: string): void {
    this.filter = query.trim();
    this.refresh();
  }

  refresh(): void {
    this.rebuild();
    this.emitter.fire(undefined);
  }

  findNodeForCommand(id: string): CommandNode | undefined {
    const node = this.nodesById.get(`command:${id}`);
    return node && node.kind === 'command' ? node : undefined;
  }

  getTreeItem(node: RunbookNode): vscode.TreeItem {
    switch (node.kind) {
      case 'scope':
        return this.scopeItem(node);
      case 'group':
        return this.groupItem(node);
      case 'message':
        return this.messageItem(node);
      case 'command':
      default:
        return this.commandItem(node);
    }
  }

  getChildren(node?: RunbookNode): RunbookNode[] {
    if (!node) {
      return this.roots;
    }
    if (node.kind === 'scope' || node.kind === 'group') {
      return node.children;
    }
    return [];
  }

  getParent(node: RunbookNode): RunbookNode | undefined {
    return node.kind === 'scope' ? undefined : node.parent;
  }

  // ---------------------------------------------------------------- rendering

  private scopeItem(node: ScopeNode): vscode.TreeItem {
    const isProject = node.scope === 'project';
    const item = new vscode.TreeItem(
      isProject ? 'THIS PROJECT' : 'GLOBAL COMMANDS',
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.id = node.id;
    item.contextValue = 'runbookScope';
    item.iconPath = new vscode.ThemeIcon(isProject ? 'folder' : 'globe');
    item.description = isProject
      ? `${currentProjectName()} · ${node.count}`
      : `${node.count}`;
    item.tooltip = isProject
      ? 'Commands saved for the current workspace only.'
      : 'Commands available in every workspace.';
    return item;
  }

  private groupItem(node: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.id = node.id;
    item.contextValue = 'runbookGroup';
    item.iconPath = new vscode.ThemeIcon(node.label === UNTAGGED ? 'circle-outline' : 'tag');
    item.description = `${node.children.length}`;
    return item;
  }

  private messageItem(node: MessageNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.contextValue = 'runbookMessage';
    return item;
  }

  /**
   * The description is the label because that is what the user remembers; the
   * raw command is secondary information.
   */
  private commandItem(node: CommandNode): vscode.TreeItem {
    const saved = node.command;
    const item = new vscode.TreeItem(saved.description, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = saved.command;
    item.contextValue = 'runbookCommand';
    item.iconPath = new vscode.ThemeIcon(hasVariables(saved.command) ? 'symbol-variable' : 'terminal');
    item.tooltip = buildTooltip(saved);
    item.command = {
      command: 'runbook.showActions',
      title: 'Show Actions',
      arguments: [node]
    };
    return item;
  }

  // ------------------------------------------------------------------- build

  private rebuild(): void {
    this.roots = [];
    this.nodesById = new Map();
    this.matchCount = 0;

    // An entirely empty library returns no roots so the welcome view is shown.
    if (this.store.isEmpty()) {
      return;
    }

    const scopes: CommandScope[] = [];
    if (this.store.supportsProjectScope) {
      scopes.push('project');
    }
    if (config.showGlobalCommands()) {
      scopes.push('global');
    }
    if (scopes.length === 0) {
      scopes.push('global');
    }

    const order = config.sortBy();
    const groupByTag = config.groupByTag();

    for (const scope of scopes) {
      const all = this.store.byScope(scope);
      const filtered = this.filter ? searchCommands(all, this.filter) : all;
      // Search already ranks; only re-sort when no query is narrowing results.
      const visible = this.filter ? filtered : sortCommands(filtered, order);
      this.matchCount += visible.length;

      const scopeNode: ScopeNode = {
        kind: 'scope',
        id: `scope:${scope}`,
        scope,
        children: [],
        count: visible.length
      };

      if (visible.length === 0) {
        const message: MessageNode = {
          kind: 'message',
          id: `message:${scope}`,
          label: this.filter
            ? 'No matching commands'
            : scope === 'project'
              ? 'No commands saved for this project yet'
              : 'No global commands yet',
          parent: scopeNode
        };
        scopeNode.children.push(message);
        this.register(message);
      } else if (groupByTag) {
        scopeNode.children.push(...this.buildGroups(scopeNode, visible));
      } else {
        scopeNode.children.push(...visible.map((c) => this.makeCommandNode(c, scopeNode)));
      }

      this.roots.push(scopeNode);
      this.register(scopeNode);
    }
  }

  /** Groups by first tag, preserving the incoming order within each group. */
  private buildGroups(scopeNode: ScopeNode, commands: readonly SavedCommand[]): GroupNode[] {
    const buckets = new Map<string, SavedCommand[]>();
    for (const command of commands) {
      const key = command.tags[0] ?? UNTAGGED;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(command);
      } else {
        buckets.set(key, [command]);
      }
    }

    const names = [...buckets.keys()].sort((a, b) => {
      if (a === UNTAGGED) {
        return 1;
      }
      if (b === UNTAGGED) {
        return -1;
      }
      return a.localeCompare(b);
    });

    return names.map((name) => {
      const group: GroupNode = {
        kind: 'group',
        id: `group:${scopeNode.scope}:${name}`,
        label: name === UNTAGGED ? UNTAGGED : titleCase(name),
        parent: scopeNode,
        children: []
      };
      group.children = (buckets.get(name) ?? []).map((c) => this.makeCommandNode(c, group));
      this.register(group);
      return group;
    });
  }

  private makeCommandNode(command: SavedCommand, parent: ScopeNode | GroupNode): CommandNode {
    const node: CommandNode = {
      kind: 'command',
      id: `command:${command.id}`,
      command,
      parent
    };
    this.register(node);
    return node;
  }

  private register(node: RunbookNode): void {
    this.nodesById.set(node.id, node);
  }
}

function buildTooltip(saved: SavedCommand): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${escapeMarkdown(saved.description)}**\n\n`);
  md.appendCodeblock(saved.command, 'shellscript');

  const facts: string[] = [];
  facts.push(saved.scope === 'global' ? 'Global' : 'Project');
  if (saved.tags.length > 0) {
    facts.push(saved.tags.map((t) => `\`${t}\``).join(' '));
  }
  facts.push(saved.usageCount === 1 ? 'used once' : `used ${saved.usageCount} times`);
  if (saved.lastUsedAt) {
    facts.push(`last used ${new Date(saved.lastUsedAt).toLocaleString()}`);
  }
  md.appendMarkdown(`\n${facts.join(' · ')}`);
  return md;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

function titleCase(text: string): string {
  return text
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
