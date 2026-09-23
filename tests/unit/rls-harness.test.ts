// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

// Statyczna ochrona harnessu RLS (#23/#25). Dynamiczne kontrole ujemne są w
// supabase/tests/role-guard.sql; tu pilnujemy, by nikt ich po cichu nie odpiął.
describe('Harness testów RLS', () => {
  it('po każdym przełączeniu na rolę klienta wywołuje strażnika roli', async () => {
    const lines = (await read('supabase/tests/rls.sql')).split('\n');
    const switches = lines.filter(line => /^\s*set\s+(local\s+)?role\s+(authenticated|anon)\b/i.test(line));
    expect(switches.length).toBeGreaterThan(50);
    for (const line of switches) {
      expect(line).toMatch(/select pg_temp\.assert_client_role\(\);\s*$/);
    }
    expect(lines).toContain('\\ir role-assert.sql');
  });

  it('działa na produkcyjnym bootstrapie i migracjach auth, bez shimu Supabase', async () => {
    const script = await read('scripts/test-rls.sh');
    expect(script).toContain('database/bootstrap/0001_roles_and_identity.sql');
    expect(script).toContain('database/auth/0*.sql');
    expect(script).toContain('supabase/tests/role-guard.sql');
    expect(script).not.toContain('shim.sql');
  });

  it('kontrole ujemne obejmują superusera, BYPASSRLS, własność tabeli, członkostwo i row_security', async () => {
    const guard = await read('supabase/tests/role-guard.sql');
    for (const name of [
      'superuser bez SET ROLE',
      'rola BYPASSRLS',
      'klient jako właściciel tabeli',
      'klient może przejąć superusera',
      'row_security wyłączone',
    ]) {
      expect(guard).toContain(`'${name}'`);
    }
  });

  it('CI kopiuje katalog database do kontenera testów RLS', async () => {
    const ci = await read('.github/workflows/ci.yml');
    expect(ci).toContain('docker cp database "$POSTGRES_CONTAINER:/tmp/pracujbe-tests/database"');
  });
});
