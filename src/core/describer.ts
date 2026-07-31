/**
 * Generates a human-readable description for a shell command.
 *
 * This is what pre-fills the description box when you save a command, so the
 * common case is "press Enter" instead of "think of a sentence". It is a local,
 * deterministic rule engine — no network, no AI, no telemetry — and the result
 * is always presented as editable text rather than being saved silently.
 *
 * Unrecognised commands fall back to a readable "Run x y" phrasing, which is
 * still better than an empty box.
 */

interface Parsed {
  /** Program name with any path stripped: `/usr/bin/docker` -> `docker`. */
  program: string;
  args: string[];
  /** True when the segment was prefixed with sudo. */
  sudo: boolean;
}

type Handler = (parsed: Parsed) => string | null;

export function describeCommand(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const segments = splitSegments(trimmed);
  if (segments.length === 0) {
    return '';
  }

  const meaningful = segments.length > 1 ? segments.filter((s) => !isNoise(s)) : segments;
  const chosen = meaningful.length > 0 ? meaningful : segments;

  const parts: string[] = [];
  for (const segment of chosen.slice(0, 2)) {
    const described = describeSegment(segment);
    if (described) {
      parts.push(described);
    }
  }

  if (parts.length === 0) {
    return capitalize(fallback(parseSegment(chosen[0])));
  }

  let text = parts[0];
  if (parts.length > 1) {
    text = `${parts[0]}, then ${lowerFirst(parts[1])}`;
  }
  if (chosen.length > 2) {
    text += ' (multi-step command)';
  }
  return capitalize(text);
}

// --------------------------------------------------------------- segmentation

/** Splits on `&&`, `||`, `;` and `|` while respecting quotes. */
export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Quote-aware tokenizer. Quotes are removed from the resulting tokens. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;

  for (const ch of segment) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current.length > 0) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function parseSegment(segment: string): Parsed {
  const tokens = tokenize(segment);
  let index = 0;
  let sudo = false;

  // Skip leading `sudo`, `env` and inline VAR=value assignments.
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === 'sudo') {
      sudo = true;
      index += 1;
      continue;
    }
    if (token === 'env' || token === 'time' || token === 'nohup') {
      index += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    break;
  }

  const rawProgram = tokens[index] ?? '';
  const program = rawProgram.split('/').pop() ?? rawProgram;
  return { program, args: tokens.slice(index + 1), sudo };
}

/** Segments that carry no meaning on their own in a chained command. */
function isNoise(segment: string): boolean {
  const { program } = parseSegment(segment);
  return ['cd', 'clear', 'export', 'source', '.', 'true', 'pwd', 'ls'].includes(program);
}

// ------------------------------------------------------------- flag utilities

function hasFlag(args: readonly string[], ...specs: string[]): boolean {
  for (const spec of specs) {
    if (spec.startsWith('--')) {
      if (args.some((a) => a === spec || a.startsWith(`${spec}=`))) {
        return true;
      }
    } else if (spec.startsWith('-') && spec.length === 2) {
      const letter = spec[1];
      // Matches both `-d` and bundled forms such as `-itd`.
      if (args.some((a) => /^-[A-Za-z]+$/.test(a) && a.slice(1).includes(letter))) {
        return true;
      }
    } else if (args.includes(spec)) {
      return true;
    }
  }
  return false;
}

function flagValue(args: readonly string[], ...specs: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    for (const spec of specs) {
      if (arg === spec) {
        const next = args[i + 1];
        return next && !next.startsWith('-') ? next : undefined;
      }
      if (arg.startsWith(`${spec}=`)) {
        return arg.slice(spec.length + 1);
      }
      // `-p8000` style.
      if (spec.length === 2 && arg.startsWith(spec) && arg.length > 2 && !spec.startsWith('--')) {
        return arg.slice(2);
      }
    }
  }
  return undefined;
}

/** Non-flag arguments, ignoring values that clearly belong to a flag. */
function positionals(args: readonly string[], valueFlags: string[] = []): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (valueFlags.includes(arg)) {
        i += 1;
      }
      continue;
    }
    result.push(arg);
  }
  return result;
}

const NAMESPACE_FLAGS = ['-n', '--namespace'];

function namespaceSuffix(args: readonly string[]): string {
  if (hasFlag(args, '--all-namespaces', '-A')) {
    return ' across all namespaces';
  }
  const ns = flagValue(args, '-n', '--namespace');
  return ns ? ` in the '${ns}' namespace` : '';
}

// -------------------------------------------------------------------- handlers

