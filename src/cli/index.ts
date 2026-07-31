import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { CommandScope, SavedCommand, parseTags } from '../models/SavedCommand';
import { CommandStore, STORAGE_KEY } from '../core/commandStore';
import { JsonFileStore } from '../core/jsonFileStore';
import {
  findProjectRoot,
  globalStorageFile,
  projectStorageFile
} from '../core/paths';
import { describeCommand } from '../core/describer';
import { detectSecrets } from '../core/secretDetector';
import { detectDangers } from '../core/dangerDetector';
import { findDuplicates } from '../core/duplicates';
import { searchCommands } from '../core/search';
import { sortCommands } from '../core/sorting';
import { applyVariables, extractVariables } from '../core/templates';
import { ImportError, parseImport, serializeExport } from '../core/portable';
import { boolFlag, parseArgs, stringFlag, variableFlags, ParsedArgs } from './args';
import { formatCommand, formatList, shortId, style, write, writeError } from './output';
import { resolveCommand } from './resolve';
import { ask, confirm, isInteractive } from './prompt';
import { SHELL_INIT } from './shellInit';

const VERSION = '0.2.0';

interface Cli {
  store: CommandStore;
  projectRoot?: string;
  args: ParsedArgs;
}

/** Entry point. Returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  // Checked before the empty-command case, since `runbook --version` has no
  // sub-command and would otherwise fall through to the help text.
  if (boolFlag(args, 'version', 'V')) {
    write(VERSION);
    return 0;
  }
  if (args.command === '' || boolFlag(args, 'help', 'h')) {
    write(usage());
    return 0;
  }

  const cli = buildCli(args);

  try {
    switch (args.command) {
      case 'save':
      case 'add':
        return await cmdSave(cli);
      case 'list':
      case 'ls':
        return cmdList(cli);
      case 'search':
      case 'find':
        return cmdSearch(cli);
      case 'get':
      case 'show':
        return await cmdGet(cli);
      case 'run':
      case 'exec':
        return await cmdRun(cli);
      case 'rm':
      case 'delete':
      case 'remove':
        return await cmdRemove(cli);
      case 'tags':
        return cmdTags(cli);
      case 'export':
        return cmdExport(cli);
      case 'import':
        return await cmdImport(cli);
      case 'path':
      case 'where':
        return cmdPath(cli);
      case 'shell-init':
        return cmdShellInit(cli);
      case 'help':
        write(usage());
        return 0;
      default:
        writeError(`unknown command "${args.command}". Try: runbook help`);
        return 1;
    }
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function buildCli(args: ParsedArgs): Cli {
  const onError = (message: string, error: unknown) =>
    writeError(`${message} ${error instanceof Error ? error.message : ''}`.trim());

  const globalFile = new JsonFileStore(globalStorageFile(), {
    primaryKey: STORAGE_KEY,
    onError
  });

  const projectRoot = findProjectRoot(process.cwd());
  const projectFile = projectRoot
    ? new JsonFileStore(projectStorageFile(projectRoot), { primaryKey: STORAGE_KEY, onError })
    : undefined;

  const cli: Cli = {
    store: new CommandStore(globalFile, projectFile, { onError }),
    args
  };
  if (projectRoot) {
    cli.projectRoot = projectRoot;
  }
  return cli;
}

// ------------------------------------------------------------------- commands

async function cmdSave(cli: Cli): Promise<number> {
  let command = [...cli.args.positional, ...cli.args.rest].join(' ').trim();

  if (command.length === 0) {
    const typed = await ask('Command: ');
    command = (typed ?? '').trim();
  }
  if (command.length === 0) {
    writeError('nothing to save. Usage: runbook save "<command>"');
    return 1;
  }

  const assumeYes = boolFlag(cli.args, 'yes', 'y', 'force');

  const secrets = detectSecrets(command);
  if (secrets.length > 0 && !assumeYes) {
    write(style.yellow('This command may contain sensitive information:'));
    for (const finding of secrets) {
      write(`  ${style.dim('•')} ${finding.label}: ${finding.preview}`);
    }
    if (!(await confirm('Save anyway?'))) {
      writeError('cancelled.');
      return 1;
    }
  }

  const duplicates = findDuplicates(cli.store.all(), command);
  if (duplicates.length > 0 && !assumeYes) {
    write(style.yellow('This command is already saved as:'));
    write(formatCommand(duplicates[0]));
    if (!(await confirm('Save a duplicate?'))) {
      writeError('cancelled.');
      return 1;
    }
  }

  let description = stringFlag(cli.args, 'description', 'd');
  if (description === undefined) {
    const suggestion = describeCommand(command);
    const typed = await ask('Description: ', suggestion);
    description = (typed ?? suggestion).trim();
    if (!isInteractive()) {
      // Non-interactive: keep the generated description rather than failing.
      description = suggestion;
    }
  }
  if (description.trim().length === 0) {
    description = describeCommand(command);
  }

  const scope = resolveScope(cli);
  const created = await cli.store.add({
    command,
    description,
    scope,
    tags: parseTags(stringFlag(cli.args, 'tags', 't')),
    projectPath: scope === 'project' ? cli.projectRoot : undefined
  });

  write(`${style.green('Saved')} ${style.bold(created.description)} ${style.dim(`[${shortId(created.id)}]`)}`);
  write(style.dim(`  ${scope === 'global' ? globalStorageFile() : projectStorageFile(cli.projectRoot ?? '.')}`));
  return 0;
}

function cmdList(cli: Cli): number {
  const commands = selectScope(cli, cli.store.all());
  const sorted = sortCommands(commands, 'recent');

  if (boolFlag(cli.args, 'json')) {
    write(JSON.stringify(sorted, null, 2));
    return 0;
  }
  if (boolFlag(cli.args, 'quiet', 'q')) {
    sorted.forEach((c) => write(c.command));
    return 0;
  }
  write(formatList(sorted));
  return sorted.length > 0 ? 0 : 1;
}

function cmdSearch(cli: Cli): number {
  const query = cli.args.positional.join(' ');
  const matches = searchCommands(selectScope(cli, cli.store.all()), query);

  if (boolFlag(cli.args, 'json')) {
    write(JSON.stringify(matches, null, 2));
    return matches.length > 0 ? 0 : 1;
  }
  if (boolFlag(cli.args, 'quiet', 'q')) {
    matches.forEach((c) => write(c.command));
    return matches.length > 0 ? 0 : 1;
  }
  write(formatList(matches));
  return matches.length > 0 ? 0 : 1;
}

/** Prints only the command text, for `$(runbook get deploy)`. */
async function cmdGet(cli: Cli): Promise<number> {
  const found = await pick(cli, 'get');
  if (!found) {
    return 1;
  }
  const resolved = await fillTemplate(cli, found.command);
  if (resolved === undefined) {
    return 1;
  }
  write(resolved);
  return 0;
}

