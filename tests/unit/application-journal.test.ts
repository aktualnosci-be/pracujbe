import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #904 — prywatny dziennik aplikacji kandydata (0970).
 * Walidacja pól, mapowanie wiersza, akcje (RPC pod sesją, demo, błędy bez technikaliów),
 * strażnik: tabela tylko w plikach dziennika (firmy i proces jej nie czytają), migracja bez
 * grantów zapisu. Zachowanie bazy (RLS, limit, eksport, usunięcie konta): rls.sql sekcja AJ904.
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import { deleteJournalEntryAction, saveJournalEntryAction } from '@/lib/actions/application-journal';
import { loadMyJournal, mapJournalRow } from '@/lib/data/application-journal';
import { isJournalHttpsUrl, isValidYmd, journalEntrySchema } from '@/lib/validation/application-journal';

const USER = '11111111-1111-4111-8111-111111111111';
const KEY = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
const ROOT = resolve(__dirname, '../..');

const valid = {
  clientKey: KEY,
  jobTitle: 'Magazynier',
  companyName: 'Firma X',
  sourceUrl: 'https://vdab.be/vacature/1',
  location: 'Antwerpia',
  appliedOn: '2026-09-20',
  stage: 'sent',
  note: 'Rozmowa w czwartek',
  remindOn: '2026-10-01',
};

describe('walidacja pól dziennika', () => {
  it('przycina, zamienia puste pola opcjonalne na null i przyjmuje poprawny wpis', () => {
    const out = journalEntrySchema.parse({ jobTitle: ' A ', companyName: ' B ', stage: 'planned', sourceUrl: '', note: ' ' });
    expect(out).toMatchObject({ jobTitle: 'A', companyName: 'B', sourceUrl: null, note: null, location: null, appliedOn: null });
  });

  it('kontrole ujemne: pusty tytuł, adres bez https, zła data, nieznany etap, za długa notatka', () => {
    const base = { jobTitle: 'a', companyName: 'b', stage: 'sent' };
    expect(journalEntrySchema.safeParse({ ...base, jobTitle: '  ' }).success).toBe(false);
    expect(journalEntrySchema.safeParse({ ...base, sourceUrl: 'http://x.be' }).success).toBe(false);
    expect(journalEntrySchema.safeParse({ ...base, appliedOn: '2026-02-31' }).success).toBe(false);
    expect(journalEntrySchema.safeParse({ ...base, stage: 'hired' }).success).toBe(false);
    expect(journalEntrySchema.safeParse({ ...base, note: 'x'.repeat(2001) }).success).toBe(false);
    expect(isValidYmd('2026-09-20')).toBe(true);
    expect(isJournalHttpsUrl('https://localhost')).toBe(false);
    expect(isJournalHttpsUrl('https://a b.be')).toBe(false);
  });
});

describe('mapowanie wiersza', () => {
  it('nieznany etap → sent, adres nie-https pomijany, brak tytułu = wiersz odrzucony', () => {
    const row = { id: 'i', job_title: 'T', company_name: 'F', stage: 'zzz', source_url: 'javascript:alert(1)', remind_due: true };
    expect(mapJournalRow(row)).toMatchObject({ stage: 'sent', sourceUrl: null, remindDue: true });
    expect(mapJournalRow({ ...row, job_title: '' })).toBeNull();
  });
});

