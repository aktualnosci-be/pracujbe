import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { COMPANY_ACTIONS_BY_STATUS } from '@/components/admin/CompanyStatusActions';
import { parseRetentionReport } from '@/lib/data/admin-dsa';

/**
 * Paczka M-1 (migracja 0188, #1037/#1045/#1063/#1098/#1107): zgodność aplikacji z bazą.
 * Zachowanie bazy dowodzi `supabase/tests/rls.sql` (sekcja DSA960) i rollback
 * `dsa-informed-rollback.sql`; tu — kontrakty, które da się sprawdzić bez PostgreSQL:
 *   - przyciski akcji firmy = macierz przejść z NAJNOWSZEJ definicji `admin_set_company_status`,
 *   - raport retencji niesie licznik spraw z regułą zastępczą,
 *   - kod dostępu do sprawy nadal trafia do payloadu tylko po to, by worker mógł złożyć list
 *     (czyszczenie po wysyłce robi strażnik bazy).
 */
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/admin', () => ({ setCompanyStatus: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

function migrations(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
}

function latestDefinition(sources: Array<{ name: string; sql: string }>, fn: string): { name: string; body: string } {
  let found: { name: string; body: string } | null = null;
  for (const { name, sql } of sources) {
    const start = sql.lastIndexOf(`create or replace function public.${fn}(`);
    if (start < 0) continue;
    const end = sql.indexOf('end $$;', start);
    found = { name, body: sql.slice(start, end) };
  }
  if (!found) throw new Error(`brak definicji ${fn}`);
  return found;
}

/** Przejścia z bloku `if not ( … ) then` macierzy statusów firmy. */
function companyTransitions(body: string): Set<string> {
  const block = /if not \(([\s\S]*?)\) then\s+raise exception 'INVALID_TRANSITION/.exec(body);
  if (!block?.[1]) throw new Error('brak macierzy przejść');
  const pairs = new Set<string>();
  const list = (raw: string): string[] => [...raw.matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string);
  for (const clause of block[1].matchAll(/\(\s*v_from\s+(?:in\s*\(([^)]*)\)|=\s*'([a-z]+)')\s+and\s+v_to\s+(?:in\s*\(([^)]*)\)|=\s*'([a-z]+)')\s*\)/g)) {
    const from = clause[1] ? list(clause[1]) : [clause[2] as string];
    const to = clause[3] ? list(clause[3]) : [clause[4] as string];
    for (const f of from) for (const t of to) pairs.add(`${f}>${t}`);
  }
  return pairs;
}

function uiTransitions(): Set<string> {
  const pairs = new Set<string>();
  for (const [from, actions] of Object.entries(COMPANY_ACTIONS_BY_STATUS)) {
    for (const action of actions) pairs.add(`${from}>${action.target}`);
  }
  return pairs;
}

describe('macierz statusów firmy: przyciski = baza (#1107, 0188)', () => {
  it('najnowsza definicja admin_set_company_status pozwala zawiesić firmę pending/unverified', () => {
    const latest = latestDefinition(migrations(), 'admin_set_company_status');
    const db = companyTransitions(latest.body);
    expect(latest.name).toMatch(/^0188_/);
    expect(db.has('pending>suspended')).toBe(true);
    expect(db.has('unverified>suspended')).toBe(true);
    expect(db.has('suspended>rejected')).toBe(true);
    // nadal niedozwolone: odrzuconej firmy się nie zawiesza, z zawieszenia nie wracamy do pending
    expect(db.has('rejected>suspended')).toBe(false);
    expect(db.has('suspended>pending')).toBe(false);
  });

  it('przyciski panelu odpowiadają dokładnie przejściom w bazie', () => {
    const db = companyTransitions(latestDefinition(migrations(), 'admin_set_company_status').body);
    expect([...uiTransitions()].sort()).toEqual([...db].sort());
  });

  it('kontrola ujemna: macierz z 0084 (bez zawieszenia pending) nie zgadza się z przyciskami', () => {
    const sources = migrations().filter((m) => m.name.startsWith('0084_'));
    const old = companyTransitions(latestDefinition(sources, 'admin_set_company_status').body);
    expect(old.has('pending>suspended')).toBe(false);
    expect([...uiTransitions()].sort()).not.toEqual([...old].sort());
  });
});

describe('raport retencji DSA: reguła zastępcza terminu (#1063)', () => {
  it('niesie licznik spraw z biegiem terminu z reguły zastępczej', () => {
    const overview = parseRetentionReport(
      { informedByFallback: 3, waitingForAppealPath: 2, policy: { appealWindowDays: 182, retentionDays: 365 } },
      [],
    );
    expect(overview.informedByFallback).toBe(3);
    expect(overview.waitingForAppealPath).toBe(2);
  });

  it('kontrola ujemna: starszy raport bez pola daje 0, nie NaN', () => {
    expect(parseRetentionReport({}, []).informedByFallback).toBe(0);
    expect(parseRetentionReport({ informedByFallback: 'x' }, []).informedByFallback).toBe(0);
  });
});

describe('kod dostępu do sprawy w kolejce e-mail (#1037, 0188)', () => {
  const sql = migrations().find((m) => m.name.startsWith('0188_'))?.sql ?? '';

  it('migracja czyści kod po wysyłce niezależnie od ścieżki zapisu (trigger BEFORE) i wstecznie', () => {
    expect(sql).toMatch(/create trigger trg_email_deliveries_scrub_access_code\s+before insert or update on public\.email_deliveries/);
    expect(sql).toMatch(/new\.template = 'reportReceived' and new\.status <> 'queued'/);
    expect(sql).toMatch(/update public\.email_deliveries\s+set payload = payload - 'accessCode'/);
  });

  it('payload nadal niesie kod, dopóki zlecenie czeka (worker składa list z payloadu)', () => {
    const fields = readFileSync(join(process.cwd(), 'src', 'lib', 'email', 'payload-fields.ts'), 'utf8');
    expect(fields).toContain('accessCode');
    expect(readFileSync(join(MIGRATIONS, '0094_dsa_notices.sql'), 'utf8')).toContain("'accessCode', p_access_code");
  });
});
