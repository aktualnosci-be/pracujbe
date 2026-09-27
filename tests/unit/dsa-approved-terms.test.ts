import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Terminy procedury odwołań DSA (#43) zatwierdzone przez właściciela 26.09.2026 (#40):
 * okno odwołania 6 miesięcy, rozpatrzenie 14 dni, retencja spraw 12 miesięcy. Wartości żyją
 * w funkcjach SQL (0104); strażnik bierze NAJNOWSZĄ definicję każdej funkcji z migracji,
 * więc zmiana terminu nową migracją bez nowej decyzji właściciela = czerwony test.
 */
const APPROVED: Record<string, string> = {
  dsa_appeal_window: '6 months',
  dsa_appeal_review_period: '14 days',
  dsa_case_retention: '12 months',
};

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

function latestInterval(sources: readonly string[], fn: string): string | null {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(\\s*\\)[\\s\\S]*?select\\s+interval\\s+'([^']+)'`,
    'gi',
  );
  let found: string | null = null;
  for (const sql of sources) {
    for (const match of sql.matchAll(re)) found = match[1] ?? null;
  }
  return found;
}

function migrationSources(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));
}

describe('terminy DSA zatwierdzone przez właściciela (#40, 26.09.2026)', () => {
  it('najnowsze definicje w migracjach = zatwierdzone wartości', () => {
    const sources = migrationSources();
    for (const [fn, value] of Object.entries(APPROVED)) {
      expect(latestInterval(sources, fn), fn).toBe(value);
    }
  });

  it('kontrola ujemna: późniejsza migracja ze zmienionym terminem jest wykrywana', () => {
    const sources = [
      ...migrationSources(),
      `create or replace function public.dsa_appeal_review_period()
       returns interval language sql immutable as $$ select interval '30 days' $$;`,
    ];
    expect(latestInterval(sources, 'dsa_appeal_review_period')).toBe('30 days');
    expect(latestInterval(sources, 'dsa_appeal_review_period')).not.toBe(APPROVED.dsa_appeal_review_period);
  });
});
