# Changelog

All notable changes to Runbook are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-31

Runbook is now two frontends over one library.

### Added

- **Terminal CLI** (`runbook`), sharing the same command library as the extension:
  `save`, `list`, `search`, `get`, `run`, `rm`, `tags`, `export`, `import`, `path`
  and `shell-init`. Auto-generated descriptions, secret warnings, destructive-command
  confirmation, duplicate detection and `{{template}}` variables all behave as they
  do in the editor.
- **Shell integration** via `eval "$(runbook shell-init bash|zsh)"`: `rbs` saves the
  command you just ran (read from the shell's own history), and `Ctrl-G` inserts a
  saved command onto the prompt, using `fzf` when available.
- **JSON file storage** shared by both frontends — `~/.config/runbook/commands.json`
  (honouring `RUNBOOK_HOME` and `XDG_CONFIG_HOME`) and `<project>/.runbook/commands.json`.
  Written temp-then-rename; an unreadable file is backed up rather than overwritten.
- **Committable project commands.** `.runbook/commands.json` lives in the repository,
  so a team shares a project's commands through git — no server or account.
- `runbook.projectStorage` setting to keep project commands in VS Code's private
  workspace storage instead of writing into the repository.
- File watching, so a command saved from the CLI appears in the sidebar immediately.

### Changed

- Global commands moved from VS Code's `globalState` to a JSON file. Existing
  commands are migrated automatically on first run; the originals are left in place
  rather than deleted.

## [0.1.0] - 2026-07-31

Initial release.

### Added

- Runbook container in the VS Code Activity Bar with a **Saved Commands** sidebar,
  separated into **This Project** and **Global** and grouped by tag.
- **Save Last Command**, capturing the most recent integrated-terminal command via
  the official terminal shell integration API (VS Code 1.93+).
- **Save Command from Recent History**, for picking from earlier commands in the
  current window.
- **Add Command** for manual entry.
- Automatically generated, editable descriptions — an offline rule engine covering
  docker, docker compose, git, npm/pnpm/yarn/bun, python/pip/uv, uvicorn, alembic,
  Django, kubectl, helm, terraform, aws, ssh, psql, systemd and common Unix tools.
- **Search Commands** (`Ctrl+Alt+R` / `Cmd+Alt+R`): ranked, case-insensitive search
  across descriptions, commands and tags, with inline run/insert/copy/edit buttons.
- Sidebar filtering and configurable sort order (recent, most used, recently added,
  alphabetical).
- Run, Insert into Terminal, Copy, Edit and Delete actions, available from the tree,
  the context menu and the search results.
- Global and project scopes backed by `globalState` and `workspaceState`.
- Command templates: `{{variable}}` placeholders prompted for at run time.
- Secret detection before saving and exporting, with masked previews.
- Destructive-command confirmation, always offering *Insert into Terminal* instead.
- Duplicate detection with an update-existing option.
- JSON import/export, with per-entry validation and duplicate skipping.
- Usage tracking (`usageCount`, `lastUsedAt`).
- Welcome view for the empty state.
- Terminal right-click and terminal-tab menu entries for Save Last Command.