async function cmdRun(cli: Cli): Promise<number> {
  const found = await pick(cli, 'run');
  if (!found) {
    return 1;
  }

  const resolved = await fillTemplate(cli, found.command);
  if (resolved === undefined) {
    return 1;
  }

  const assumeYes = boolFlag(cli.args, 'yes', 'y');
  const dangers = detectDangers(resolved);
  if (dangers.length > 0 && !assumeYes) {
    write(style.yellow('This command looks destructive:'));
    for (const danger of dangers) {
      write(`  ${style.dim('•')} ${danger.label}`);
    }
    write(style.cyan(resolved));
    if (!(await confirm('Run it?'))) {
      writeError('cancelled.');
      return 1;
    }
  }

  write(style.dim(`$ ${resolved}`));
  const code = await runInShell(resolved);

  // Usage is recorded regardless of exit code — the user did run it.
  await cli.store.recordUsage(found.id);
  return code;
}

async function cmdRemove(cli: Cli): Promise<number> {
  const found = await pick(cli, 'rm');
  if (!found) {
    return 1;
  }
  if (!boolFlag(cli.args, 'yes', 'y', 'force')) {
    write(formatCommand(found));
    if (!(await confirm('Delete this command?'))) {
      writeError('cancelled.');
      return 1;
    }
  }
  await cli.store.delete(found.id);
  write(`${style.green('Deleted')} ${found.description}`);
  return 0;
}

