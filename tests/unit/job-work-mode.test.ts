import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDraftStepContent } from '@/lib/job-draft-content';
import {
  APPLICANT_COUNTRIES,
  normalizeApplicantCountries,
  workModePatch,
} from '@/lib/job-work-mode';
import { step3Schema } from '@/lib/validation/job';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * #792 (migracja 0228 — numer tymczasowy): tryb pracy oferty zamiast niejednoznacznego
 * „Praca zdalna”. JSON-LD (TELECOMMUTE) — `structured-data.test.ts` i `jobs-postgres.test.ts`;
 * baza (CHECK, trigger `remote`, RPC) — `rls.sql` sekcja WD792.
 */

function migrationDefining(fragment: string): string {
  const dir = join(process.cwd(), 'supabase/migrations');
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes(fragment))
    .at(-1)!;
  return readFileSync(join(dir, file), 'utf8');
}

const base = { city: 'Gent', region: 'Flandria', address: '', remote: false };

describe('#792 tryb pracy oferty', () => {
  it('lista krajów = lustro job_applicant_country_allowed w migracji (1:1, ta sama kolejność)', () => {
    const sql = migrationDefining('function public.job_applicant_country_allowed(');
    const body = sql.slice(sql.indexOf('function public.job_applicant_country_allowed('));
    const list = body.slice(body.indexOf('p_code in ('), body.indexOf(')', body.indexOf('p_code in (')));
    const codes = [...list.matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]);
    expect(codes).toEqual([...APPLICANT_COUNTRIES]);
    // Limit liczby krajów w CHECK = długość listy.
    expect(sql).toContain(`cardinality(p_codes) <= ${APPLICANT_COUNTRIES.length}`);
  });

  it('każdy kraj ma nazwę w czterech językach', () => {
    for (const messages of [pl, nl, fr, en] as { countryNames: Record<string, string> }[]) {
      for (const code of APPLICANT_COUNTRIES) expect(messages.countryNames[code], code).toBeTruthy();
      expect(Object.keys(messages.countryNames).sort()).toEqual([...APPLICANT_COUNTRIES].sort());
    }
  });

  it('praca w 100% zdalna wymaga co najmniej jednego kraju (błąd przy polu)', () => {
    const result = step3Schema.safeParse({ ...base, workMode: 'remote', remoteApplicantCountries: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['remoteApplicantCountries'], message: 'job.error.remoteCountriesRequired' }),
      ]);
    }
    expect(step3Schema.safeParse({ ...base, workMode: 'remote', remoteApplicantCountries: ['BE'] }).success).toBe(true);
  });

  it('kontrola ujemna: kraj spoza listy i tryb spoza listy są odrzucane; inne tryby nie wymagają kraju', () => {
    expect(step3Schema.safeParse({ ...base, workMode: 'remote', remoteApplicantCountries: ['US'] }).success).toBe(false);
    expect(step3Schema.safeParse({ ...base, workMode: 'sometimes' }).success).toBe(false);
    expect(step3Schema.safeParse({ ...base, workMode: 'onsite' }).success).toBe(true);
    expect(step3Schema.safeParse({ ...base, workMode: 'hybrid' }).success).toBe(true);
    // Stara oferta bez trybu zostaje poprawna (tryb nieznany).
    expect(step3Schema.safeParse(base).success).toBe(true);
  });

  it('zapis kroku 3: `remote` liczony z trybu, kraje tylko przy pracy zdalnej', () => {
    expect(workModePatch({ remote: true, workMode: 'hybrid', remoteApplicantCountries: ['BE'] })).toEqual({
      remote: false,
      work_mode: 'hybrid',
      remote_applicant_countries: [],
    });
    expect(workModePatch({ remote: false, workMode: 'remote', remoteApplicantCountries: ['NL', 'BE', 'NL'] })).toEqual({
      remote: true,
      work_mode: 'remote',
      remote_applicant_countries: ['BE', 'NL'],
    });
    const content = buildDraftStepContent(3, { ...base, workMode: 'remote', remoteApplicantCountries: ['BE'] });
    expect(content?.job).toMatchObject({ remote: true, work_mode: 'remote', remote_applicant_countries: ['BE'] });
  });

  it('kontrola ujemna: tryb nieznany nie zgaduje — zachowuje dawny boolean i nie wysyła trybu', () => {
    expect(workModePatch({ remote: true })).toEqual({ remote: true, work_mode: null, remote_applicant_countries: [] });
    expect(workModePatch({ remote: false })).toEqual({ remote: false, work_mode: null, remote_applicant_countries: [] });
  });

  it('normalizacja krajów: wielkie litery, bez powtórzeń, bez nieznanych, kolejność listy', () => {
    expect(normalizeApplicantCountries([' nl', 'BE', 'xx', 'BE', 3, null])).toEqual(['BE', 'NL']);
    expect(normalizeApplicantCountries(null)).toEqual([]);
  });
});
