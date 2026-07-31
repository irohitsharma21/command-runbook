import * as vscode from 'vscode';
import { SORT_ORDERS, SortOrder } from '../models/SavedCommand';
import { SORT_ORDER_LABELS } from '../core/sorting';
import { config } from '../services/config';
import { RunbookContext } from './shared';

/** Filters the sidebar in place, as an alternative to the QuickPick search. */
export async function filterView(ctx: RunbookContext): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: 'Filter Runbook',
    prompt: 'Show only commands matching this text (description, command or tag)',
    value: ctx.tree.filterQuery,
    placeHolder: 'docker'
  });
  if (query === undefined) {
    return;
  }
  ctx.tree.setFilter(query);
  ctx.refresh();
}

export function clearFilter(ctx: RunbookContext): void {
  ctx.tree.setFilter('');
  ctx.refresh();
}

interface SortItem extends vscode.QuickPickItem {
  order: SortOrder;
}

export async function setSortOrder(ctx: RunbookContext): Promise<void> {
  const current = config.sortBy();
  const items: SortItem[] = SORT_ORDERS.map((order) => ({
    order,
    label: SORT_ORDER_LABELS[order],
    description: order === current ? '$(check) current' : undefined
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Sort Runbook Commands',
    placeHolder: 'Choose a sort order'
  });
  if (!picked) {
    return;
  }
  await config.setSortBy(picked.order);
  ctx.refresh();
}
