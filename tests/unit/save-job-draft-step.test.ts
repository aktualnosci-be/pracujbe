import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateJobDraft } from '@/lib/actions/jobs';
import { isSupabaseConfigured } from '@/lib/env';
import { buildDraftStepContent } from '@/lib/job-draft-content';

/**
 * #192 — każdy krok kreatora zapisuje się JEDNYM transakcyjnym RPC `save_job_draft` (0083).
 * Atomowość (błąd relacji = brak częściowego zapisu) dowodzi `rls.sql` sekcja WZ192; tu
 * pilnujemy granicy: jedno wywołanie na krok, brak bezpośrednich zapisów tabel, kody użytkowe
 * zamiast tekstu bazy i zgodność kluczy treści z listą dozwolonych pól w migracji.
 */

const rpc = vi.fn();
const from = vi.fn();
const getUser = vi.fn();
let jobRow: Record<string, unknown> | null = null;

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({ rpc, from, auth: { getUser } })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

function selectChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: jobRow, error: null }),
    update: vi.fn(),
    upsert: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  return chain;
}

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
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
  jobRow = { id: JOB, status: 'draft' };
  from.mockImplementation(() => selectChain());
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('updateJobDraft — jeden zapis transakcyjny na krok (#192)', () => {
  it.each(Object.keys(STEPS).map(Number))('krok %i idzie jednym RPC save_job_draft', async (step) => {
    const result = await updateJobDraft(JOB, step, STEPS[step]);

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('save_job_draft');
    expect(args.p_job_id).toBe(JOB);
    expect(args.p_content).toEqual(buildDraftStepContent(step, STEPS[step]));
    // Jedyny odczyt przez `from` to kontrola szkicu — żadnych bezpośrednich zapisów tabel.
    for (const call of from.mock.results) {
      const chain = call.value as ReturnType<typeof selectChain>;
      expect(chain.update).not.toHaveBeenCalled();
      expect(chain.upsert).not.toHaveBeenCalled();
      expect(chain.insert).not.toHaveBeenCalled();
      expect(chain.delete).not.toHaveBeenCalled();
    }
  });

  it('krok 7 niesie wszystkie relacje w jednej treści', () => {
    expect(buildDraftStepContent(7, STEPS[7])).toEqual({
      job: { requires_driving_license: false, no_language_required: false },
      requirements_optional: ['Wózek'],
      skills_optional: ['Excel'],
      languages: [{ language: 'Angielski', level: 'basic' }],
      certificates: ['VCA'],
    });
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
    rpc.mockResolvedValue({ data: null, error: { message: 'invalid input value for enum language_level' } });
    expect(await updateJobDraft(JOB, 7, STEPS[7])).toEqual({ ok: false, error: 'INTERNAL' });

    rpc.mockResolvedValue({ data: null, error: { message: 'JOB_NOT_DRAFT: kreator zapisuje wyłącznie szkic' } });
    expect(await updateJobDraft(JOB, 7, STEPS[7])).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });
  });

  it('opublikowana oferta nie woła RPC szkicu (JOB_NOT_DRAFT, zachowanie #325)', async () => {
    jobRow = { id: JOB, status: 'active' };
    expect(await updateJobDraft(JOB, 1, STEPS[1])).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nieprawidłowe dane kroku nie trafiają do bazy', async () => {
    expect(await updateJobDraft(JOB, 1, { title: '' })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