const HANDLERS: Record<string, Handler> = {
  docker: describeDocker,
  'docker-compose': (p) => describeCompose(p.args),
  podman: describeDocker,
  git: describeGit,
  npm: describeNodePackageManager('npm'),
  pnpm: describeNodePackageManager('pnpm'),
  yarn: describeNodePackageManager('yarn'),
  bun: describeNodePackageManager('bun'),
  npx: ({ args }) => (args.length ? `Run ${args[0]} with npx` : 'Run a package binary with npx'),
  node: ({ args }) => {
    const file = positionals(args)[0];
    return file ? `Run ${file} with Node.js` : 'Start a Node.js REPL';
  },
  python: describePython,
  python3: describePython,
  pip: describePip,
  pip3: describePip,
  uv: describeUv,
  pytest: ({ args }) => {
    const target = positionals(args, ['-k', '-m'])[0];
    return target ? `Run the tests in ${target}` : 'Run the test suite with pytest';
  },
  uvicorn: describeUvicorn,
  gunicorn: ({ args }) => {
    const app = positionals(args, ['-w', '-b', '-k'])[0];
    return app ? `Start the Gunicorn server for ${app}` : 'Start the Gunicorn server';
  },
  alembic: describeAlembic,
  kubectl: describeKubectl,
  k9s: () => 'Open the k9s Kubernetes dashboard',
  helm: describeHelm,
  terraform: describeTerraform,
  aws: describeAws,
  ssh: describeSsh,
  scp: ({ args }) => {
    const paths = positionals(args, ['-i', '-P']);
    return paths.length >= 2 ? `Copy ${paths[0]} to ${paths[1]} over SSH` : 'Copy files over SSH';
  },
  rsync: ({ args }) => {
    const paths = positionals(args, ['-e']);
    return paths.length >= 2 ? `Sync ${paths[0]} to ${paths[1]} with rsync` : 'Sync files with rsync';
  },
  psql: describePsql,
  mysql: ({ args }) => {
    const db = flagValue(args, '-D', '--database') ?? positionals(args, ['-u', '-h', '-p'])[0];
    return db ? `Connect to the ${db} MySQL database` : 'Connect to MySQL';
  },
  mongosh: () => 'Open a MongoDB shell',
  mongo: () => 'Open a MongoDB shell',
  'redis-cli': () => 'Open a Redis command-line session',
  systemctl: describeSystemctl,
  journalctl: describeJournalctl,
  lsof: describeLsof,
  netstat: () => 'List network connections and listening ports',
  ss: () => 'List network sockets and listening ports',
  ps: () => 'List running processes',
  kill: ({ args }) => {
    const pid = positionals(args)[0];
    return pid ? `Kill process ${pid}` : 'Kill a process';
  },
  pkill: ({ args }) => {
    const name = positionals(args)[0];
    return name ? `Kill processes matching '${name}'` : 'Kill processes by name';
  },
  killall: ({ args }) => {
    const name = positionals(args)[0];
    return name ? `Kill all '${name}' processes` : 'Kill processes by name';
  },
  curl: describeCurl,
  wget: ({ args }) => {
    const url = positionals(args, ['-O'])[0];
    return url ? `Download ${shortUrl(url)}` : 'Download a file';
  },
  grep: describeGrep,
  rg: describeGrep,
  find: describeFind,
  tar: describeTar,
  make: ({ args }) => {
    const target = positionals(args)[0];
    return target ? `Run the '${target}' make target` : 'Build the project with make';
  },
  chmod: ({ args }) => {
    const pos = positionals(args);
    return pos.length >= 2
      ? `Set permissions ${pos[0]} on ${pos[1]}`
      : 'Change file permissions';
  },
  chown: ({ args }) => {
    const pos = positionals(args);
    return pos.length >= 2 ? `Change the owner of ${pos[1]} to ${pos[0]}` : 'Change file ownership';
  },
  df: () => 'Show free disk space',
  du: ({ args }) => {
    const target = positionals(args)[0];
    return target ? `Show the disk usage of ${target}` : 'Show disk usage';
  },
  free: () => 'Show memory usage',
  top: () => 'Monitor running processes',
  htop: () => 'Monitor running processes',
  nvidia_smi: () => 'Show GPU status',
  tail: ({ args }) => {
    const file = positionals(args, ['-n'])[0];
    const follow = hasFlag(args, '-f', '--follow') ? 'Follow' : 'Show the end of';
    return file ? `${follow} ${file}` : `${follow} a log file`;
  },
  apt: describeApt,
  'apt-get': describeApt,
  brew: describeApt,
  pm2: ({ args }) => {
    const sub = positionals(args)[0];
    const app = positionals(args)[1];
    if (!sub) {
      return 'Manage processes with pm2';
    }
    return app ? `${capitalize(sub)} the '${app}' pm2 process` : `${capitalize(sub)} pm2 processes`;
  },
  cd: ({ args }) => {
    const target = positionals(args)[0];
    return target ? `Change directory to ${target}` : 'Change to the home directory';
  },
  source: describeSource,
  '.': describeSource,
  ls: () => 'List files in the current directory',
  echo: ({ args }) => (args.length ? `Print "${args.join(' ')}"` : 'Print an empty line')
};

