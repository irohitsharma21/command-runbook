import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boolFlag, parseArgs, stringFlag, variableFlags } from '../src/cli/args';
import { resolveCommand } from '../src/cli/resolve';
import { shortId } from '../src/cli/output';
import { SavedCommand } from '../src/models/SavedCommand';

describe('CLI argument parsing', () => {
  it('reads the sub-command and positionals', () => {
    const args = parseArgs(['search', 'docker', 'logs']);
    assert.equal(args.command, 'search');
    assert.deepEqual(args.positional, ['docker', 'logs']);
  });

  it('parses long flags with a separate value', () => {
    const args = parseArgs(['save', 'ls', '--description', 'List files']);
    assert.equal(stringFlag(args, 'description', 'd'), 'List files');
    assert.deepEqual(args.positional, ['ls']);
  });

  it('parses long flags with = syntax', () => {
    const args = parseArgs(['save', '--tags=docker,deploy']);
    assert.equal(stringFlag(args, 'tags', 't'), 'docker,deploy');
  });

  it('parses short flags with a value', () => {
    const args = parseArgs(['save', 'ls', '-d', 'List']);
    assert.equal(stringFlag(args, 'description', 'd'), 'List');
  });

  it('treats unknown short flags as booleans and unbundles them', () => {
    const args = parseArgs(['list', '-gq']);
    assert.equal(boolFlag(args, 'global', 'g'), true);
    assert.equal(boolFlag(args, 'quiet', 'q'), true);
  });

  it('collects repeated -v flags', () => {
    const args = parseArgs(['run', 'deploy', '-v', 'host=1.2.3.4', '-v', 'user=ubuntu']);
    assert.deepEqual(variableFlags(args), { host: '1.2.3.4', user: 'ubuntu' });
  });

  it('keeps values containing = intact', () => {
    const args = parseArgs(['run', 'x', '-v', 'query=a=b']);
    assert.deepEqual(variableFlags(args), { query: 'a=b' });
  });

  it('passes everything after -- through untouched', () => {
    const args = parseArgs(['save', '--', 'grep', '-r', '--color', 'TODO']);
    assert.deepEqual(args.rest, ['grep', '-r', '--color', 'TODO']);
    assert.deepEqual(args.positional, []);
  });

  it('returns an empty command for no arguments', () => {
    assert.equal(parseArgs([]).command, '');
  });

  it('reports missing flags as undefined rather than throwing', () => {
    const args = parseArgs(['list']);
    assert.equal(stringFlag(args, 'description', 'd'), undefined);
    assert.equal(boolFlag(args, 'global', 'g'), false);
    assert.deepEqual(variableFlags(args), {});
  });
});

describe('CLI command resolution', () => {
  const commands: SavedCommand[] = [
    {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      command: 'docker compose up -d',
      description: 'Start Docker services',
      scope: 'project',
      tags: ['docker'],
      createdAt: 1,
      updatedAt: 1,
      usageCount: 0
    },
    {
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      command: 'docker compose logs -f',
      description: 'Follow Docker logs',
      scope: 'project',
      tags: ['docker'],
      createdAt: 2,
      updatedAt: 2,
      usageCount: 0
    },
    {
      id: 'cccccccc-1111-2222-3333-444444444444',
      command: 'lsof -i :8000',
      description: 'Find process on port',
      scope: 'global',
      tags: ['linux'],
      createdAt: 3,
      updatedAt: 3,
      usageCount: 0
    }
  ];

  it('resolves by full id', () => {
    const result = resolveCommand(commands, commands[1].id);
    assert.equal(result.kind, 'found');
    assert.equal(result.kind === 'found' && result.command.id, commands[1].id);
  });

  it('resolves by the short id shown in listings', () => {
    const result = resolveCommand(commands, shortId(commands[2].id));
    assert.equal(result.kind === 'found' && result.command.description, 'Find process on port');
  });

  it('resolves an unambiguous search', () => {
    const result = resolveCommand(commands, 'port');
    assert.equal(result.kind === 'found' && result.command.description, 'Find process on port');
  });

  it('resolves an exact description even when other commands also match', () => {
    const result = resolveCommand(commands, 'Follow Docker logs');
    assert.equal(result.kind === 'found' && result.command.id, commands[1].id);
  });

  it('refuses to guess on an ambiguous query', () => {
    const result = resolveCommand(commands, 'docker');
    assert.equal(result.kind, 'ambiguous');
    assert.equal(result.kind === 'ambiguous' && result.matches.length, 2);
  });

  it('takes the best match when --first is given', () => {
    const result = resolveCommand(commands, 'docker', { first: true });
    assert.equal(result.kind, 'found');
  });

  it('reports no match', () => {
    assert.equal(resolveCommand(commands, 'kubernetes').kind, 'none');
    assert.equal(resolveCommand(commands, '   ').kind, 'none');
  });

  it('produces stable, collision-resistant short ids', () => {
    const ids = new Set(commands.map((c) => shortId(c.id)));
    assert.equal(ids.size, commands.length);
    assert.equal(shortId(commands[0].id).length, 8);
  });
});
