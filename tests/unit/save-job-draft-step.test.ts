import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateJobDraft } from '@/lib/actions/jobs';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #192 — każdy krok kreatora zapisuje się JEDNYM transakcyjnym RPC `save_job_draft` (0083).
 * Atomowość (błąd relacji = brak częściowego zapisu) dowodzi `rls.sql` sekcja WZ192; tu
 * pilnujemy granicy: jedno wywołanie na krok, brak bezpośrednich zapisów tabel, kody użytkowe
 * zamiast tekstu bazy i zgodność kluczy treści z listą dozwolonych pól w migracji.
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '22222222-2222-4222-8222-222222222222';
let jobRow: Record<string, unknown> | null = null;
let saveError: unknown = null;

const JOB = '11111111-1111-4111-8111-111111111111';

const STEPS: Record<number, unknown> = {
  1: { title: 'Magazynier', category: 'warehouse', occupation: 'Magazynier' },
  2: { contractType: 'temporary', workingHours: '40 h', shifts: '', startImmediately: true },
  3: { city: 'Gandawa', region: 'Flandria', address: '', remote: false },
  4: { salaryMin: 16, salaryMax: 18, currency: 'EUR', salaryPeriod: 'hour' },
  5: { description: 'Praca na magazynie w Gandawie, zmiana nocna, stała ekipa.', responsibilities: ['Kompletacja'] },
  6: { requirementsMandatory: ['Praca w nocy'], mandatorySkills: ['Skaner'], minExperienceYears: 1 },
  7: {
    requirementsOptional: ['Wózek'],
    skills: ['Excel'],
    languages: [{ language: 'Angielski', level: 'basic' }],
    requiredCertificates: ['VCA'],
    requiresDrivingLicense: false,
    noLanguageRequired: false,
  },
  8: { conditions: ['Umowa'], benefits: ['Dodatek nocny'], accommodation: true, transport: false },
  9: { companyDescription: 'Firma A — logistyka w Gandawie.', contactEmail: 'hr@firma-a.be' },
};

/** Lista dozwolonych pól z ciała `save_job_draft` w migracji 0083. */
function allowedKeys(): { job: Set<string>; translation: Set<string> } {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/0083_save_job_draft_atomic.sql'),
    'utf8',
  );
  const lists = [...sql.matchAll(/k not in \(([^)]*)\)/g)].map(
    (m) => new Set([...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)),
  );
  return { job: lists[0]!, translation: lists[1]! };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  jobRow = { id: JOB, status: 'draft' };
  saveError = null;
  fakeDb
    .rows('jobs.draft-state', () => (jobRow ? [jobRow] : []))
    .rpc('save_job_draft', () => {
      if (saveError) throw saveError;
      return null;
    });
});

/** Wywołania RPC (bez zapytań tabelowych). */
function rpcCalls() {
  return fakeDb.calls.filter((c) => c.kind === 'rpc' || c.kind === 'rpcrows');
}