// ------------------------------------------------------------ tool describers

function describeDocker({ args }: Parsed): string | null {
  const sub = args[0];
  if (!sub) {
    return null;
  }
  if (sub === 'compose') {
    return describeCompose(args.slice(1));
  }
  const rest = args.slice(1);
  const pos = positionals(rest);

  switch (sub) {
    case 'ps':
      return hasFlag(rest, '-a', '--all')
        ? 'List all Docker containers'
        : 'List running Docker containers';
    case 'images':
      return 'List local Docker images';
    case 'build': {
      const tag = flagValue(rest, '-t', '--tag');
      return tag ? `Build the ${tag} Docker image` : 'Build a Docker image';
    }
    case 'run': {
      const image = positionals(rest, ['-p', '-v', '-e', '--name', '--network'])[0];
      const detached = hasFlag(rest, '-d', '--detach') ? ' in the background' : '';
      return image ? `Run the ${image} Docker image${detached}` : `Run a Docker container${detached}`;
    }
    case 'exec': {
      const container = positionals(rest, ['-e', '-u', '-w'])[0];
      const inner = positionals(rest, ['-e', '-u', '-w']).slice(1);
      if (container && inner.length > 0 && /^(?:ba|z|fi|)sh$/.test(inner[0])) {
        return `Open a shell inside the '${container}' container`;
      }
      if (container && inner.length > 0) {
        return `Run ${inner.join(' ')} inside the '${container}' container`;
      }
      return container ? `Run a command inside the '${container}' container` : null;
    }
    case 'logs': {
      const container = positionals(rest, ['--tail', '--since'])[0];
      const verb = hasFlag(rest, '-f', '--follow') ? 'Follow' : 'Show';
      return container ? `${verb} the logs of the '${container}' container` : `${verb} container logs`;
    }
    case 'stop':
    case 'start':
    case 'restart':
      return pos.length
        ? `${capitalize(sub)} the '${pos[0]}' Docker container`
        : `${capitalize(sub)} Docker containers`;
    case 'rm':
      return pos.length ? `Remove the '${pos[0]}' Docker container` : 'Remove Docker containers';
    case 'rmi':
      return pos.length ? `Remove the ${pos[0]} Docker image` : 'Remove Docker images';
    case 'pull':
      return pos.length ? `Pull the ${pos[0]} Docker image` : 'Pull a Docker image';
    case 'push':
      return pos.length ? `Push the ${pos[0]} Docker image` : 'Push a Docker image';
    case 'system':
      return rest[1] === 'prune' ? 'Clean up unused Docker resources' : 'Manage the Docker system';
    case 'volume':
      return rest[1] === 'ls' ? 'List Docker volumes' : 'Manage Docker volumes';
    case 'network':
      return rest[1] === 'ls' ? 'List Docker networks' : 'Manage Docker networks';
    case 'inspect':
      return pos.length ? `Inspect the Docker object '${pos[0]}'` : 'Inspect a Docker object';
    case 'stats':
      return 'Show live Docker container resource usage';
    default:
      return null;
  }
}

