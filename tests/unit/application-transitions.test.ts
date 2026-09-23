import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import {
  APPLICATION_TRANSITIONS,
  canTransition,
  menuTargetsFor,
} from '@/lib/applications/transitions';

/**
 * Zgodność macierzy UI z `transition_application` w DB (#306). Test czyta NAJNOWSZĄ migrację
 * definiującą funkcję i porównuje gałęzie `case v_from when … then v_to in (…)`.
 */
const MIGRATIONS = resolve(process.cwd(), 'supabase', 'migrations');

function sqlMatrix(): Record<string, string[]> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      /create or replace function public\.transition_application\s*\(/i.test(
        readFileSync(resolve(MIGRATIONS, f), 'utf-8'),
      ),
    );
  const latest = files.at(-1);
  if (!latest) throw new Error('brak migracji z transition_application');
  const sql = readFileSync(resolve(MIGRATIONS, latest), 'utf-8');
  const fn = sql.slice(sql.search(/create or replace function public\.transition_application\s*\(/i));
  const body = fn.slice(0, fn.indexOf('end $$'));
  const caseBlock = body.slice(body.indexOf('v_allowed := case v_from'), body.indexOf('end;', body.indexOf('v_allowed := case v_from')));
  const out: Record<string, string[]> = {};
  for (const m of caseBlock.matchAll(/when\s+'([a-z_]+)'\s+then\s+v_to\s+in\s*\(([^)]*)\)/g)) {
    out[m[1]!] = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  }
  return out;
}

describe('macierz przejść statusu aplikacji', () => {
  it('jest identyczna z macierzą w transition_application (SQL)', () => {
    const sql = sqlMatrix();
    expect(Object.keys(sql).length).toBeGreaterThan(0);
    expect(APPLICATION_TRANSITIONS).toEqual(sql);
  });

  it('nie oferuje niedozwolonych przejść ani wyjścia ze stanów końcowych', () => {
    expect(canTransition('submitted', 'hired')).toBe(false);
    expect(canTransition('offer_sent', 'interview')).toBe(false);
    expect(menuTargetsFor('submitted')).toEqual(['viewed', 'shortlisted', 'interview', 'rejected']);
    expect(menuTargetsFor('offer_sent')).toEqual(['rejected', 'hired']);
    for (const terminal of ['hired', 'rejected', 'withdrawn', 'offer_accepted', 'offer_declined']) {
      expect(menuTargetsFor(terminal)).toEqual([]);
    }
  });
});
