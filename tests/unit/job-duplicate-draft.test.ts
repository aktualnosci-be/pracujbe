import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { duplicateJobAsDraft } from '@/lib/actions/jobs';
import { toUserMessageKey } from '@/lib/errors';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * 0216 — „Kopiuj jako szkic”: akcja woła JEDNO RPC `duplicate_job_as_draft` pod sesją
 * (idempotencja, uprawnienia, blokady i kopia w bazie — dowód `rls.sql` sekcja JD216). Tu
 * pilnujemy granicy akcji: aktywna firma, klucz klienta, kody użytkowe zamiast tekstu bazy
 * oraz zakres kopii zapisany w migracji (co kopiujemy, czego nie).
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const active = vi.hoisted(() => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string | null }));
vi.mock('@/lib/company-context', () => ({ getActiveCompanyId: vi.fn(async () => active.id) }));

const USER = '22222222-2222-4222-8222-222222222222';
const JOB = '11111111-1111-4111-8111-111111111111';
const NEW = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let sourceCompany: string | null = COMPANY;
let rpcError: unknown = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  active.id = COMPANY;
  sourceCompany = COMPANY;
  rpcError = null;
  fakeDb
    .rows('jobs.duplicate-source', () => (sourceCompany ? [{ company_id: sourceCompany }] : []))
    .rpc('duplicate_job_as_draft', () => {
      if (rpcError) throw rpcError;
      return NEW;
    });
});

describe('duplicateJobAsDraft (0216)', () => {
  it('jedno RPC pod sesją z kluczem klienta → id nowego szkicu', async () => {
    expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: true, id: NEW });
    const calls = fakeDb.callsTo('duplicate_job_as_draft');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ as: USER, args: { p_job_id: JOB, p_client_key: KEY } });
    // Żadnych bezpośrednich zapisów tabel — kopię robi wyłącznie funkcja w bazie.
    expect(fakeDb.calls.filter((c) => c.kind === 'exec')).toHaveLength(0);
  });

  it('ponowienie tym samym kluczem przekazuje ten sam klucz (idempotencja w bazie)', async () => {
    await duplicateJobAsDraft(JOB, KEY);
    await duplicateJobAsDraft(JOB, KEY);
    const keys = fakeDb.callsTo('duplicate_job_as_draft').map((c) => c.args.p_client_key);
    expect(keys).toEqual([KEY, KEY]);
  });

  it('oferta spoza AKTYWNEJ firmy → NOT_FOUND bez RPC', async () => {
    sourceCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    sourceCompany = null;
    expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.callsTo('duplicate_job_as_draft')).toHaveLength(0);
  });

  it('błędy bazy → kody użytkowe, bez tekstu bazy', async () => {
    const cases: Array<[string, string]> = [
      ['COMPANY_SUSPENDED: firma zawieszona', 'COMPANY_SUSPENDED'],
      ['MODERATION_LOCKED: oferta wycofana decyzją moderacyjną', 'MODERATION_LOCKED'],
      ['PERMISSION_DENIED: kopiowanie oferty wymaga roli recruiter+', 'PERMISSION_DENIED'],
      ['NOT_FOUND: oferta nie istnieje', 'NOT_FOUND'],
      ['VALIDATION_FAILED: klucz użyty dla innej oferty', 'VALIDATION_FAILED'],
    ];
    for (const [message, code] of cases) {
      rpcError = pgError('42501', message);
      expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: false, error: code });
    }
    rpcError = new Error('connect ECONNREFUSED 10.0.0.1:5432');
    expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('COMPANY_SUSPENDED ma komunikat w każdym języku', () => {
    const key = toUserMessageKey('COMPANY_SUSPENDED').replace('errors.', '');
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), 'src/messages', `${locale}.json`), 'utf8'),
      ) as { errors: Record<string, string>; dashboard: Record<string, string> };
      expect(messages.errors[key], locale).toBeTruthy();
      expect(messages.dashboard.duplicateJobLabel, locale).toContain('{title}');
    }
  });

  it('zły klucz albo brak sesji — bez bazy; demo bez zapisu', async () => {
    expect(await duplicateJobAsDraft(JOB, 'nie-uuid')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await duplicateJobAsDraft('nie-uuid', KEY)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeSession.identity = null;
    expect(await duplicateJobAsDraft(JOB, KEY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.configured = false;
    expect(await duplicateJobAsDraft('12345', KEY)).toMatchObject({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('migracja kopiuje treść, ale nie status, slug, daty publikacji ani blokadę moderacyjną', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0216_job_duplicate_draft.sql'),
      'utf8',
    );
    const body = sql.slice(sql.indexOf('create or replace function public.duplicate_job_as_draft'));
    const insertJobs = /insert into public\.jobs \(([^)]*)\)/.exec(body)![1]!;
    const cols = insertJobs.split(',').map((c) => c.trim());
    // Kolumny z listy dozwolonych save_job_draft (0083) — wszystkie kopiowane.
    for (const col of ['title', 'category', 'occupation', 'contract_type', 'city', 'region',
      'salary_min', 'salary_max', 'salary_period', 'working_hours', 'contact_email']) {
      expect(cols, col).toContain(col);
    }
    for (const col of ['published_at', 'expires_at', 'moderation_decision_id', 'views_count',
      'applications_count']) {
      expect(cols, col).not.toContain(col);
    }
    expect(body).toMatch(/'draft-' \|\| gen_random_uuid\(\)/);
    for (const table of ['job_translations', 'job_requirements', 'job_skills', 'job_languages',
      'job_certificates', 'job_screening_questions']) {
      expect(body, table).toContain(`insert into public.${table}`);
    }
    // Decyzje przeglądu pytań nie przechodzą na kopię (nowy przegląd tworzy trigger 0103).
    expect(body).not.toContain('insert into public.screening_question_reviews');
    expect(body).toContain("write_audit('job.duplicated'");
  });
});