function describeCompose(args: readonly string[]): string | null {
  // Skip global compose flags such as `-f docker-compose.prod.yml`.
  const cleaned = [...args];
  while (cleaned.length > 0 && cleaned[0].startsWith('-')) {
    const flag = cleaned.shift() as string;
    if (['-f', '--file', '-p', '--project-name', '--env-file'].includes(flag)) {
      cleaned.shift();
    }
  }
  const sub = cleaned[0];
  if (!sub) {
    return null;
  }
  const rest = cleaned.slice(1);
  const services = positionals(rest, ['--scale']);
  const target = services.length ? `the ${services.join(', ')} service${services.length > 1 ? 's' : ''}` : 'Docker services';

  switch (sub) {
    case 'up': {
      const rebuild = hasFlag(rest, '--build');
      const detached = hasFlag(rest, '-d', '--detach');
      const verb = rebuild ? 'Rebuild and start' : 'Start';
      return `${verb} ${target}${detached ? ' in the background' : ''}`;
    }
    case 'down': {
      const extras: string[] = [];
      if (hasFlag(rest, '--remove-orphans')) {
        extras.push('orphan containers');
      }
      if (hasFlag(rest, '-v', '--volumes')) {
        extras.push('volumes');
      }
      const suffix = extras.length ? ` and remove ${extras.join(' and ')}` : '';
      return `Stop ${target}${suffix}`;
    }
    case 'build':
      return `Build the images for ${target}`;
    case 'logs':
      return `${hasFlag(rest, '-f', '--follow') ? 'Follow' : 'Show'} the logs of ${target}`;
    case 'restart':
      return `Restart ${target}`;
    case 'stop':
      return `Stop ${target}`;
    case 'start':
      return `Start ${target}`;
    case 'ps':
      return 'List Docker Compose services';
    case 'pull':
      return `Pull the images for ${target}`;
    case 'exec': {
      const container = services[0];
      const inner = services.slice(1);
      if (container && inner.length && /^(?:ba|z|fi|)sh$/.test(inner[0])) {
        return `Open a shell in the '${container}' service`;
      }
      return container
        ? `Run ${inner.join(' ') || 'a command'} in the '${container}' service`
        : null;
    }
    case 'run':
      return services.length ? `Run a one-off command in the '${services[0]}' service` : null;
    case 'config':
      return 'Show the resolved Docker Compose configuration';
    default:
      return null;
  }
}

function describeGit({ args }: Parsed): string | null {
  const sub = args[0];
  if (!sub) {
    return null;
  }
  const rest = args.slice(1);
  const pos = positionals(rest, ['-m', '-b']);

  switch (sub) {
    case 'status':
      return 'Show the working tree status';
    case 'add':
      return pos.length && pos[0] !== '.'
        ? `Stage ${pos.join(', ')}`
        : 'Stage all changes';
    case 'commit': {
      if (hasFlag(rest, '--amend')) {
        return 'Amend the previous commit';
      }
      const message = flagValue(rest, '-m', '--message');
      return message ? `Commit staged changes: "${message}"` : 'Commit staged changes';
    }
    case 'push': {
      if (hasFlag(rest, '--force-with-lease')) {
        return 'Force push safely (with lease)';
      }
      if (hasFlag(rest, '--force', '-f')) {
        return 'Force push to the remote';
      }
      if (hasFlag(rest, '--tags')) {
        return 'Push tags to the remote';
      }
      return pos.length >= 2 ? `Push ${pos[1]} to ${pos[0]}` : 'Push commits to the remote';
    }
    case 'pull':
      return hasFlag(rest, '--rebase')
        ? 'Pull remote changes and rebase on top of them'
        : 'Pull the latest changes from the remote';
    case 'fetch':
      return hasFlag(rest, '--prune', '-p')
        ? 'Fetch from the remote and prune deleted branches'
        : 'Fetch the latest refs from the remote';
    case 'clone':
      return pos.length ? `Clone ${pos[0]}` : 'Clone a repository';
    case 'checkout':
    case 'switch': {
      if (hasFlag(rest, '-b', '-c')) {
        const branch = flagValue(rest, '-b', '-c') ?? pos[0];
        return branch ? `Create and switch to the ${branch} branch` : 'Create a new branch';
      }
      return pos.length ? `Switch to ${pos[0]}` : 'Switch branches';
    }
    case 'branch': {
      if (hasFlag(rest, '-D')) {
        return pos.length ? `Force-delete the ${pos[0]} branch` : 'Force-delete a branch';
      }
      if (hasFlag(rest, '-d', '--delete')) {
        return pos.length ? `Delete the ${pos[0]} branch` : 'Delete a branch';
      }
      if (hasFlag(rest, '--merged')) {
        return 'List branches already merged into the current one';
      }
      return 'List branches';
    }
    case 'merge':
      return pos.length ? `Merge ${pos[0]} into the current branch` : 'Merge a branch';
    case 'rebase':
      return hasFlag(rest, '-i', '--interactive')
        ? `Interactively rebase${pos.length ? ` onto ${pos[0]}` : ''}`
        : `Rebase${pos.length ? ` onto ${pos[0]}` : ' the current branch'}`;
    case 'reset': {
      if (hasFlag(rest, '--hard')) {
        return `Discard all local changes${pos.length ? ` and reset to ${pos[0]}` : ''}`;
      }
      if (hasFlag(rest, '--soft')) {
        return pos.length && /HEAD~1?$/.test(pos[0])
          ? 'Undo the last commit but keep the changes staged'
          : 'Soft reset, keeping the changes staged';
      }
      return pos.length ? `Reset to ${pos[0]}` : 'Unstage changes';
    }
    case 'revert':
      return pos.length ? `Revert commit ${pos[0]}` : 'Revert a commit';
    case 'stash':
      if (rest[0] === 'pop') {
        return 'Restore the most recently stashed changes';
      }
      if (rest[0] === 'list') {
        return 'List stashed changes';
      }
      return 'Stash the current changes';
    case 'log':
      return hasFlag(rest, '--oneline') ? 'Show a compact commit log' : 'Show the commit history';
    case 'diff':
      return hasFlag(rest, '--staged', '--cached')
        ? 'Show the staged changes'
        : 'Show the uncommitted changes';
    case 'clean':
      return 'Delete untracked files';
    case 'remote':
      return rest[0] === '-v' || rest[0] === 'show' ? 'Show the configured remotes' : 'Manage remotes';
    case 'tag':
      return pos.length ? `Create the ${pos[0]} tag` : 'List tags';
    case 'cherry-pick':
      return pos.length ? `Cherry-pick commit ${pos[0]}` : 'Cherry-pick a commit';
    case 'submodule':
      return 'Update the git submodules';
    default:
      return null;
  }
}

