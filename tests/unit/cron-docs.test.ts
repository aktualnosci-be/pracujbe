// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * #13: dokumentacja wskazuje istniejący endpoint kolejki `/api/email/process`. Stara nazwa
 * zostaje tylko w historycznym planie migracji, który opisuje samą poprawkę.
 */
const HISTORICAL = new Set(['docs/railway/PLAN_MIGRACJI.md']);

function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.md', '*.mjs', '*.ts', '*.tsx', '*.json', '.env.example'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !HISTORICAL.has(file) && file !== 'tests/unit/cron-docs.test.ts' && file !== 'tests/unit/railway-cron.test.ts');
}

describe('dokumentacja cron (#13)', () => {
  it('nie wskazuje nieistniejącego /api/email/dispatch', () => {
    const offenders = trackedTextFiles().filter((file) => readFileSync(file, 'utf8').includes('/api/email/dispatch'));
    expect(offenders).toEqual([]);
  });

  it('harmonogramy Railway w dokumentacji odpowiadają zadaniom callera', () => {
    const readme = readFileSync('docs/railway/README.md', 'utf8');
    expect(readme).toContain('/api/email/process');
    expect(readme).toContain('*/5 * * * *');
    expect(readme).toContain('/api/maintenance');
    expect(readme).toContain('0 * * * *');
  });
});