function cmdTags(cli: Cli): number {
  const tags = cli.store.allTags();
  if (tags.length === 0) {
    write(style.dim('No tags yet.'));
    return 1;
  }
  tags.forEach((tag) => write(tag));
  return 0;
}

function cmdExport(cli: Cli): number {
  const commands = selectScope(cli, cli.store.all());
  const content = serializeExport(commands, Date.now());
  const target = stringFlag(cli.args, 'output', 'o');

  if (target) {
    fs.writeFileSync(target, content, 'utf8');
    write(`${style.green('Exported')} ${commands.length} command(s) to ${target}`);
  } else {
    process.stdout.write(content);
  }
  return 0;
}

async function cmdImport(cli: Cli): Promise<number> {
  const source = stringFlag(cli.args, 'file', 'f') ?? cli.args.positional[0];
  if (!source) {
    writeError('usage: runbook import <file.json>');
    return 1;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(source, 'utf8');
  } catch (error) {
    writeError(`could not read ${source}: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  let commands: SavedCommand[];
  let warnings: string[];
  try {
    ({ commands, warnings } = parseImport(raw));
  } catch (error) {
    writeError(error instanceof ImportError ? error.message : String(error));
    return 1;
  }

  const scope = resolveScope(cli);
  const existing = cli.store.all();
  const fresh = commands.filter((c) => findDuplicates(existing, c.command).length === 0);
  const skipped = commands.length - fresh.length;

  if (fresh.length === 0) {
    write(style.dim(`Nothing to import — all ${commands.length} command(s) already saved.`));
    return 0;
  }

  await cli.store.addMany(
    fresh.map((c) => ({
      command: c.command,
      description: c.description,
      scope: boolFlag(cli.args, 'global', 'g') || boolFlag(cli.args, 'project', 'p') ? scope : c.scope,
      tags: c.tags,
      projectPath: cli.projectRoot
    }))
  );

  const parts = [`${style.green('Imported')} ${fresh.length} command(s).`];
  if (skipped > 0) {
    parts.push(`${skipped} duplicate(s) skipped.`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} invalid entr(y/ies) skipped.`);
  }
  write(parts.join(' '));
  return 0;
}

function cmdPath(cli: Cli): number {
  write(`${style.bold('global')}   ${globalStorageFile()}`);
  if (cli.projectRoot) {
    write(`${style.bold('project')}  ${projectStorageFile(cli.projectRoot)}`);
  } else {
    write(style.dim('project  (no project root found from this directory)'));
  }
  return 0;
}

function cmdShellInit(cli: Cli): number {
  const shell = cli.args.positional[0] ?? 'bash';
  if (shell !== 'bash' && shell !== 'zsh') {
    writeError('usage: runbook shell-init [bash|zsh]');
    return 1;
  }
  write(SHELL_INIT[shell]);
  return 0;
}

// -------------------------------------------------------------------- helpers

function resolveScope(cli: Cli): CommandScope {
  const explicit = stringFlag(cli.args, 'scope', 's');
  if (explicit === 'global' || explicit === 'project') {
    return explicit;
  }
  if (boolFlag(cli.args, 'global', 'g')) {
    return 'global';
  }
  if (boolFlag(cli.args, 'project', 'p')) {
    return 'project';
  }
  // Without a project root there is nowhere to put a project command.
  return cli.projectRoot ? 'project' : 'global';
}

