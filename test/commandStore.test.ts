import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { CommandStore, STORAGE_KEY, sanitizeStoredCommand } from '../src/core/commandStore';
import { MemoryStore } from '../src/core/keyValueStore';

function makeStore(withWorkspace = true) {
  const globalStore = new MemoryStore();
  const workspaceStore = new MemoryStore();
  let tick = 1_000;
  let counter = 0;
  const store = new CommandStore(globalStore, withWorkspace ? workspaceStore : undefined, {
    now: () => (tick += 1),
    newId: () => `id-${++counter}`
  });
  return { store, globalStore, workspaceStore };
}

describe('CommandStore', () => {
  let ctx: ReturnType<typeof makeStore>;

  beforeEach(() => {
    ctx = makeStore();
  });

  it('adds a command and returns it with generated metadata', async () => {
    const created = await ctx.store.add({
      command: '  docker compose up -d  ',
      description: '  Start services  ',
      scope: 'project',
      tags: ['Docker', 'docker', ' deployment ']
    });

    assert.equal(created.id, 'id-1');
    assert.equal(created.command, 'docker compose up -d');
    assert.equal(created.description, 'Start services');
    assert.deepEqual(created.tags, ['docker', 'deployment'], 'tags are normalised and deduped');
    assert.equal(created.usageCount, 0);
    assert.equal(created.createdAt, created.updatedAt);
  });

  it('keeps global and project commands in separate backing stores', async () => {
    await ctx.store.add({ command: 'git status', description: 'Status', scope: 'global' });
    await ctx.store.add({ command: 'npm run dev', description: 'Dev', scope: 'project' });

    assert.equal(ctx.store.byScope('global').length, 1);
    assert.equal(ctx.store.byScope('project').length, 1);
    assert.equal((ctx.globalStore.get<unknown[]>(STORAGE_KEY) ?? []).length, 1);
    assert.equal((ctx.workspaceStore.get<unknown[]>(STORAGE_KEY) ?? []).length, 1);
    assert.equal(ctx.store.all().length, 2);
  });

  it('falls back to global scope when no workspace is open', async () => {
    const { store } = makeStore(false);
    assert.equal(store.supportsProjectScope, false);

    const created = await store.add({ command: 'ls', description: 'List', scope: 'project' });
    assert.equal(created.scope, 'global');
    assert.equal(store.byScope('project').length, 0);
    assert.equal(store.byScope('global').length, 1);
  });

  it('updates fields without touching usage counters', async () => {
    const created = await ctx.store.add({
      command: 'ls',
      description: 'List',
      scope: 'global'
    });
    const updated = await ctx.store.update(created.id, {
      description: 'List files',
      tags: ['linux']
    });

    assert.equal(updated?.description, 'List files');
    assert.deepEqual(updated?.tags, ['linux']);
    assert.equal(updated?.usageCount, 0);
    assert.ok((updated?.updatedAt ?? 0) > created.updatedAt);
  });

  it('moves a command between stores when its scope changes', async () => {
    const created = await ctx.store.add({
      command: 'npm run dev',
      description: 'Dev server',
      scope: 'project',
      projectPath: '/tmp/project'
    });
    assert.equal(ctx.store.byScope('project').length, 1);

    const moved = await ctx.store.update(created.id, { scope: 'global' });

    assert.equal(moved?.scope, 'global');
    assert.equal(moved?.projectPath, undefined, 'projectPath is dropped when going global');
    assert.equal(ctx.store.byScope('project').length, 0);
    assert.equal(ctx.store.byScope('global').length, 1);
    assert.equal(ctx.store.get(created.id)?.scope, 'global');
  });

  it('deletes commands and reports whether anything was removed', async () => {
    const created = await ctx.store.add({ command: 'ls', description: 'List', scope: 'global' });

    assert.equal(await ctx.store.delete(created.id), true);
    assert.equal(await ctx.store.delete(created.id), false);
    assert.equal(ctx.store.all().length, 0);
  });

  it('records usage', async () => {
    const created = await ctx.store.add({ command: 'ls', description: 'List', scope: 'global' });

    await ctx.store.recordUsage(created.id);
    const twice = await ctx.store.recordUsage(created.id);

    assert.equal(twice?.usageCount, 2);
    assert.ok(twice?.lastUsedAt !== undefined);
  });

  it('collects the tags in use', async () => {
    await ctx.store.add({ command: 'a', description: 'A', scope: 'global', tags: ['git'] });
    await ctx.store.add({
      command: 'b',
      description: 'B',
      scope: 'project',
      tags: ['docker', 'git']
    });

    assert.deepEqual(ctx.store.allTags(), ['docker', 'git']);
  });

  it('survives a restart by reading back what was written', async () => {
    await ctx.store.add({ command: 'ls', description: 'List', scope: 'global' });

    // A fresh CommandStore over the same backing data is what a VS Code
    // restart looks like.
    const reopened = new CommandStore(ctx.globalStore, ctx.workspaceStore);
    assert.equal(reopened.all().length, 1);
    assert.equal(reopened.all()[0].description, 'List');
  });

  it('ignores corrupted persisted data instead of throwing', async () => {
    await ctx.globalStore.update(STORAGE_KEY, 'not-an-array');
    assert.deepEqual(ctx.store.byScope('global'), []);

    await ctx.globalStore.update(STORAGE_KEY, [
      null,
      { description: 'no command text' },
      { command: '   ' },
      { command: 'valid', description: 'Valid' }
    ]);
    const recovered = ctx.store.byScope('global');
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].command, 'valid');
  });

  it('reports emptiness for the welcome view', async () => {
    assert.equal(ctx.store.isEmpty(), true);
    await ctx.store.add({ command: 'ls', description: 'List', scope: 'global' });
    assert.equal(ctx.store.isEmpty(), false);
  });
});

describe('sanitizeStoredCommand', () => {
  it('falls back to the command text when the description is missing', () => {
    const result = sanitizeStoredCommand({ command: 'git status' }, 'global');
    assert.equal(result?.description, 'git status');
  });

  it('forces the scope to match the store the record came from', () => {
    const result = sanitizeStoredCommand(
      { command: 'ls', description: 'List', scope: 'global' },
      'project'
    );
    assert.equal(result?.scope, 'project');
  });

  it('rejects records with no usable command', () => {
    assert.equal(sanitizeStoredCommand({ description: 'orphan' }, 'global'), null);
    assert.equal(sanitizeStoredCommand(null, 'global'), null);
    assert.equal(sanitizeStoredCommand(42, 'global'), null);
  });
});