function describeNodePackageManager(manager: string): Handler {
  return ({ args }) => {
    const sub = args[0];
    const rest = args.slice(1);
    const pos = positionals(rest);

    if (!sub || sub.startsWith('-')) {
      return manager === 'yarn' ? 'Install project dependencies' : null;
    }
    if (sub === 'install' || sub === 'i' || sub === 'add') {
      if (pos.length === 0) {
        return 'Install project dependencies';
      }
      const dev = hasFlag(rest, '-D', '--save-dev', '--dev') ? ' as a dev dependency' : '';
      return `Install ${pos.join(', ')}${dev}`;
    }
    if (sub === 'ci') {
      return 'Install dependencies from the lockfile';
    }
    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') {
      return pos.length ? `Uninstall ${pos.join(', ')}` : 'Uninstall a package';
    }
    if (sub === 'run' || sub === 'run-script') {
      return pos.length ? `Run the '${pos[0]}' ${manager} script` : `Run an ${manager} script`;
    }
    if (sub === 'test') {
      return 'Run the test suite';
    }
    if (sub === 'start') {
      return 'Start the application';
    }
    if (sub === 'build') {
      return 'Build the project';
    }
    if (sub === 'publish') {
      return 'Publish the package to the registry';
    }
    if (sub === 'outdated') {
      return 'List outdated dependencies';
    }
    if (sub === 'audit') {
      return 'Audit dependencies for vulnerabilities';
    }
    // `npm dev` is not valid, but `yarn dev` / `pnpm dev` / `bun dev` are.
    if (manager !== 'npm') {
      return `Run the '${sub}' ${manager} script`;
    }
    return null;
  };
}

function describePython({ args }: Parsed): string | null {
  const moduleName = flagValue(args, '-m');
  if (moduleName) {
    const rest = args.slice(args.indexOf('-m') + 2);
    if (moduleName === 'venv') {
      return 'Create a Python virtual environment';
    }
    if (moduleName === 'pip') {
      return describePip({ program: 'pip', args: rest, sudo: false });
    }
    if (moduleName === 'http.server') {
      const port = positionals(rest)[0];
      return port ? `Serve the current directory over HTTP on port ${port}` : 'Serve the current directory over HTTP';
    }
    if (moduleName === 'pytest') {
      return 'Run the test suite with pytest';
    }
    if (moduleName === 'uvicorn') {
      return describeUvicorn({ program: 'uvicorn', args: rest, sudo: false });
    }
    return `Run the ${moduleName} Python module`;
  }

  const file = positionals(args)[0];
  if (!file) {
    return 'Open a Python REPL';
  }
  if (file === 'manage.py') {
    return describeDjango(args.slice(args.indexOf(file) + 1));
  }
  return `Run ${file}`;
}

function describeDjango(args: readonly string[]): string {
  const sub = positionals(args)[0];
  switch (sub) {
    case 'runserver': {
      const bind = positionals(args)[1];
      return bind ? `Start the Django development server on ${bind}` : 'Start the Django development server';
    }
    case 'migrate':
      return 'Apply Django database migrations';
    case 'makemigrations':
      return 'Create new Django database migrations';
    case 'createsuperuser':
      return 'Create a Django superuser';
    case 'collectstatic':
      return 'Collect Django static files';
    case 'shell':
      return 'Open the Django shell';
    case 'test':
      return 'Run the Django test suite';
    default:
      return sub ? `Run the Django '${sub}' management command` : 'Run a Django management command';
  }
}