function selectScope(cli: Cli, commands: readonly SavedCommand[]): SavedCommand[] {
  if (boolFlag(cli.args, 'global', 'g')) {
    return commands.filter((c) => c.scope === 'global');
  }
  if (boolFlag(cli.args, 'project', 'p')) {
    return commands.filter((c) => c.scope === 'project');
  }
  return [...commands];
}

/** Resolves the query argument to one command, reporting failures clearly. */
async function pick(cli: Cli, verb: string): Promise<SavedCommand | undefined> {
  const query = cli.args.positional.join(' ');
  if (query.trim().length === 0) {
    writeError(`usage: runbook ${verb} <query|id>`);
    return undefined;
  }

  const result = resolveCommand(cli.store.all(), query, {
    first: boolFlag(cli.args, 'first')
  });

  if (result.kind === 'found') {
    return result.command;
  }
  if (result.kind === 'none') {
    writeError(`no command matches "${query}".`);
    return undefined;
  }

  writeError(`"${query}" matches ${result.matches.length} commands:`);
  write(formatList(result.matches.slice(0, 10)));
  write(style.dim('\nNarrow the query, use the [id] shown above, or pass --first.'));
  return undefined;
}

/** Fills `{{variables}}` from -v flags, prompting for anything still missing. */
async function fillTemplate(cli: Cli, command: string): Promise<string | undefined> {
  const variables = extractVariables(command);
  if (variables.length === 0) {
    return command;
  }

  const values = variableFlags(cli.args);
  for (const name of variables) {
    if (values[name] !== undefined) {
      continue;
    }
    if (!isInteractive()) {
      writeError(`missing value for {{${name}}}. Pass it with -v ${name}=value`);
      return undefined;
    }
    const answer = await ask(`${name}: `);
    if (answer === undefined || answer.trim().length === 0) {
      writeError('cancelled.');
      return undefined;
    }
    values[name] = answer;
  }
  return applyVariables(command, values);
}

/** Runs the command in the user's shell, inheriting stdio. */
function runInShell(command: string): Promise<number> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || (process.platform === 'win32' ? undefined : '/bin/sh');
    const child = spawn(command, {
      shell: shell ?? true,
      stdio: 'inherit'
    });
    child.on('error', (error) => {
      writeError(error.message);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

function usage(): string {
  return `${style.bold('runbook')} — save terminal commands with a description and run them again later

${style.bold('USAGE')}
  runbook <command> [options]

${style.bold('COMMANDS')}
  save <command...>     Save a command. Prompts for a description, pre-filled
                        with an automatically generated one.
  list                  List saved commands
  search <query>        Search descriptions, commands and tags
  get <query>           Print just the command text, e.g. $(runbook get deploy)
  run <query>           Run a saved command in your shell
  rm <query>            Delete a command
  tags                  List tags in use
  export                Write the library as JSON to stdout or -o <file>
  import <file>         Import a JSON export
  path                  Show where the storage files live
  shell-init [bash|zsh] Print shell integration (adds 'rbs' to save the last command)

${style.bold('OPTIONS')}
  -d, --description <text>   Description (skips the prompt)
  -t, --tags <a,b>           Comma-separated tags
  -g, --global               Global scope / filter to global
  -p, --project              Project scope / filter to project
  -v, --var key=value        Value for a {{template}} variable (repeatable)
      --first                On an ambiguous query, take the best match
  -y, --yes                  Skip confirmations
  -q, --quiet                Print only command text (pipeable)
      --json                 JSON output
  -o, --output <file>        Export destination
  -h, --help                 Show this help
  -V, --version              Show the version

${style.bold('STORAGE')}
  Global   ${globalStorageFile()}
  Project  <project>/.runbook/commands.json  (commit it to share with your team)

Shares one library with the Runbook VS Code extension.`;
}
