import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPORT_VERSION,
  ImportError,
  buildExport,
  parseImport,
  serializeExport
} from '../src/core/portable';
import { SavedCommand } from '../src/models/SavedCommand';

const SAMPLE: SavedCommand[] = [
  {
    id: 'a',
    command: 'docker compose up -d',
    description: 'Start services',
    scope: 'project',
    tags: ['docker'],
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    usageCount: 3,
    lastUsedAt: 4
  }
];

describe('export', () => {
  it('wraps commands with a version stamp', () => {
    const result = buildExport(SAMPLE, 1234);
    assert.equal(result.version, EXPORT_VERSION);
    assert.equal(result.exportedAt, 1234);
    assert.equal(result.commands.length, 1);
  });

  it('round-trips through serialization', () => {
    const { commands } = parseImport(serializeExport(SAMPLE, 1234));
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, 'docker compose up -d');
    assert.equal(commands[0].description, 'Start services');
    assert.deepEqual(commands[0].tags, ['docker']);
    assert.equal(commands[0].usageCount, 3);
  });
});

describe('import', () => {
  it('rejects a file that is not JSON', () => {
    assert.throws(() => parseImport('not json at all'), ImportError);
  });

  it('rejects JSON without a commands array', () => {
    assert.throws(() => parseImport('{"version":1}'), ImportError);
  });

  it('rejects a newer format version', () => {
    assert.throws(
      () => parseImport(JSON.stringify({ version: 99, commands: SAMPLE })),
      /newer version of Runbook/
    );
  });

  it('accepts a bare array of commands', () => {
    const { commands } = parseImport(JSON.stringify(SAMPLE));
    assert.equal(commands.length, 1);
  });

  it('skips invalid entries but keeps the valid ones', () => {
    const raw = JSON.stringify({
      version: 1,
      commands: [
        null,
        { description: 'no command' },
        { command: 'git status', description: 'Status' },
        'a string'
      ]
    });
    const { commands, warnings } = parseImport(raw);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, 'git status');
    assert.equal(warnings.length, 3);
  });

  it('throws when nothing usable is left', () => {
    assert.throws(
      () => parseImport(JSON.stringify({ version: 1, commands: [null, {}] })),
      ImportError
    );
  });

  it('fills in defaults for partial records', () => {
    const { commands } = parseImport(JSON.stringify({ version: 1, commands: [{ command: 'ls' }] }));
    assert.equal(commands[0].description, 'ls', 'description falls back to the command');
    assert.equal(commands[0].scope, 'global');
    assert.deepEqual(commands[0].tags, []);
    assert.equal(commands[0].usageCount, 0);
    assert.ok(commands[0].id.length > 0);
  });

  it('normalises malformed tags and counters', () => {
    const raw = JSON.stringify({
      version: 1,
      commands: [{ command: 'ls', tags: ['A', 'a', 3, ' b '], usageCount: -5 }]
    });
    const { commands } = parseImport(raw);
    assert.deepEqual(commands[0].tags, ['a', 'b']);
    assert.equal(commands[0].usageCount, 0);
  });
});