function describePip({ args }: Parsed): string | null {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'install') {
    const requirements = flagValue(rest, '-r', '--requirement');
    if (requirements) {
      return `Install Python dependencies from ${requirements}`;
    }
    const pos = positionals(rest);
    if (pos.length === 0) {
      return 'Install Python dependencies';
    }
    if (pos[0] === '.' || pos[0] === '-e') {
      return 'Install the current project in editable mode';
    }
    return `Install the ${pos.join(', ')} Python package${pos.length > 1 ? 's' : ''}`;
  }
  if (sub === 'uninstall') {
    const pos = positionals(rest);
    return pos.length ? `Uninstall the ${pos.join(', ')} Python package` : 'Uninstall a Python package';
  }
  if (sub === 'freeze') {
    return 'List the installed Python packages with their versions';
  }
  if (sub === 'list') {
    return 'List the installed Python packages';
  }
  return null;
}

function describeUv({ args }: Parsed): string | null {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'sync') {
    return 'Sync the Python environment with the lockfile';
  }
  if (sub === 'pip') {
    return describePip({ program: 'pip', args: rest, sudo: false });
  }
  if (sub === 'run') {
    const pos = positionals(rest);
    return pos.length ? `Run ${pos.join(' ')} in the uv environment` : 'Run a command in the uv environment';
  }
  if (sub === 'venv') {
    return 'Create a Python virtual environment with uv';
  }
  if (sub === 'add') {
    const pos = positionals(rest);
    return pos.length ? `Add ${pos.join(', ')} to the project dependencies` : null;
  }
  return null;
}

function describeUvicorn({ args }: Parsed): string {
  const app = positionals(args, ['--host', '--port', '--workers', '--log-level'])[0];
  const extras: string[] = [];
  if (hasFlag(args, '--reload')) {
    extras.push('auto-reload');
  }
  const port = flagValue(args, '--port');
  if (port) {
    extras.push(`port ${port}`);
  }
  const suffix = extras.length ? ` with ${extras.join(' on ')}` : '';
  return app ? `Start the ${app} server with Uvicorn${suffix}` : `Start the Uvicorn server${suffix}`;
}

function describeAlembic({ args }: Parsed): string | null {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'upgrade') {
    const target = positionals(rest)[0];
    return target === 'head'
      ? 'Apply all pending database migrations'
      : `Upgrade the database to revision ${target ?? 'a specific revision'}`;
  }
  if (sub === 'downgrade') {
    return 'Roll back a database migration';
  }
  if (sub === 'revision') {
    return hasFlag(rest, '--autogenerate')
      ? 'Auto-generate a new database migration'
      : 'Create a new database migration';
  }
  if (sub === 'current' || sub === 'history') {
    return 'Show the database migration status';
  }
  return null;
}

function describeKubectl({ args }: Parsed): string | null {
  const sub = args[0];
  if (!sub) {
    return null;
  }
  const rest = args.slice(1);
  const pos = positionals(rest, [...NAMESPACE_FLAGS, '-o', '--output', '-l', '--selector']);
  const ns = namespaceSuffix(rest);
  const resource = pos[0];
  const name = pos[1];

  switch (sub) {
    case 'get':
      return resource ? `List ${resource}${ns}` : `List Kubernetes resources${ns}`;
    case 'describe':
      return name ? `Describe the ${resource} '${name}'${ns}` : `Describe a ${resource ?? 'resource'}${ns}`;
    case 'logs': {
      const verb = hasFlag(rest, '-f', '--follow') ? 'Follow' : 'Show';
      return resource ? `${verb} the logs of ${resource}${ns}` : `${verb} pod logs${ns}`;
    }
    case 'apply': {
      const file = flagValue(rest, '-f', '--filename');
      return file ? `Apply the Kubernetes manifest ${file}${ns}` : `Apply Kubernetes manifests${ns}`;
    }
    case 'delete':
      return name
        ? `Delete the ${resource} '${name}'${ns}`
        : `Delete Kubernetes ${resource ?? 'resources'}${ns}`;
    case 'exec':
      return resource ? `Open a shell in the '${resource}' pod${ns}` : `Run a command in a pod${ns}`;
    case 'port-forward':
      return resource ? `Forward a local port to ${resource}${ns}` : `Forward a local port${ns}`;
    case 'rollout':
      return `${capitalize(pos[0] ?? 'manage')} the rollout of ${pos[1] ?? 'a deployment'}${ns}`;
    case 'scale':
      return `Scale ${resource ?? 'a deployment'}${ns}`;
    case 'config':
      return 'Manage the kubectl configuration';
    default:
      return null;
  }
}

