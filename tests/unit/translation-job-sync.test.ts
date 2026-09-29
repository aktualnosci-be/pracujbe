// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRANSLATION_PIPELINE_VERSION } from '@/lib/translation/pipeline';

/**
 * #33 — kontrakt migracji synchronizacji ofert z kolejką tłumaczeń: wersja pipeline w SQL
 * (`translation_pipeline_version()`) = stała TS (klucz deduplikacji zadań), odroczone triggery
 * na każdej tabeli treści oferty i firmie. Zachowanie w bazie: `rls.sql` sekcja TR33.
 */

const DIR = resolve(__dirname, '../../supabase/migrations');
const file = readdirSync(DIR).find((f) => /^\d{4}_job_translation_sync\.sql$/.test(f));
const sql = file ? readFileSync(join(DIR, file), 'utf8') : '';
/** Wszystkie migracje w kolejności numerów — obowiązuje NAJNOWSZA definicja funkcji/triggera. */
const allSql = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => readFileSync(join(DIR, f), 'utf8'))
  .join('\n');

function sqlPipelineVersion(source: string): string | null {
  const all = [...source.matchAll(/function public\.translation_pipeline_version\(\)[\s\S]*?select '([^']+)'::text/g)];
  return all.at(-1)?.[1] ?? null;
}

/** Najnowsza definicja triggera synchronizacji na `companies`. */
function companiesTrigger(source: string): string | null {
  const all = [...source.matchAll(/create constraint trigger trg_job_translation_sync_companies\s+after ([^;]*?) on public\.companies/g)];
  return all.at(-1)?.[1] ?? null;
}

describe('synchronizacja ofert z kolejką tłumaczeń (#33)', () => {
  it('migracja istnieje i jest późniejsza niż rdzeń kolejki', () => {
    expect(file).toBeDefined();
    const core = readdirSync(DIR).find((f) => /_translation_queue\.sql$/.test(f));
    expect(core).toBeDefined();
    expect(file! > core!).toBe(true);
  });

  it('wersja pipeline w SQL (najnowsza definicja) = stała TS', () => {
    expect(sqlPipelineVersion(allSql)).toBe(TRANSLATION_PIPELINE_VERSION);
  });

  it('kontrola ujemna: inna wersja w SQL zostałaby wykryta', () => {
    const mutated = allSql.replaceAll(TRANSLATION_PIPELINE_VERSION, 'translation-v0+prompt-v0+glossary-v0');
    expect(sqlPipelineVersion(mutated)).not.toBe(TRANSLATION_PIPELINE_VERSION);
    // Starsza definicja (0146) nie wystarcza — liczy się ostatnia.
    expect(sqlPipelineVersion(sql)).not.toBe(TRANSLATION_PIPELINE_VERSION);
  });

  it('#740: zmiana nazwy firmy synchronizuje oferty (najnowszy trigger na companies)', () => {
    expect(companiesTrigger(allSql)).toMatch(/update of [^;]*\bname\b/);
    // Kontrola ujemna: trigger z 0146 nie reagował na nazwę.
    expect(companiesTrigger(sql)).not.toMatch(/\bname\b/);
  });

  it('#740: synchronizacja przekazuje nazwę firmy z bazy jako nazwę chronioną', () => {
    const all = [...allSql.matchAll(/create or replace function public\.sync_job_translation_source\([\s\S]*?end \$\$;/g)];
    const latest = all.at(-1)?.[0] ?? '';
    expect(latest).toContain('c.name as company_name');
    expect(latest).toMatch(/record_translation_source\([^;]*array\[v_job\.company_name\]/);
  });

  it.each(['jobs', 'job_translations', 'job_requirements', 'companies'])(
    'odroczony trigger synchronizacji na %s',
    (table) => {
      const re = new RegExp(
        `create constraint trigger trg_job_translation_sync_\\w+\\s+after [^;]*? on public\\.${table} deferrable initially deferred`,
      );
      expect(sql).toMatch(re);
    },
  );

  it('funkcje synchronizacji bez EXECUTE dla ról klienta', () => {
    for (const fn of ['sync_job_translation_source(uuid)', 'job_translation_source_fields(uuid)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public;`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, '\\$&')} to (anon|authenticated)`));
    }
  });
});
