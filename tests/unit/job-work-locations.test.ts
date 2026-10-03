import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateJobDraft } from '@/lib/actions/jobs';
import {
  dedupeWorkLocations,
  parseWorkLocationRows,
  WORK_LOCATION_NAME_MAX,
  WORK_LOCATION_NAME_MIN,
  WORK_LOCATIONS_MAX,
} from '@/lib/job-work-locations';
import { buildJobPostingJsonLd } from '@/lib/seo/structured-data';
import { step3Schema } from '@/lib/validation/job';
import type { JobDetail } from '@/lib/jobs';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #850 (0230): dodatkowe miejsca pracy oferty — lustro reguł RPC, zapis w transakcji kroku 3,
 * JobPosting z listą miejsc. Zachowanie w bazie: `rls.sql` sekcja JWL850 (z kontrolami ujemnymi).
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '22222222-2222-4222-8222-222222222222';
const JOB = '11111111-1111-4111-8111-111111111111';
// Numer migracji tymczasowy (nada integrator) — plik po nazwie.
const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION = readFileSync(
  join(MIGRATIONS_DIR, readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_job_work_locations.sql'))!),
  'utf8',
);

const STEP3 = { city: 'Genk', region: 'Limburg', address: '', remote: false };

describe('lustro reguł set_job_work_locations', () => {
  it('limity TS = limity w migracji', () => {
    expect(MIGRATION).toContain(`position between 1 and ${WORK_LOCATIONS_MAX}`);
    expect(MIGRATION).toContain(
      `char_length(name) between ${WORK_LOCATION_NAME_MIN} and ${WORK_LOCATION_NAME_MAX}`,
    );
    expect(MIGRATION).toContain(`array_length(p_names, 1), 0) > ${WORK_LOCATIONS_MAX}`);
  });

  it('deduplikacja po kluczu miasta i pominięcie miasta głównego', () => {
    expect(dedupeWorkLocations(['Hasselt', '  hasselt ', 'GENK', 'Mol   Balen', 'Liège', 'Liege'], 'Genk')).toEqual([
      'Hasselt',
      'Mol Balen',
      'Liège',
    ]);
    // Kontrola ujemna: inne miasto główne nie wycina Genk.
    expect(dedupeWorkLocations(['Genk'], 'Hasselt')).toEqual(['Genk']);
  });

  it('wiersze RPC → nazwy w kolejności, nieznany kształt pominięty', () => {
    expect(
      parseWorkLocationRows([
        { name: 'Mol', position: 2 },
        { name: 'Hasselt', position: 1 },
        { name: '', position: 3 },
        null,
        { position: 4 },
      ]),
    ).toEqual(['Hasselt', 'Mol']);
  });
});

describe('step3Schema.extraLocations', () => {
  it('przyjmuje listę i składa spacje', () => {
    const r = step3Schema.safeParse({ ...STEP3, extraLocations: ['  Hasselt  ', 'Mol   Balen'] });
    expect(r.success && r.data.extraLocations).toEqual(['Hasselt', 'Mol Balen']);
  });

  it('pole opcjonalne — brak = lista bez zmian', () => {
    const r = step3Schema.safeParse(STEP3);
    expect(r.success && r.data.extraLocations).toBeUndefined();
  });

  it.each([
    ['za dużo pozycji', Array.from({ length: WORK_LOCATIONS_MAX + 1 }, (_, i) => `Miasto ${i}`), 'job.error.workLocationsTooMany'],
    ['za krótka nazwa', ['X'], 'job.error.workLocationInvalid'],
    ['za długa nazwa', ['x'.repeat(WORK_LOCATION_NAME_MAX + 1)], 'job.error.workLocationInvalid'],
    ['znak sterujący', ['Has\u0001selt'], 'job.error.workLocationInvalid'],
  ])('odrzuca: %s', (_label, extraLocations, message) => {
    const r = step3Schema.safeParse({ ...STEP3, extraLocations });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path[0]).toBe('extraLocations');
      expect(r.error.issues[0]!.message).toBe(message);
    }
  });

  it('kontrola ujemna: dokładnie 10 pozycji przechodzi', () => {
    const r = step3Schema.safeParse({
      ...STEP3,
      extraLocations: Array.from({ length: WORK_LOCATIONS_MAX }, (_, i) => `Miasto ${i}`),
    });
    expect(r.success).toBe(true);
  });
});

