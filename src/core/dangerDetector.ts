/**
 * Heuristic detection of destructive commands.
 *
 * Used only to decide whether to ask for confirmation before running. Runbook
 * never rewrites or blocks a command — the user's text is executed verbatim or
 * not at all.
 */

export interface DangerFinding {
  id: string;
  label: string;
}

interface DangerRule {
  id: string;
  label: string;
  pattern: RegExp;
}

const RULES: DangerRule[] = [
  { id: 'rm-recursive', label: 'Recursive file deletion (rm -rf)', pattern: /\brm\s+(?:-\w*\s+)*-{1,2}\w*[rf]\w*/i },
  { id: 'find-delete', label: 'Bulk deletion via find', pattern: /\bfind\b[^|;]*\s-delete\b/i },
  { id: 'dd-write', label: 'Raw disk write (dd)', pattern: /\bdd\s+if=/i },
  { id: 'mkfs', label: 'Filesystem format (mkfs)', pattern: /\bmkfs(?:\.\w+)?\b/i },
  { id: 'disk-redirect', label: 'Redirect to a block device', pattern: />\s*\/dev\/(?:sd|nvme|hd)\w+/i },
  { id: 'chmod-777', label: 'Recursive world-writable permissions', pattern: /\bchmod\s+(?:-R\s+)?0?777\b|\bchmod\s+-R\b/i },
  { id: 'fork-bomb', label: 'Fork bomb', pattern: /:\(\)\s*\{.*\}\s*;?\s*:/ },
  { id: 'shutdown', label: 'Machine shutdown or reboot', pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i },

  { id: 'git-reset-hard', label: 'Discards local changes (git reset --hard)', pattern: /\bgit\s+reset\s+(?:.*\s)?--hard\b/i },
  { id: 'git-clean', label: 'Deletes untracked files (git clean)', pattern: /\bgit\s+clean\b[^|;]*-\w*[fd]/i },
  { id: 'git-force-push', label: 'Force push', pattern: /\bgit\s+push\b[^|;]*(?:--force(?!-with-lease)|\s-f\b)/i },
  { id: 'git-branch-delete', label: 'Force branch deletion', pattern: /\bgit\s+branch\s+(?:.*\s)?-D\b/i },

  { id: 'sql-drop', label: 'Drops a database or table', pattern: /\bdrop\s+(?:database|schema|table)\b/i },
  { id: 'sql-truncate', label: 'Truncates a table', pattern: /\btruncate\s+(?:table\s+)?\w+/i },
  { id: 'sql-delete-all', label: 'DELETE without a WHERE clause', pattern: /\bdelete\s+from\s+\w+\s*(?:;|$)/i },

  { id: 'docker-prune', label: 'Docker prune (removes unused resources)', pattern: /\bdocker\s+(?:system|image|volume|network|container)\s+prune\b/i },
  { id: 'docker-rm', label: 'Removes Docker containers or volumes', pattern: /\bdocker\s+(?:rm|volume\s+rm|rmi)\b/i },
  { id: 'compose-down-volumes', label: 'Removes Docker Compose volumes', pattern: /\bdocker[\s-]compose\s+down\b[^|;]*(?:-v\b|--volumes)/i },

  { id: 'kubectl-delete', label: 'Deletes Kubernetes resources', pattern: /\bkubectl\s+delete\b/i },
  { id: 'helm-uninstall', label: 'Uninstalls a Helm release', pattern: /\bhelm\s+(?:uninstall|delete)\b/i },
  { id: 'terraform-destroy', label: 'Destroys infrastructure (terraform destroy)', pattern: /\bterraform\s+destroy\b/i },
  { id: 'aws-recursive-delete', label: 'Recursive S3 deletion', pattern: /\baws\s+s3\s+rm\b[^|;]*--recursive/i },

  { id: 'systemctl-stop', label: 'Stops or disables a system service', pattern: /\bsystemctl\s+(?:stop|disable|mask)\b/i },
  { id: 'kill-all', label: 'Kills processes by name', pattern: /\b(?:killall|pkill)\b|\bkill\s+-9\b/i }
];

export function detectDangers(command: string): DangerFinding[] {
  const findings: DangerFinding[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(command)) {
      findings.push({ id: rule.id, label: rule.label });
    }
  }
  return findings;
}

export function isDangerous(command: string): boolean {
  return detectDangers(command).length > 0;
}
