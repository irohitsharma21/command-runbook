# Command Runbook

*A VS Code extension and a terminal CLI, sharing one command library.*

**Save useful terminal commands with a description, and run them again later.**

> "I figured out this command once. Why should I have to figure it out again?"

Runbook gives you a searchable, local library of the terminal commands you
actually use — with a human-readable description attached, so you can find them
by what they *do* rather than by remembering their exact shell syntax.

It ships as **two frontends over one library**: a VS Code extension and a
standalone CLI. Both read and write the same JSON files, so a command saved in
the editor is available in a bare SSH session, and vice versa.

---

## Why does it exist?

You spend twenty minutes working out the right incantation:

```bash
docker exec -it $(docker ps -qf name=postgres) psql -U postgres -d app_production
```

It works. Three weeks later you need it again — and it is gone. You search your
shell history, dig through a `commands.md` file you stopped maintaining, or
google it a second time.

Runbook is the missing step between "this command works" and "I will need this
again":

```
DISCOVER  →  EXECUTE  →  SAVE WITH DESCRIPTION  →  FORGET  →  SEARCH  →  RUN AGAIN
```

---

## Features

- **Activity Bar sidebar.** Runbook gets its own icon in the left Activity Bar,
  with commands grouped into **This Project** and **Global**, and sub-grouped by
  tag.
- **Save the last command you ran.** Uses VS Code's official terminal shell
  integration API to capture what you executed — no copy-pasting.
- **Auto-written descriptions.** The description box is pre-filled with a
  generated summary of the command (`docker compose up -d --build` →
  *"Rebuild and start Docker services in the background"*). Fully offline and
  rule-based; it is a suggestion you can accept with Enter or overwrite.
- **Description-first display.** The sidebar shows what a command does; the raw
  shell text is secondary.
- **Global vs project scope.** Global commands follow you everywhere; project
  commands stay with the workspace they belong to.
- **Fast keyboard search.** `Ctrl+Alt+R` / `Cmd+Alt+R` opens a ranked search
  across descriptions, commands and tags.
- **Run, Insert, Copy, Edit, Delete** on every command. *Insert* types the
  command into the terminal without running it, so you can tweak it first.
- **Secret detection.** Warns before saving or exporting a command that looks
  like it contains a token, password, API key or credential-bearing URL.
- **Destructive-command confirmation.** `rm -rf`, `DROP DATABASE`,
  `kubectl delete`, `terraform destroy` and friends ask before running, and
  always offer *Insert into Terminal* as the safe alternative.
- **Duplicate detection.** Saving a command you already have offers to update
  the existing entry instead of quietly creating a second copy.
- **Command templates.** Save `ssh -i {{key}} {{user}}@{{host}}` and Runbook
  prompts for the values each time you run it.
- **Import / export.** Plain JSON, for backup or for moving between machines.
- **Usage tracking.** Counts executions so you can sort by most or recently used.
- **A terminal CLI** sharing the same library — `runbook save`, `runbook run`,
  `runbook get` — plus optional shell integration that saves the command you
  just ran and binds `Ctrl-G` to a picker.
- **Shareable project commands.** A project's commands live in
  `.runbook/commands.json` inside the repo, so committing it gives the whole
  team the same runbook.

### Screenshots

<!-- Add screenshots here before publishing to the Marketplace:
     - docs/screenshot-sidebar.png    — the Activity Bar sidebar with commands
     - docs/screenshot-save.png       — the description prompt with a suggestion
     - docs/screenshot-search.png     — the Ctrl+Alt+R search picker
-->

_Screenshots to be added._

---

## Installation

### From a `.vsix` file