describe('akcje dziennika', () => {
  beforeEach(() => resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity));

  it('zapis woła RPC pod sesją z polami znormalizowanymi i zwraca id', async () => {
    fakeDb.rpc('save_application_journal_entry', () => KEY);
    expect(await saveJournalEntryAction(valid)).toEqual({ ok: true, id: KEY });
    const call = fakeDb.callsTo('save_application_journal_entry')[0]!;
    expect(call.as).toBe(USER);
    expect(call.args).toMatchObject({ p_client_key: KEY, p_job_title: 'Magazynier', p_stage: 'sent', p_applied_on: '2026-09-20' });
  });

  it('walidacja i numer identyfikacyjny w notatce → VALIDATION_FAILED z polem, bez zapytania', async () => {
    expect(await saveJournalEntryAction({ ...valid, sourceUrl: 'http://x.be' })).toEqual({ ok: false, error: 'VALIDATION_FAILED', field: 'sourceUrl' });
    expect(await saveJournalEntryAction({ ...valid, note: 'NISS 85.07.30-033-61' })).toEqual({ ok: false, error: 'VALIDATION_FAILED', field: 'note' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji, demo, limit i nieznany błąd bazy', async () => {
    fakeSession.identity = null;
    expect(await saveJournalEntryAction(valid)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    fakeSession.identity = { id: USER, role: 'candidate' } as PortalIdentity;
    fakeSession.configured = false;
    expect(await saveJournalEntryAction(valid)).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    fakeSession.configured = true;
    let n = 0;
    fakeDb.rpc('save_application_journal_entry', () => {
      throw pgError('P0001', n++ === 0 ? 'JOURNAL_LIMIT_REACHED: 200' : 'relation "x" does not exist');
    });
    expect(await saveJournalEntryAction(valid)).toEqual({ ok: false, error: 'JOURNAL_LIMIT_REACHED' });
    expect(await saveJournalEntryAction(valid)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('usunięcie: UUID + RPC; cudzy wpis → NOT_FOUND z bazy', async () => {
    expect(await deleteJournalEntryAction('nie-uuid')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    fakeDb.rpc('delete_application_journal_entry', () => undefined);
    expect(await deleteJournalEntryAction(KEY)).toEqual({ ok: true });
    fakeDb.rpc('delete_application_journal_entry', () => {
      throw pgError('P0002', 'NOT_FOUND: wpis dziennika');
    });
    expect(await deleteJournalEntryAction(KEY)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('loader: własne wiersze pod sesją, błąd odczytu = error, demo = pusta lista', async () => {
    fakeDb.rows('application-journal.mine', () => [{ id: 'i1', job_title: 'T', company_name: 'F', stage: 'interview' }]);
    const ok = await loadMyJournal();
    expect(ok).toMatchObject({ status: 'ready', demo: false });
    expect(fakeDb.callsTo('application-journal.mine')[0]!.values).toEqual([USER]);
    fakeDb.rows('application-journal.mine', () => {
      throw pgError('XX000', 'boom');
    });
    expect(await loadMyJournal()).toEqual({ status: 'error' });
    fakeSession.configured = false;
    expect(await loadMyJournal()).toEqual({ status: 'ready', entries: [], demo: true });
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('strażnik prywatności dziennika', () => {
  it('tabela występuje w src tylko w plikach dziennika i klasyfikacji danych (firmy jej nie czytają)', () => {
    const allowed = new Set([
      'src/lib/data/application-journal.ts',
      'src/lib/privacy/data-map.ts',
    ]);
    const hits = walk(join(ROOT, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('candidate_application_journal'))
      .map((f) => f.slice(ROOT.length + 1));
    expect(hits.filter((f) => !allowed.has(f))).toEqual([]);
    expect(hits.sort()).toEqual([...allowed].sort());
  });

  it('migracja: RLS wymuszone, tylko SELECT dla authenticated, brak związku z ofertą i procesem', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/0970_candidate_application_journal.sql'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).toMatch(/force row level security/);
    expect(sql).toMatch(/grant select on public\.candidate_application_journal to authenticated/);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*candidate_application_journal/i);
    expect(sql).not.toMatch(/\bjob_id\b|\bcompany_id\b|references public\.(jobs|applications|companies)/);
    expect(sql).toMatch(/references public\.profiles\(id\) on delete cascade/);
  });

  it('kontrola ujemna: wykrywacz wskazuje plik spoza listy', () => {
    const fake = "select * from public.candidate_application_journal";
    expect(fake.includes('candidate_application_journal')).toBe(true);
  });
});