function describeHelm({ args }: Parsed): string | null {
  const sub = args[0];
  const rest = args.slice(1);
  const pos = positionals(rest, [...NAMESPACE_FLAGS, '-f', '--values']);
  const ns = namespaceSuffix(rest);
  if (sub === 'install' || sub === 'upgrade') {
    return pos.length ? `${capitalize(sub)} the '${pos[0]}' Helm release${ns}` : null;
  }
  if (sub === 'uninstall' || sub === 'delete') {
    return pos.length ? `Uninstall the '${pos[0]}' Helm release${ns}` : null;
  }
  if (sub === 'list' || sub === 'ls') {
    return `List Helm releases${ns}`;
  }
  return null;
}

function describeTerraform({ args }: Parsed): string | null {
  switch (args[0]) {
    case 'init':
      return 'Initialise the Terraform working directory';
    case 'plan':
      return 'Preview the Terraform infrastructure changes';
    case 'apply':
      return 'Apply the Terraform infrastructure changes';
    case 'destroy':
      return 'Destroy the Terraform-managed infrastructure';
    case 'fmt':
      return 'Format the Terraform files';
    case 'validate':
      return 'Validate the Terraform configuration';
    default:
      return null;
  }
}

function describeAws({ args }: Parsed): string | null {
  const service = args[0];
  const sub = args[1];
  if (!service) {
    return null;
  }
  if (service === 's3') {
    const pos = positionals(args.slice(2));
    if (sub === 'ls') {
      return pos.length ? `List the contents of ${pos[0]}` : 'List the S3 buckets';
    }
    if (sub === 'cp' || sub === 'sync') {
      return pos.length >= 2 ? `${capitalize(sub)} ${pos[0]} to ${pos[1]} in S3` : `${capitalize(sub)} files with S3`;
    }
    if (sub === 'rm') {
      return pos.length ? `Delete ${pos[0]} from S3` : 'Delete an object from S3';
    }
  }
  if (service === 'ecr' && sub === 'get-login-password') {
    return 'Authenticate Docker against Amazon ECR';
  }
  return sub ? `Run the AWS CLI command '${service} ${sub}'` : `Run an AWS ${service} command`;
}

function describeSsh({ args }: Parsed): string {
  const target = positionals(args, ['-i', '-p', '-L', '-R', '-D', '-o'])[0];
  const key = flagValue(args, '-i');
  const tunnel = flagValue(args, '-L') ?? flagValue(args, '-R');
  if (tunnel) {
    return target ? `Open an SSH tunnel (${tunnel}) via ${target}` : `Open an SSH tunnel (${tunnel})`;
  }
  const keySuffix = key ? ` using ${key}` : '';
  return target ? `Connect to ${target} over SSH${keySuffix}` : 'Connect to a server over SSH';
}

function describePsql({ args }: Parsed): string {
  const db = flagValue(args, '-d', '--dbname') ?? positionals(args, ['-h', '-U', '-p', '-c'])[0];
  const host = flagValue(args, '-h', '--host');
  const query = flagValue(args, '-c', '--command');
  if (query) {
    return `Run a SQL query against ${db ?? 'PostgreSQL'}`;
  }
  if (db && host) {
    return `Connect to the ${db} database on ${host}`;
  }
  if (db) {
    return `Connect to the ${db} PostgreSQL database`;
  }
  return 'Connect to PostgreSQL';
}

function describeSystemctl({ args }: Parsed): string | null {
  const pos = positionals(args);
  const sub = pos[0];
  const service = pos[1];
  if (!sub) {
    return null;
  }
  const verbs: Record<string, string> = {
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    reload: 'Reload',
    status: 'Show the status of',
    enable: 'Enable',
    disable: 'Disable'
  };
  const verb = verbs[sub];
  if (!verb) {
    return null;
  }
  return service ? `${verb} the ${service} service` : `${verb} a system service`;
}

function describeJournalctl({ args }: Parsed): string {
  const unit = flagValue(args, '-u', '--unit');
  const verb = hasFlag(args, '-f', '--follow') ? 'Follow' : 'Show';
  return unit ? `${verb} the logs of the ${unit} service` : `${verb} the system logs`;
}

function describeLsof({ args }: Parsed): string {
  const joined = args.join(' ');
  const port = /(?::|-i\s*:?)(\d{2,5})\b/.exec(joined)?.[1];
  if (port) {
    return `Find the process listening on port ${port}`;
  }
  if (hasFlag(args, '-i')) {
    return 'List processes using network connections';
  }
  return 'List open files';
}

