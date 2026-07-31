import * as readline from 'node:readline';

/**
 * Minimal interactive prompts over stdin.
 *
 * Every prompt writes to stderr so that `runbook get` can stay pipeable —
 * `$(runbook get deploy)` must capture the command and nothing else.
 */

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

function createInterface(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stderr });
}

/** Asks a question, optionally pre-filling the answer so Enter accepts it. */
export function ask(question: string, prefill = ''): Promise<string | undefined> {
  if (!isInteractive()) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const rl = createInterface();
    let answered = false;

    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });

    // Pre-load the editable default; the user can accept, edit or clear it.
    if (prefill.length > 0) {
      rl.write(prefill);
    }

    rl.on('close', () => {
      if (!answered) {
        resolve(undefined);
      }
    });
  });
}

/** Yes/no confirmation. Defaults to no, so an accidental Enter is safe. */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!isInteractive()) {
    return false;
  }
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${suffix} `);
  if (answer === undefined) {
    return false;
  }
  const normalized = answer.trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultYes;
  }
  return normalized === 'y' || normalized === 'yes';
}
