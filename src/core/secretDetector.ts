/**
 * Heuristic detection of credentials inside a shell command.
 *
 * This is a warning mechanism, not a guarantee: it exists so a `curl -H
 * "Authorization: Bearer ..."` does not end up silently persisted. It runs
 * entirely locally and never modifies the command.
 */

export interface SecretFinding {
  /** Stable identifier, useful for tests and for suppressing a rule later. */
  id: string;
  /** Human-readable description shown in the warning dialog. */
  label: string;
  /** The matched text, already masked for safe display. */
  preview: string;
}

interface SecretRule {
  id: string;
  label: string;
  pattern: RegExp;
}

/**
 * Values that look like placeholders rather than real secrets. Runbook's own
 * `{{variable}}` templates land here, as do `$VAR`, `${VAR}` and `<token>`.
 */
const PLACEHOLDER = /^(?:\{\{.*\}\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|<[^>]*>|x{3,}|\*{3,}|["']{2}|changeme|your[-_]?\w*|placeholder)$/i;

const RULES: SecretRule[] = [
  {
    id: 'bearer-token',
    label: 'Bearer token in an Authorization header',
    pattern: /\bbearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi
  },
  {
    id: 'basic-auth',
    label: 'Basic authentication header',
    pattern: /\bbasic\s+[A-Za-z0-9+/]{12,}={0,2}/gi
  },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g
  },
  {
    id: 'aws-access-key',
    label: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA)[0-9A-Z]{16}\b/g
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    id: 'api-key-prefix',
    label: 'API key',
    pattern: /\b(?:sk|pk|rk)-(?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9]{16,}\b/g
  },
  {
    id: 'private-key-block',
    label: 'Inline private key',
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g
  },
  {
    id: 'url-credentials',
    label: 'Credentials embedded in a connection URL',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s]+/gi
  },
  {
    id: 'password-flag',
    label: 'Password passed on the command line',
    pattern: /--?(?:password|passwd|pwd)[=\s]+("[^"]*"|'[^']*'|\S+)/gi
  },
  {
    id: 'secret-flag',
    label: 'Token or key passed as a flag',
    pattern:
      /--(?:token|api[-_]?key|apikey|secret|auth[-_]?token|access[-_]?token|client[-_]?secret)[=\s]+("[^"]*"|'[^']*'|\S+)/gi
  },
  {
    id: 'secret-env-assignment',
    label: 'Secret assigned to an environment variable',
    pattern:
      /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*("[^"]*"|'[^']*'|\S+)/g
  }
];

/**
 * Returns one finding per rule that matched. Matches whose captured value is an
 * obvious placeholder are ignored, so template commands stay warning-free.
 */
export function detectSecrets(command: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of RULES) {
    // Rules are module-level and stateful when global; reset before each use.
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(command)) !== null) {
      if (match[0].length === 0) {
        rule.pattern.lastIndex += 1;
        continue;
      }
      const captured = stripQuotes(match[1] ?? '');
      if (captured.length > 0 && PLACEHOLDER.test(captured)) {
        continue;
      }
      if (PLACEHOLDER.test(stripQuotes(match[0]))) {
        continue;
      }
      findings.push({ id: rule.id, label: rule.label, preview: mask(match[0]) });
      break; // one finding per rule is enough for a warning dialog
    }
    rule.pattern.lastIndex = 0;
  }
  return findings;
}

export function hasSecrets(command: string): boolean {
  return detectSecrets(command).length > 0;
}

/**
 * Masks the middle of a matched string so the warning can show context without
 * reprinting the credential in full.
 */
export function mask(value: string): string {
  const text = value.length > 80 ? `${value.slice(0, 80)}…` : value;
  return text.replace(/[A-Za-z0-9_\-+/.]{10,}/g, (token) => {
    if (token.length <= 10) {
      return token;
    }
    return `${token.slice(0, 4)}${'•'.repeat(6)}${token.slice(-2)}`;
  });
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}