describe('updateJobDraft — jeden zapis transakcyjny na krok (#192)', () => {
  it.each(Object.keys(STEPS).map(Number))('krok %i idzie jednym RPC save_job_draft', async (step) => {
    const result = await updateJobDraft(JOB, step, STEPS[step]);

    expect(result).toEqual({ ok: true });
    const calls = rpcCalls();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.name).toBe('save_job_draft');
    expect(call!.as).toBe(USER);
    expect(call!.args.p_job_id).toBe(JOB);
    // Treść trafia do funkcji jako jsonb (JSON, nie literał tablicy PG).
    expect(JSON.parse(String(call!.args.p_content))).toEqual(buildDraftStepContent(step, STEPS[step]));
    // Jedyne zapytanie poza RPC to odczyt stanu szkicu — żadnych bezpośrednich zapisów tabel.
    expect(fakeDb.calls.filter((c) => c.kind === 'exec')).toHaveLength(0);
    expect(fakeDb.calls.map((c) => c.name)).toEqual(['jobs.draft-state', 'save_job_draft']);
  });

  it('krok 7 niesie wszystkie relacje w jednej treści', () => {
    expect(buildDraftStepContent(7, STEPS[7])).toEqual({
      job: { requires_driving_license: false, no_language_required: false },
      requirements_optional: ['Wózek'],
      skills_optional: ['Excel'],
      languages: [{ language: 'Angielski', level: 'basic' }],
      certificates: ['VCA'],
      screening_questions: [],
    });
  });

  it('krok 7 niesie pytania screeningowe w tej samej treści (#101)', () => {
    const content = buildDraftStepContent(7, {
      ...(STEPS[7] as object),
      screeningQuestions: [
        { type: 'yes_no', required: true, prompt: { pl: ' Prawo jazdy C? ', en: ' ' }, options: [] },
        {
          type: 'single_choice',
          required: false,
          prompt: { pl: 'Dojazd' },
          options: [{ label: { pl: 'Auto', nl: 'Auto NL' } }, { label: { pl: 'Autobus' } }],
        },
        { type: 'short_text', required: false, prompt: { pl: 'Doświadczenie' }, options: [{ label: { pl: 'x' } }] },
      ],
    });
    expect(content?.screening_questions).toEqual([
      { type: 'yes_no', required: true, prompt: { pl: 'Prawo jazdy C?' }, options: [] },
      {
        type: 'single_choice',
        required: false,
        prompt: { pl: 'Dojazd' },
        options: [{ label: { pl: 'Auto', nl: 'Auto NL' } }, { label: { pl: 'Autobus' } }],
      },
      // Opcje tylko dla pytania wyboru — inaczej baza odrzuciłaby krok.
      { type: 'short_text', required: false, prompt: { pl: 'Doświadczenie' }, options: [] },
    ]);
  });

  it('klucze treści każdego kroku mieszczą się w liście dozwolonych pól migracji', () => {
    const allowed = allowedKeys();
    for (const step of Object.keys(STEPS).map(Number)) {
      const content = buildDraftStepContent(step, STEPS[step])!;
      for (const key of Object.keys((content.job as object) ?? {})) {
        expect(allowed.job.has(key), `krok ${step}: jobs.${key}`).toBe(true);
      }
      for (const key of Object.keys((content.translation as object) ?? {})) {
        expect(allowed.translation.has(key), `krok ${step}: translation.${key}`).toBe(true);
      }
    }
  });

  it('błąd RPC (np. relacji) → kod użytkowy, bez tekstu bazy', async () => {
    saveError = pgError('22P02', 'invalid input value for enum language_level');
    expect(await updateJobDraft(JOB, 7, STEPS[7])).toEqual({ ok: false, error: 'INTERNAL' });

    saveError = pgError('P0001', 'JOB_NOT_DRAFT: kreator zapisuje wyłącznie szkic');
    expect(await updateJobDraft(JOB, 7, STEPS[7])).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });

    // Wyjątek spoza bazy (sieć) też daje kod, nie tekst.
    saveError = new Error('connect ECONNREFUSED 10.0.0.1:5432');
    expect(await updateJobDraft(JOB, 7, STEPS[7])).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('opublikowana oferta nie woła RPC szkicu (JOB_NOT_DRAFT, zachowanie #325)', async () => {
    jobRow = { id: JOB, status: 'active' };
    expect(await updateJobDraft(JOB, 1, STEPS[1])).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });
    expect(rpcCalls()).toHaveLength(0);
  });

  it('niewidoczna (obca) oferta → NOT_FOUND bez RPC', async () => {
    jobRow = null;
    expect(await updateJobDraft(JOB, 1, STEPS[1])).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(rpcCalls()).toHaveLength(0);
  });

  it('bez sesji — PERMISSION_DENIED; bez backendu — demo bez zapisu', async () => {
    fakeSession.identity = null;
    expect(await updateJobDraft(JOB, 1, STEPS[1])).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.configured = false;
    expect(await updateJobDraft(JOB, 1, STEPS[1])).toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('nieprawidłowe dane kroku nie trafiają do bazy', async () => {
    expect(await updateJobDraft(JOB, 1, { title: '' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
