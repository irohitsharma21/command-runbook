import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonFileStore } from '../src/core/jsonFileStore';
import { CommandStore, STORAGE_KEY } from '../src/core/commandStore';
import {
  findProjectRoot,
  globalStorageDir,
  globalStorageFile,
  projectStorageFile
} from '../src/core/paths';

let workDir: string;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-test-'));
}

function makeStore(file?: string): JsonFileStore {
  return new JsonFileStore(file ?? path.join(workDir, 'commands.json'), {
    primaryKey: STORAGE_KEY
  });
}

describe('JsonFileStore', () => {
  beforeEach(() => {
    workDir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('reads as empty when the file does not exist', () => {
    const store = makeStore();
    assert.deepEqual(store.get(STORAGE_KEY), []);
  });

  it('creates the directory tree on first write', async () => {
    const target = path.join(workDir, 'deep', 'nested', 'commands.json');
    const store = makeStore(target);

    await store.update(STORAGE_KEY, [{ command: 'ls' }]);

    assert.ok(fs.existsSync(target));
  });

  it('writes the documented export-compatible shape', async () => {
    const store = makeStore();
    await store.update(STORAGE_KEY, [{ command: 'ls', description: 'List' }]);

    const written = JSON.parse(fs.readFileSync(path.join(workDir, 'commands.json'), 'utf8'));
    assert.equal(written.version, 1);
    assert.equal(typeof written.updatedAt, 'number');
    assert.equal(written.commands.length, 1);
    assert.equal(written.commands[0].command, 'ls');
  });

  it('round-trips through a second store instance', async () => {
    await makeStore().update(STORAGE_KEY, [{ command: 'ls', description: 'List' }]);

    const reopened = makeStore();
    const commands = reopened.get<Array<{ command: string }>>(STORAGE_KEY);
    assert.equal(commands?.length, 1);
    assert.equal(commands?.[0].command, 'ls');
  });

  it('picks up a change written by another process', async () => {
    const file = path.join(workDir, 'commands.json');
    const store = makeStore(file);
    await store.update(STORAGE_KEY, [{ command: 'first' }]);
    assert.equal(store.get<unknown[]>(STORAGE_KEY)?.length, 1);

    // Simulate the CLI writing while the extension holds a cached read.
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, updatedAt: 2, commands: [{ command: 'a' }, { command: 'b' }] })
    );
    // mtime granularity can collide on fast filesystems; size differs here.
    assert.equal(store.get<unknown[]>(STORAGE_KEY)?.length, 2);
  });

  it('accepts a hand-written bare array', () => {
    const file = path.join(workDir, 'commands.json');
    fs.writeFileSync(file, JSON.stringify([{ command: 'ls', description: 'List' }]));

    assert.equal(makeStore(file).get<unknown[]>(STORAGE_KEY)?.length, 1);
  });

  it('treats an empty file as an empty library', () => {
    const file = path.join(workDir, 'commands.json');
    fs.writeFileSync(file, '   \n');
    assert.deepEqual(makeStore(file).get(STORAGE_KEY), []);
  });

  it('does not destroy an unreadable file — it backs it up first', async () => {
    const file = path.join(workDir, 'commands.json');
    fs.writeFileSync(file, '{ this is not json');

    const errors: string[] = [];
    const store = new JsonFileStore(file, {
      primaryKey: STORAGE_KEY,
      onError: (message) => errors.push(message),
      now: () => 42
    });

    assert.deepEqual(store.get(STORAGE_KEY), [], 'reads as empty rather than throwing');
    assert.ok(errors.length > 0);

    await store.update(STORAGE_KEY, [{ command: 'ls' }]);

    assert.ok(fs.existsSync(`${file}.42.bak`), 'original was preserved');
    assert.equal(fs.readFileSync(`${file}.42.bak`, 'utf8'), '{ this is not json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).commands.length, 1);
  });

  it('leaves no temp file behind after a write', async () => {
    const store = makeStore();
    await store.update(STORAGE_KEY, [{ command: 'ls' }]);
    assert.equal(fs.existsSync(path.join(workDir, 'commands.json.tmp')), false);
  });

  it('stores non-primary keys separately from the commands array', async () => {
    const store = makeStore();
    await store.update(STORAGE_KEY, [{ command: 'ls' }]);
    await store.update('someFlag', true);

    const written = JSON.parse(fs.readFileSync(path.join(workDir, 'commands.json'), 'utf8'));
    assert.equal(written.state.someFlag, true);
    assert.equal(written.commands.length, 1);
    assert.equal(makeStore().get('someFlag'), true);
  });
});

