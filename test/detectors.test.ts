import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectSecrets, hasSecrets, mask } from '../src/core/secretDetector';
import { detectDangers, isDangerous } from '../src/core/dangerDetector';
import { findDuplicates, normalizeCommand } from '../src/core/duplicates';
import { SavedCommand } from '../src/models/SavedCommand';

describe('secretDetector', () => {
  const shouldFlag: Array<[string, string]> = [
    ['curl -H "Authorization: Bearer sk_live_abc123def456ghi789" https://api.example.com', 'bearer-token'],
    ['aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
    ['git clone https://ghp_16CharactersOrMoreToken1234@github.com/x/y.git', 'github-token'],
    ['psql postgresql://admin:supersecret@db.example.com:5432/prod', 'url-credentials'],
    ['mysql -u root --password=hunter2000', 'password-flag'],
    ['export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234', 'secret-env-assignment'],
    ['deploy --token=abcdef123456ghijkl', 'secret-flag'],
    ['echo "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r"', 'jwt']
  ];

  for (const [command, ruleId] of shouldFlag) {
    it(`flags ${ruleId}`, () => {
      const findings = detectSecrets(command);
      assert.ok(
        findings.some((f) => f.id === ruleId),
        `expected rule ${ruleId} for: ${command}\ngot: ${JSON.stringify(findings)}`
      );
    });
  }

  const shouldNotFlag = [
    'docker compose up -d --build',
    'git commit -m "add password reset form"',
    'kubectl get pods -n production',
    'docker run -p 8080:80 nginx',
    'npm install --save-dev typescript',
    'ssh -i ~/.ssh/id_rsa ubuntu@10.0.0.4',
    'lsof -i :8000'
  ];

  for (const command of shouldNotFlag) {
    it(`leaves an ordinary command alone: ${command}`, () => {
      assert.equal(hasSecrets(command), false, `unexpected findings: ${JSON.stringify(detectSecrets(command))}`);
    });
  }

  it('ignores template placeholders so saved templates do not warn', () => {
    assert.equal(hasSecrets('curl -H "Authorization: Bearer {{token}}" https://api.example.com'), false);
    assert.equal(hasSecrets('export API_TOKEN=$MY_TOKEN'), false);
    assert.equal(hasSecrets('export API_TOKEN=${MY_TOKEN}'), false);
  });

  it('masks the middle of a matched credential', () => {
    const masked = mask('Bearer abcdefghijklmnopqrstuvwxyz');
    assert.ok(masked.includes('•'));
    assert.ok(!masked.includes('abcdefghijklmnopqrstuvwxyz'));
  });

  it('returns at most one finding per rule', () => {
    const findings = detectSecrets('a=AKIAIOSFODNN7EXAMPLE b=AKIAIOSFODNN7EXAMPLX');
    assert.equal(findings.filter((f) => f.id === 'aws-access-key').length, 1);
  });
});

describe('dangerDetector', () => {
  const dangerous = [
    'rm -rf /var/data',
    'git reset --hard HEAD~3',
    'docker system prune -a',
    'kubectl delete pod api-7f8d',
    'DROP DATABASE production;',
    'terraform destroy -auto-approve',
    'git push --force origin main',
    'aws s3 rm s3://bucket --recursive'
  ];

  for (const command of dangerous) {
    it(`flags: ${command}`, () => {
      assert.equal(isDangerous(command), true);
    });
  }

  const safe = [
    'docker compose up -d --build',
    'git status',
    'kubectl get pods',
    'npm run dev',
    'SELECT * FROM users LIMIT 10;',
    'git push origin main',
    'git push --force-with-lease'
  ];

  for (const command of safe) {
    it(`allows: ${command}`, () => {
      assert.equal(isDangerous(command), false, JSON.stringify(detectDangers(command)));
    });
  }

  it('describes why a command was flagged', () => {
    const findings = detectDangers('rm -rf build');
    assert.equal(findings[0].id, 'rm-recursive');
    assert.ok(findings[0].label.length > 0);
  });
});

describe('duplicates', () => {
  const existing: SavedCommand[] = [
    {
      id: '1',
      command: 'docker compose up -d --build',
      description: 'Rebuild Docker containers',
      scope: 'project',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      usageCount: 0
    },
    {
      id: '2',
      command: 'git status',
      description: 'Status',
      scope: 'global',
      tags: [],
      createdAt: 2,
      updatedAt: 5,
      usageCount: 0
    }
  ];

  it('collapses insignificant whitespace only', () => {
    assert.equal(normalizeCommand('  docker   compose  up  '), 'docker compose up');
    assert.notEqual(normalizeCommand('docker compose up'), normalizeCommand('docker compose up -d'));
  });

  it('finds an exact duplicate regardless of surrounding whitespace', () => {
    const found = findDuplicates(existing, '  docker compose up -d   --build ');
    assert.equal(found.length, 1);
    assert.equal(found[0].description, 'Rebuild Docker containers');
  });

  it('matches across scopes', () => {
    assert.equal(findDuplicates(existing, 'git status').length, 1);
  });

  it('does not report a command as its own duplicate when editing', () => {
    assert.equal(findDuplicates(existing, 'git status', '2').length, 0);
  });

  it('returns nothing for a new command', () => {
    assert.equal(findDuplicates(existing, 'git log --oneline').length, 0);
  });

  it('ignores empty input', () => {
    assert.equal(findDuplicates(existing, '   ').length, 0);
  });
});
