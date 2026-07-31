# Contributing to Command Runbook

Thanks for considering a contribution.

## Getting set up

Requires Node.js 18+ and VS Code 1.93+.

```bash
git clone https://github.com/irohitsharma21/command-runbook.git
cd command-runbook
npm install
npm run compile
```

Open the `command-runbook` folder in VS Code and press **F5** to launch an Extension
Development Host with the extension loaded.

## Before opening a pull request

```bash
npm run lint
npm test
```

Both must pass. `npm test` compiles the project, so a type error fails the suite.

## Where code belongs

Runbook keeps a hard line between business logic and VS Code UI:

- **`src/core/`** — must not import `vscode`. Everything here is unit tested
  directly with Node's test runner. Storage, search, sorting, detection,
  description generation, templates and the import/export format live here.
- **`src/services/`** — thin adapters over VS Code APIs (storage, terminal,
  prompts, configuration).
- **`src/commands/`** — one file per user-facing action, orchestrating services.
- **`src/providers/`** — tree data providers.

If you are adding logic that could be described with a plain input and a plain
expected output, it belongs in `core/` with a test.

## Adding a description rule

`src/core/describer.ts` maps commands to human-readable descriptions. To add
support for a tool:

1. Add a handler to the `HANDLERS` table keyed by the program name.
2. Return `null` for sub-commands you do not handle — the generic
   `Run <program> <subcommand>` fallback takes over.
3. Add a case to the table in `test/describer.test.ts`.

Descriptions should read as an action ("Restart the nginx service"), start with a
capital letter, and carry no trailing period.

## Adding a secret or danger pattern

`src/core/secretDetector.ts` and `src/core/dangerDetector.ts` are ordinary rule
lists. Add the rule, then add both a positive case and a negative case to
`test/detectors.test.ts` — false positives are as harmful as misses, because a
warning users learn to click through protects nobody.

## Principles

- **Local-first.** v0.1 has no network code. Do not add any without an explicit,
  opt-in setting and a README/privacy update.
- **Never modify a command silently.** Runbook may refuse to run something or ask
  for confirmation, but the text the user saved is the text that executes.
- **Do not spam the user.** No notification after every terminal command. Saving
  is user-initiated.
- **Native VS Code UI.** TreeView, QuickPick, InputBox and notifications — not a
  webview.

## Commit messages

Plain, imperative, and scoped to one change. Reference an issue where one exists.

## Reporting bugs

Include your VS Code version, your OS, your shell, and whether terminal shell
integration is active (the "Save Last Command" flow depends on it). The
**Runbook** output channel contains a local log that is often enough to diagnose
a problem — check it for anything sensitive before pasting it into an issue.