function describeCurl({ args }: Parsed): string {
  const method = flagValue(args, '-X', '--request');
  const url = positionals(args, ['-H', '-d', '-X', '-o', '-u', '--data', '--header'])
    .find((a) => /^https?:\/\//.test(a) || a.includes('/'));
  const target = url ? shortUrl(url) : 'an endpoint';
  if (method) {
    return `Send a ${method.toUpperCase()} request to ${target}`;
  }
  if (hasFlag(args, '-d', '--data')) {
    return `Send a POST request to ${target}`;
  }
  if (hasFlag(args, '-o', '-O')) {
    return `Download ${target}`;
  }
  return `Send a request to ${target}`;
}

function describeGrep({ program, args }: Parsed): string {
  const pos = positionals(args, ['-e', '--include', '--exclude', '-m']);
  const pattern = pos[0];
  const path = pos[1];
  const recursive = hasFlag(args, '-r', '-R', '--recursive') || program === 'rg';
  const scope = path ? ` in ${path}` : recursive ? ' in this directory' : '';
  return pattern ? `Search for "${pattern}"${scope}` : 'Search file contents';
}

function describeFind({ args }: Parsed): string {
  const path = positionals(args, ['-name', '-type', '-iname', '-maxdepth', '-exec'])[0];
  const name = flagValue(args, '-name', '-iname');
  const where = path ? ` under ${path}` : '';
  if (hasFlag(args, '-delete')) {
    return name ? `Delete every ${name} file${where}` : `Delete matching files${where}`;
  }
  return name ? `Find ${name} files${where}` : `Find files${where}`;
}

function describeTar({ args }: Parsed): string {
  const archive = flagValue(args, '-f') ?? positionals(args)[0];
  if (hasFlag(args, '-x')) {
    return archive ? `Extract ${archive}` : 'Extract an archive';
  }
  if (hasFlag(args, '-c')) {
    return archive ? `Create the ${archive} archive` : 'Create an archive';
  }
  if (hasFlag(args, '-t')) {
    return archive ? `List the contents of ${archive}` : 'List archive contents';
  }
  return 'Work with a tar archive';
}

function describeApt({ program, args }: Parsed): string | null {
  const sub = args[0];
  const pos = positionals(args.slice(1));
  const tool = program === 'brew' ? 'Homebrew' : 'apt';
  if (sub === 'install') {
    return pos.length ? `Install ${pos.join(', ')} with ${tool}` : `Install a package with ${tool}`;
  }
  if (sub === 'update') {
    return `Refresh the ${tool} package index`;
  }
  if (sub === 'upgrade') {
    return `Upgrade the installed ${tool} packages`;
  }
  if (sub === 'remove' || sub === 'uninstall' || sub === 'purge') {
    return pos.length ? `Remove ${pos.join(', ')}` : `Remove a ${tool} package`;
  }
  return null;
}

function describeSource({ args }: Parsed): string {
  const target = positionals(args)[0] ?? '';
  if (/activate$/.test(target)) {
    return 'Activate the Python virtual environment';
  }
  if (/\.(env|envrc)$|(^|\/)\.env/.test(target)) {
    return 'Load the environment variables';
  }
  return target ? `Source ${target}` : 'Source a shell script';
}

// -------------------------------------------------------------------- fallback

function describeSegment(segment: string): string | null {
  const parsed = parseSegment(segment);
  if (parsed.program.length === 0) {
    return null;
  }
  const handler = HANDLERS[parsed.program];
  if (handler) {
    try {
      const result = handler(parsed);
      if (result) {
        return parsed.sudo ? `${result} (as root)` : result;
      }
    } catch {
      // A describer bug must never block saving a command.
    }
  }
  return fallback(parsed);
}

/** Readable last resort: "Run kubectl rollout status". */
function fallback(parsed: Parsed): string {
  if (parsed.program.length === 0) {
    return 'Saved command';
  }
  const meaningful = parsed.args.filter((a) => !a.startsWith('-')).slice(0, 2);
  const phrase = [parsed.program, ...meaningful].join(' ');
  const truncated = phrase.length > 60 ? `${phrase.slice(0, 57)}…` : phrase;
  return `Run ${truncated}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  if (text.length === 0) {
    return text;
  }
  // Keep acronyms and proper nouns intact: "SSH into ..." stays as-is.
  if (text.length > 1 && text.charAt(1) === text.charAt(1).toUpperCase() && /[A-Z]/.test(text.charAt(1))) {
    return text;
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function shortUrl(url: string): string {
  const cleaned = url.replace(/^https?:\/\//, '');
  return cleaned.length > 45 ? `${cleaned.slice(0, 42)}…` : cleaned;
}