describe('CommandStore over files', () => {
  beforeEach(() => {
    workDir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('shares one library between two independent store instances', async () => {
    const globalFile = path.join(workDir, 'global.json');
    const projectFile = path.join(workDir, 'project.json');

    const makeCommandStore = () =>
      new CommandStore(
        new JsonFileStore(globalFile, { primaryKey: STORAGE_KEY }),
        new JsonFileStore(projectFile, { primaryKey: STORAGE_KEY })
      );

    // The "CLI" writes...
    const cli = makeCommandStore();
    await cli.add({ command: 'docker ps', description: 'List containers', scope: 'global' });
    await cli.add({ command: 'npm run dev', description: 'Dev server', scope: 'project' });

    // ...and the "extension", a separate instance, sees it.
    const extension = makeCommandStore();
    assert.equal(extension.all().length, 2);
    assert.equal(extension.byScope('global')[0].description, 'List containers');
    assert.equal(extension.byScope('project')[0].description, 'Dev server');
  });

  it('keeps deletions visible across instances', async () => {
    const globalFile = path.join(workDir, 'global.json');
    const a = new CommandStore(new JsonFileStore(globalFile, { primaryKey: STORAGE_KEY }), undefined);
    const created = await a.add({ command: 'ls', description: 'List', scope: 'global' });

    const b = new CommandStore(new JsonFileStore(globalFile, { primaryKey: STORAGE_KEY }), undefined);
    await b.delete(created.id);

    const c = new CommandStore(new JsonFileStore(globalFile, { primaryKey: STORAGE_KEY }), undefined);
    assert.equal(c.all().length, 0);
  });
});

describe('paths', () => {
  it('honours RUNBOOK_HOME above everything else', () => {
    assert.equal(globalStorageDir({ RUNBOOK_HOME: '/custom' }), '/custom');
    assert.equal(globalStorageFile({ RUNBOOK_HOME: '/custom' }), path.join('/custom', 'commands.json'));
  });

  it('falls back to XDG_CONFIG_HOME', () => {
    assert.equal(globalStorageDir({ XDG_CONFIG_HOME: '/xdg' }), path.join('/xdg', 'runbook'));
  });

  it('defaults to ~/.config/runbook', () => {
    assert.equal(globalStorageDir({}), path.join(os.homedir(), '.config', 'runbook'));
  });

  it('puts project storage inside the project', () => {
    assert.equal(projectStorageFile('/repo'), path.join('/repo', '.runbook', 'commands.json'));
  });

  it('finds a project root by .runbook, preferring it over .git', () => {
    const root = tempDir();
    try {
      fs.mkdirSync(path.join(root, '.git'));
      fs.mkdirSync(path.join(root, 'inner', '.runbook'), { recursive: true });
      fs.mkdirSync(path.join(root, 'inner', 'deep'), { recursive: true });

      assert.equal(fs.realpathSync(findProjectRoot(path.join(root, 'inner', 'deep')) ?? ''), fs.realpathSync(path.join(root, 'inner')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the git root', () => {
    const root = tempDir();
    try {
      fs.mkdirSync(path.join(root, '.git'));
      fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
      assert.equal(fs.realpathSync(findProjectRoot(path.join(root, 'a', 'b')) ?? ''), fs.realpathSync(root));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