describe('updateJobDraft — krok 3 z dodatkowymi miejscami', () => {
  let setError: unknown = null;
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb({ id: USER, role: 'employer' });
    setError = null;
    fakeDb
      .rows('jobs.draft-state', () => [{ id: JOB, status: 'draft' }])
      .rpc('save_job_draft', () => ({ updated_at: '2026-10-01T10:00:00.000000Z' }))
      .rpc('set_job_work_locations', () => {
        if (setError) throw setError;
        return 2;
      });
  });

  it('zapisuje listę po save_job_draft w tej samej transakcji (sesja użytkownika)', async () => {
    const result = await updateJobDraft(JOB, 3, { ...STEP3, extraLocations: ['Hasselt', 'Mol'] });
    expect(result).toEqual({ ok: true, version: '2026-10-01T10:00:00.000000Z' });
    const names = fakeDb.calls.map((c) => c.name);
    expect(names).toEqual(['jobs.draft-state', 'save_job_draft', 'set_job_work_locations']);
    const call = fakeDb.calls.find((c) => c.name === 'set_job_work_locations')!;
    expect(call.as).toBe(USER);
    expect(call.args).toEqual({ p_job_id: JOB, p_names: ['Hasselt', 'Mol'] });
  });

  it('pusta lista czyści dodatkowe miejsca (replace-all)', async () => {
    await updateJobDraft(JOB, 3, { ...STEP3, extraLocations: [] });
    expect(fakeDb.calls.find((c) => c.name === 'set_job_work_locations')?.args.p_names).toEqual([]);
  });

  it('kontrola ujemna: krok 3 bez pola nie dotyka listy', async () => {
    await updateJobDraft(JOB, 3, STEP3);
    expect(fakeDb.calls.map((c) => c.name)).not.toContain('set_job_work_locations');
  });

  it('błąd zapisu listy = błąd kroku (kod użytkowy, bez tekstu bazy)', async () => {
    setError = pgError('22023', 'VALIDATION_FAILED: nieprawidłowa nazwa miejsca pracy');
    const result = await updateJobDraft(JOB, 3, { ...STEP3, extraLocations: ['Hasselt'] });
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });

  it('za długa lista odrzucona przed bazą', async () => {
    const result = await updateJobDraft(JOB, 3, {
      ...STEP3,
      extraLocations: Array.from({ length: 11 }, (_, i) => `Miasto ${i}`),
    });
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('JobPosting — jobLocation z dodatkowymi miejscami', () => {
  const base = {
    id: JOB,
    slug: 'mobilna-ekipa',
    title: 'Mobilna ekipa sprzątająca',
    city: 'Genk',
    region: 'Limburg',
    company: 'Firma',
    publishedAt: '2026-09-30T10:00:00Z',
    description: 'Opis',
    responsibilities: [],
    requirementsMandatory: [],
    requirementsOptional: [],
    conditions: [],
    benefits: [],
    languages: [],
  } as unknown as JobDetail;
  const labels: Parameters<typeof buildJobPostingJsonLd>[2] = {
    responsibilities: 'Obowiązki',
    requirementsMandatory: 'Wymagania',
    requirementsOptional: 'Mile widziane',
    conditions: 'Warunki',
    workingHours: 'Godziny',
    shifts: 'Zmiany',
  };

  it('lista miejsc: miasto główne + dodatkowe', () => {
    const ld = buildJobPostingJsonLd({ ...base, workLocations: ['Hasselt', 'genk'] }, 'https://x/o', labels);
    const loc = ld['jobLocation'] as Record<string, Record<string, unknown>>[];
    expect(Array.isArray(loc)).toBe(true);
    expect(loc.map((p) => p['address']!['addressLocality'])).toEqual(['Genk', 'Hasselt']);
    expect(loc[1]!['address']!['addressRegion']).toBeUndefined();
  });

  it('kontrola ujemna: bez dodatkowych miejsc jeden obiekt jak przed #850', () => {
    const ld = buildJobPostingJsonLd(base, 'https://x/o', labels);
    expect(Array.isArray(ld['jobLocation'])).toBe(false);
    expect((ld['jobLocation'] as Record<string, Record<string, unknown>>)['address']!['addressLocality']).toBe('Genk');
  });
});