1. Download or build `command-runbook-0.2.0.vsix` (see [Building a VSIX](#building-a-vsix)).
2. In VS Code, open the **Extensions** view (`Ctrl+Shift+X`).
3. Click the **`...`** menu at the top of the panel → **Install from VSIX...**.
4. Select the `.vsix` file.
5. Reload VS Code if prompted.

Or from the command line:

```bash
code --install-extension command-runbook-0.2.0.vsix
```

### From the Marketplace

Not published yet. See [Roadmap](#roadmap).

### The CLI

```bash
npm install -g command-runbook
# or, from a clone:
npm install -g /path/to/command-runbook
```

The npm package is named `command-runbook`, but the command it installs is
`runbook`. Then check it can see the same library the extension uses:

```bash
runbook path
```

---

## Using Runbook from the terminal

The CLI is not a separate product — it reads the same files as the extension.

```bash
runbook save "docker compose up -d --build" -t docker
# → prompts for a description, pre-filled with
#   "Rebuild and start Docker services in the background"

runbook list                    # everything, newest use first
runbook search postgres         # ranked search
runbook run "rebuild docker"    # run it, with confirmation if destructive
runbook get deploy              # print only the command text
runbook rm 0aecb9c5             # delete by the short id shown in listings
runbook path                    # where the storage files are
```

`runbook get` prints nothing but the command, so it composes:

```bash
eval "$(runbook get 'start backend')"
ssh host "$(runbook get 'restart nginx')"
```

Templates work the same as in the editor:

```bash
runbook run "connect to server" -v key=prod.pem -v user=ubuntu -v host=10.0.0.4
```

### Shell integration

```bash
eval "$(runbook shell-init bash)"   # or: zsh — add this line to ~/.bashrc
```

That gives you:

- **`rbs`** — save the command you just ran. The shell reads it from its own
  history, which is the only reliable way to do this outside VS Code.
- **`Ctrl-G`** — pick a saved command and drop it onto your prompt, ready to
  edit before you press Enter. Uses `fzf` when installed, and falls back to a
  plain list when it is not.

### CLI options worth knowing

| Flag | Meaning |
| --- | --- |
| `-d, --description <text>` | Skip the description prompt |
| `-t, --tags <a,b>` | Comma-separated tags |
| `-g, --global` / `-p, --project` | Choose or filter by scope |
| `-v, --var key=value` | Fill a `{{template}}` variable (repeatable) |
| `--first` | On an ambiguous query, take the best match |
| `-y, --yes` | Skip confirmations |
| `-q, --quiet` | Print command text only — pipeable |
| `--json` | JSON output |

An ambiguous query is never guessed at: Runbook lists the matches and exits
non-zero rather than risk running the wrong command.

---

## Usage

### Save a command you just ran

1. Run something in the integrated terminal.
2. Press `Ctrl+Alt+S` (`Cmd+Alt+S` on macOS), or run **Runbook: Save Last
   Command** from the Command Palette, or right-click inside the terminal and
   choose **Save Last Command**.
3. Accept or edit the suggested description.
4. Optionally add comma-separated tags.
5. Choose **Project** or **Global**.

### Add a command manually

Command Palette → **Runbook: Add Command**.

### Find and run a command

- Press `Ctrl+Alt+R` (`Cmd+Alt+R`) and start typing. Enter runs the highlighted
  command; the inline buttons insert, copy or edit it.
- Or click the Runbook icon in the Activity Bar and pick a command from the
  tree. Clicking an item opens the Run / Insert / Copy / Edit / Delete menu, and
  the inline ▶ / terminal icons run or insert it directly.

### Command templates

Save a command containing `{{placeholders}}`:

```bash
ssh -i {{key}} {{username}}@{{host}}
```

Runbook prompts for each value before running or inserting it.

---

## Commands

| Command | ID | Default keybinding |
| --- | --- | --- |
| Runbook: Save Last Command | `runbook.saveLastCommand` | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Runbook: Save Command from Recent History | `runbook.saveFromHistory` | — |
| Runbook: Add Command | `runbook.addCommand` | — |
| Runbook: Search Commands | `runbook.searchCommands` | `Ctrl+Alt+R` / `Cmd+Alt+R` |
| Runbook: Filter Sidebar | `runbook.filter` | — |
| Runbook: Clear Sidebar Filter | `runbook.clearFilter` | — |
| Runbook: Refresh | `runbook.refresh` | — |
| Runbook: Change Sort Order | `runbook.setSortOrder` | — |
| Runbook: Export Commands | `runbook.export` | — |
| Runbook: Import Commands | `runbook.import` | — |

Item actions (`runbook.run`, `runbook.insert`, `runbook.copy`, `runbook.edit`,
`runbook.delete`) are invoked from the sidebar and search results rather than the
Command Palette.

All keybindings can be changed in **File → Preferences → Keyboard Shortcuts**.

---

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `runbook.confirmBeforeRun` | `false` | Confirm before running any command. |
| `runbook.defaultScope` | `"project"` | Scope pre-selected when saving. |
| `runbook.showGlobalCommands` | `true` | Show global commands in the sidebar. |
| `runbook.sortBy` | `"recent"` | `recent`, `mostUsed`, `recentlyAdded`, `alphabetical`. |
| `runbook.groupByTag` | `true` | Group sidebar commands by their first tag. |
| `runbook.projectStorage` | `"file"` | `file` writes `.runbook/commands.json` in the project (shareable, CLI-readable); `workspaceState` keeps them in VS Code's private storage instead. |
| `runbook.autoDescription` | `true` | Pre-fill the description with a generated summary. |
| `runbook.warnOnSecrets` | `true` | Warn before saving/exporting likely credentials. |
| `runbook.confirmDangerousCommands` | `true` | Confirm before running destructive commands. |

---

## Development setup

Requires **Node.js 18+** and **VS Code 1.93 or newer** (the terminal shell
integration API this extension relies on was finalised in 1.93).

```bash
cd command-runbook
npm install
npm run compile
```

### Launching with F5

1. Open the `command-runbook` folder in VS Code (this exact folder must be the workspace
   root, so that `.vscode/launch.json` is picked up).
2. Press **F5**.
3. A second VS Code window — the **Extension Development Host** — opens with
   Runbook loaded. Its Activity Bar will show the Runbook icon.
4. Open a terminal in that window, run a command, and try **Runbook: Save Last
   Command**.

`npm run watch` recompiles on save; use **Developer: Reload Window** in the
Extension Development Host to pick up changes.

### Running the tests

```bash
npm test
```

This compiles the project and runs the unit suite with Node's built-in test
runner. The tests cover file and in-memory storage, storage paths, search,
sorting, duplicate detection, secret detection, danger detection, description
generation, templates, import/export, CLI argument parsing and CLI command
resolution — all of which live in `src/core/` or `src/cli/` and have no VS Code
dependency precisely so they can be tested this way.

To exercise the CLI by hand without touching your real library, point it at a
scratch directory:

```bash
RUNBOOK_HOME=/tmp/runbook-scratch node bin/runbook.js save "echo hi"
RUNBOOK_HOME=/tmp/runbook-scratch node bin/runbook.js list
```

### Linting

```bash
npm run lint
```

---

## Building a VSIX

```bash
npm run package
```

This runs `vsce package`, which compiles the extension and writes
`command-runbook-0.2.0.vsix` into the project root.

Then install it with **Extensions → `...` → Install from VSIX...**, or:

```bash
code --install-extension command-runbook-0.2.0.vsix
```

### Before publishing to the Marketplace

1. Create a publisher at <https://marketplace.visualstudio.com/manage> and set
   `"publisher"` in `package.json` to that publisher ID (currently
   `irohitsharma21`).
2. Update `"repository"`, `"bugs"` and `"homepage"` to the real repository URL.
3. Add a 128×128 PNG `icon` field to `package.json` — the Marketplace listing
   icon is separate from the monochrome Activity Bar SVG.
4. Add screenshots to the README.
5. `npx vsce publish` with a Personal Access Token.

---

## Architecture

```text
runbook/
├── src/
│   ├── extension.ts              Activation, command registration, wiring
│   │
│   ├── core/                     No VS Code imports — unit tested directly
│   │   ├── commandStore.ts       CRUD over two KeyValueStores (global/project)
│   │   ├── keyValueStore.ts      Storage contract + in-memory implementation
│   │   ├── jsonFileStore.ts      JSON-file KeyValueStore shared by both frontends
│   │   ├── paths.ts              Storage locations + project-root discovery
│   │   ├── search.ts             Case-insensitive ranked search
│   │   ├── sorting.ts            recent / mostUsed / recentlyAdded / alphabetical
│   │   ├── duplicates.ts         Whitespace-normalised duplicate detection
│   │   ├── secretDetector.ts     Credential heuristics + masking
│   │   ├── dangerDetector.ts     Destructive-command heuristics
│   │   ├── describer.ts          Offline command → description rule engine
│   │   ├── templates.ts          {{variable}} extraction and substitution
│   │   ├── portable.ts           Export/import format + defensive parsing
│   │   └── ids.ts                UUID generation
│   │
│   ├── cli/                      The terminal frontend — no VS Code imports
│   │   ├── index.ts              Sub-commands
│   │   ├── args.ts               Dependency-free argv parser
│   │   ├── resolve.ts            Query/id → exactly one command
│   │   ├── prompt.ts             readline prompts (written to stderr)
│   │   ├── output.ts             Formatting, TTY-aware colour
│   │   └── shellInit.ts          bash/zsh integration
│   │
│   ├── services/                 Thin VS Code adapters
│   │   ├── storageService.ts     File stores, legacy migration, project paths
│   │   ├── terminalService.ts    Shell integration capture, run/insert
│   │   ├── prompts.ts            Input boxes, quick picks, confirmations
│   │   └── config.ts             Typed, defensive settings access
│   │
│   ├── commands/                 One file per user-facing action
│   ├── providers/
│   │   └── commandTreeProvider.ts  The sidebar TreeDataProvider
│   ├── models/SavedCommand.ts    The single persisted data type
│   └── util/logger.ts            Output channel + error guard
│
├── resources/runbook.svg         Activity Bar icon
└── test/                         node:test unit suites
```

**The organising principle:** all business logic lives in `src/core/` and imports
nothing from `vscode`. `services/` adapts VS Code onto those interfaces, and
`cli/` adapts a terminal onto the same ones. That is why two frontends share one
implementation of search, storage, secret detection and description generation —
and why the whole thing is testable without an Electron host.

`CommandStore` only ever sees a `KeyValueStore`, so swapping the backing store
(Memento → JSON file, and later a synced backend) touches one adapter.

### Data model

```typescript
interface SavedCommand {
  id: string;                       // UUID
  command: string;
  description: string;
  scope: 'global' | 'project';
  tags: string[];
  projectPath?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt?: number;
}
```

### Storage

Plain JSON files, in the export format, so they can be committed, diffed,
hand-edited or piped into `runbook import`:

| Scope | Location |
| --- | --- |
| Global | `$RUNBOOK_HOME`, else `$XDG_CONFIG_HOME/runbook/commands.json`, else `~/.config/runbook/commands.json` (`%APPDATA%\runbook\` on Windows) |
| Project | `<project>/.runbook/commands.json` |

```json
{
  "version": 1,
  "updatedAt": 1785528188843,
  "commands": [ { "id": "...", "command": "...", "description": "...", "...": "..." } ]
}
```

Files are written temp-then-rename, so an interrupted write cannot truncate your
library, and an unparseable file is backed up rather than overwritten. The
extension watches both files, so a command saved from the CLI shows up in the
sidebar immediately.

**The project file is the team-sharing mechanism.** Commit
`.runbook/commands.json` and everyone who clones the repo gets the same project
commands — no server, no account. Add it to `.gitignore` if you would rather keep
them private, or set `runbook.projectStorage` to `workspaceState` so nothing is
written into the repo at all.

Commands saved by v0.1.0 in VS Code's `globalState`/`workspaceState` are migrated
to files automatically on first run. The originals are left in place rather than
deleted.

When no folder is open, the project scope is reported as unavailable and saves
fall back to global.

### How "Save Last Command" works

Runbook listens to `window.onDidStartTerminalShellExecution` and
`window.onDidEndTerminalShellExecution` (stable since VS Code 1.93) and keeps the
last 50 executed command lines in memory for the current window, along with each
one's exit code and VS Code's own confidence rating.

Because of this, the extension activates on `onStartupFinished` — if it only
activated when its commands were invoked, the shell execution event would
already have passed and there would be nothing to save.

---

## Known VS Code API limitations

- **Terminal history requires shell integration.** There is no API to read
  terminal scrollback or your shell's history file. Shell integration is enabled
  by default for bash, zsh, fish and PowerShell; when it is off or the shell is
  unsupported, Runbook explains this and offers manual entry instead.
- **Nothing is captured before activation.** Commands run before VS Code
  finishes starting up are not seen.
- **Low-confidence captures.** VS Code reports a confidence level for each
  captured command line. When it is low, Runbook opens the command text for
  editing before saving rather than saving something that may not run.
- **No terminal toolbar button.** Extensions cannot add buttons to the terminal
  panel toolbar. Runbook instead contributes to the terminal right-click menu
  (`terminal/context`) and the terminal tab menu (`terminal/title/context`).
- **No native search box inside a TreeView.** The sidebar filter is an input box
  opened from the view's title bar; the primary search experience is the
  QuickPick (`Ctrl+Alt+R`).
- **Sidebar items are single-line.** VS Code tree items cannot show a description
  and a command on two separate lines, so the description is the label and the
  command is the (dimmed) inline description, with both in the hover tooltip.

---

## Roadmap

Deliberately **not** in v0.2, to keep the scope honest:

- Smart save suggestions after a complex command succeeds (without ever nagging
  about `ls`, `cd` or `git status`).
- Optional AI-generated descriptions — the offline rule engine stays the default.
- Optional sync across machines (the file format is already the hard part).
- Command collections and multi-tag filtering.
- Command history intelligence ("you have run this 8 times — save it?").
- An interactive `runbook` TUI picker that does not require `fzf`.
- Marketplace and npm publication.

Shipped in v0.2: the CLI, shared file storage, and committable per-project
command libraries — which covers team sharing without a server.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Privacy

Runbook is local-first, and has no network code at all.

- **No command data is sent to external servers.**
- **No account is required.**
- **No telemetry.**
- **Commands stay on your machine**, in the JSON files listed under
  [Storage](#storage) — you can read them, move them or delete them yourself.
- Export files are written only where you choose to save them.

One thing to be deliberate about: project commands are stored **inside your
repository** at `.runbook/commands.json`. That is what makes them shareable, but
it also means `git push` publishes them. Runbook warns before saving anything
that looks like a credential, but if a project's commands should stay private,
add `.runbook/` to `.gitignore` or set `runbook.projectStorage` to
`workspaceState`.

Because terminal commands frequently contain credentials, Runbook additionally
warns before saving or exporting anything that looks like a secret — and never
modifies or redacts your command without asking.

---

## License

[MIT](LICENSE) © Rohit Sharma
