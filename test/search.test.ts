import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesQuery, scoreCommand, searchCommands } from '../src/core/search';
import { sortCommands } from '../src/core/sorting';
import { SavedCommand } from '../src/models/SavedCommand';

function cmd(partial: Partial<SavedCommand> & { command: string; description: string }): SavedCommand {
  return {
    id: partial.command,
    scope: 'global',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
    ...partial
  };
}

const LIBRARY: SavedCommand[] = [
  cmd({
    command: 'docker exec -it postgres psql -U postgres',
    description: 'Connect to production database',
    tags: ['database', 'docker']
  }),
  cmd({
    command: 'alembic upgrade head',
    description: 'Run PostgreSQL migrations',
    tags: ['database']
  }),
  cmd({
    command: 'docker compose logs -f',
    description: 'View Docker logs',
    tags: ['docker']
  }),
  cmd({ command: 'lsof -i :8000', description: 'Find process using port', tags: ['linux'] })
];

describe('search', () => {
  it('matches on the description', () => {
    assert.equal(matchesQuery(LIBRARY[3], 'port'), true);
  });

  it('matches on the raw command', () => {
    assert.equal(matchesQuery(LIBRARY[1], 'alembic'), true);
  });

  it('matches on tags', () => {
    assert.equal(matchesQuery(LIBRARY[2], 'docker'), true);
  });

  it('is case insensitive', () => {
    assert.equal(matchesQuery(LIBRARY[0], 'POSTGRES'), true);
    assert.equal(matchesQuery(LIBRARY[0], 'PrOdUcTiOn'), true);
  });

  it('finds commands via either the description or the command text', () => {
    const results = searchCommands(LIBRARY, 'postgres');
    const descriptions = results.map((r) => r.description);
    assert.ok(descriptions.includes('Connect to production database'));
    assert.ok(descriptions.includes('Run PostgreSQL migrations'));
    assert.equal(results.length, 2);
  });

  it('requires every term to match', () => {
    assert.equal(searchCommands(LIBRARY, 'docker logs').length, 1);
    assert.equal(searchCommands(LIBRARY, 'docker nonsense').length, 0);
  });

  it('returns everything for an empty query', () => {
    assert.equal(searchCommands(LIBRARY, '   ').length, LIBRARY.length);
  });

  it('ranks a description match above an incidental command match', () => {
    const descriptionMatch = cmd({ command: 'x', description: 'Docker cleanup' });
    const commandMatch = cmd({ command: 'run docker prune', description: 'Cleanup' });
    assert.ok(
      scoreCommand(descriptionMatch, 'docker') > scoreCommand(commandMatch, 'docker')
    );
  });

  it('puts the best match first', () => {
    const results = searchCommands(LIBRARY, 'docker');
    assert.equal(results[0].description, 'View Docker logs');
  });
});

describe('sorting', () => {
  const a = cmd({ command: 'a', description: 'Alpha', usageCount: 1, createdAt: 10, lastUsedAt: 50 });
  const b = cmd({ command: 'b', description: 'Bravo', usageCount: 9, createdAt: 40, lastUsedAt: 20 });
  // Never used, so "recent" falls back to its creation time.
  const c = cmd({ command: 'c', description: 'Charlie', usageCount: 0, createdAt: 30 });

  it('sorts by recency of use, falling back to creation time', () => {
    assert.deepEqual(
      sortCommands([a, b, c], 'recent').map((x) => x.description),
      ['Alpha', 'Charlie', 'Bravo']
    );
  });

  it('sorts by usage count', () => {
    assert.deepEqual(
      sortCommands([a, b, c], 'mostUsed').map((x) => x.description),
      ['Bravo', 'Alpha', 'Charlie']
    );
  });

  it('sorts by creation time', () => {
    assert.deepEqual(
      sortCommands([a, b, c], 'recentlyAdded').map((x) => x.description),
      ['Bravo', 'Charlie', 'Alpha']
    );
  });

  it('sorts alphabetically', () => {
    assert.deepEqual(
      sortCommands([c, b, a], 'alphabetical').map((x) => x.description),
      ['Alpha', 'Bravo', 'Charlie']
    );
  });

  it('does not mutate the input', () => {
    const input = [c, b, a];
    sortCommands(input, 'alphabetical');
    assert.equal(input[0].description, 'Charlie');
  });
});
