import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { setContactMessageStatus } from '@/lib/actions/admin';
import { deleteJobDraft } from '@/lib/actions/jobs';
import { deleteMessageTemplate } from '@/lib/actions/message-templates';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import { markNotificationsRead } from '@/lib/actions/notifications';
import { inviteTeamMember } from '@/lib/actions/team';
import { captureActionError, reportUnmappedDbError } from '@/lib/db/errors';
import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';
import { setErrorReporter, type ErrorReport } from '@/lib/error-report';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #1068: nieoczekiwany błąd bazy (SQLSTATE spoza znanej listy) w Server Actions nie kończy się
 * już cichym INTERNAL — trafia do kanału błędów z obszarem i SQLSTATE, bez komunikatu bazy.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/company-context')>('@/lib/company-context');
  const getActiveCompany = vi.fn();
  return {
    ACTIVE_COMPANY_COOKIE: 'pb_active_company',
    getActiveCompany,
    getExpectedActiveCompany: async (tx: never, userId: string, expected: unknown) =>
      actual.matchExpectedCompany(await getActiveCompany(tx, userId), expected),
  };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));

const USER = '8e6b3d7a-5c7f-4f4b-8d69-4c0e5f2a1b34';
const COMPANY = '7d5a2c6f-4b6e-4e3a-9c58-3b9d4e1f0a23';
const SECRET_ROW = 'Failing row contains (kandydat@example.com, 12345)';

const reports: ErrorReport[] = [];

beforeEach(() => {
  reports.length = 0;
  setErrorReporter((r) => reports.push(r));
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({ activeId: COMPANY, activeRole: 'owner' } as never);
});
afterEach(() => {
  setErrorReporter(null);
  vi.unstubAllEnvs();
});

describe('reportUnmappedDbError', () => {
  it('INTERNAL z błędu bazy → zgłoszenie z obszarem i SQLSTATE, bez komunikatu', () => {
    const error = pgError('42P01', SECRET_ROW);
    expect(reportUnmappedDbError(error, 'x.y', 'INTERNAL')).toBe('INTERNAL');
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'x.y', sqlstate: '42P01' }]);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('kontrole ujemne: znany kod użytkowy i błąd spoza bazy nie są zgłaszane tu', () => {
    expect(reportUnmappedDbError(pgError('P0001', 'NOT_FOUND'), 'x.y', 'NOT_FOUND')).toBe('NOT_FOUND');
    expect(reportUnmappedDbError(new Error('sieć'), 'x.y', 'INTERNAL')).toBe('INTERNAL');
    expect(reports).toEqual([]);
  });
});

describe('akcje zespołu (#1068)', () => {
  it('nieznany SQLSTATE w RPC → INTERNAL dla użytkownika + wpis w kanale błędów', async () => {
    fakeDb.rpc('invite_company_member', () => {
      throw pgError('XX000', SECRET_ROW);
    });
    const result = await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY);
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ code: 'INTERNAL', sqlstate: 'XX000' });
    expect(reports[0]!.area).toMatch(/^team\./);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('kontrola ujemna: znany błąd biznesowy (MEMBER_ALREADY_EXISTS) nie trafia do kanału', async () => {
    fakeDb.rpc('invite_company_member', () => {
      throw pgError('P0001', 'MEMBER_ALREADY_EXISTS');
    });
    const result = await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY);
    expect(result).toEqual({ ok: false, error: 'MEMBER_ALREADY_EXISTS' });
    expect(reports).toEqual([]);
  });
});

describe('dokończenie #1068: oferty i pozostałe akcje poza trybem rekrutacyjnym', () => {
  const JOB = '5c4b1e5d-3a5f-4d29-8b47-2a8c3d0e9f12';

  it('oferty: nieznany SQLSTATE → INTERNAL + wpis z obszarem akcji i SQLSTATE, bez komunikatu bazy', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw pgError('42703', SECRET_ROW);
    });
    const result = await deleteJobDraft(JOB);
    expect(result).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'jobs.deleteJobDraft', sqlstate: '42703' }]);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('oferty: wyjątek spoza bazy (sieć) też trafia do kanału, dawniej był cichym INTERNAL', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(await deleteJobDraft(JOB)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ area: 'jobs.deleteJobDraft' });
  });

  it('kontrola ujemna: znany błąd biznesowy oferty (MODERATION_LOCKED) nie trafia do kanału', async () => {
    fakeDb.rows('jobs.delete-draft-state', () => {
      throw pgError('P0001', 'MODERATION_LOCKED');
    });
    expect(await deleteJobDraft(JOB)).toEqual({ ok: false, error: 'MODERATION_LOCKED' });
    expect(reports).toEqual([]);
  });

  it('powiadomienia: nieznany SQLSTATE → wpis; znany (PERMISSION_DENIED) → bez wpisu', async () => {
    fakeDb.rpc('mark_notifications_read', () => {
      throw pgError('53300', SECRET_ROW);
    });
    expect(await markNotificationsRead()).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'notifications.markNotificationsRead', sqlstate: '53300' }]);

    reports.length = 0;
    fakeDb.rpc('mark_notifications_read', () => {
      throw pgError('42501', 'new row violates row-level security policy');
    });
    expect(await markNotificationsRead()).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(reports).toEqual([]);
  });

  it('panel admina: nieznany SQLSTATE w RPC → wpis; STALE_STATE → bez wpisu', async () => {
    resetFakeDb({ id: USER, role: 'admin' });
    fakeDb.rpc('admin_set_contact_message_status', () => {
      throw pgError('XX000', SECRET_ROW);
    });
    const failed = await setContactMessageStatus(JOB, 'handled', 'new');
    expect(failed).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'admin.setContactMessageStatus', sqlstate: 'XX000' }]);

    reports.length = 0;
    fakeDb.rpc('admin_set_contact_message_status', () => {
      throw pgError('P0001', 'STALE_STATE');
    });
    expect(await setContactMessageStatus(JOB, 'handled', 'new')).toEqual({ ok: false, error: 'STALE_STATE' });
    expect(reports).toEqual([]);
  });
});

describe('captureActionError (#1068)', () => {
  it('błąd bazy → wpis z obszarem i SQLSTATE, bez komunikatu bazy', () => {
    captureActionError(pgError('57014', SECRET_ROW), 'a.b');
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'a.b', sqlstate: '57014' }]);
    expect(JSON.stringify(reports)).not.toContain('example.com');
  });

  it('kontrola ujemna: wyjątek spoza bazy → wpis bez pola sqlstate', () => {
    captureActionError(new Error('connect ECONNREFUSED'), 'a.b');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ area: 'a.b' });
    expect(reports[0]?.sqlstate).toBeUndefined();
  });
});

describe('dokończenie #1068: pozostałe akcje', () => {
  const TEMPLATE = '3b2a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const JOB = '5c4b1e5d-3a5f-4d29-8b47-2a8c3d0e9f12';

  it('szablony: nieznany SQLSTATE → INTERNAL + wpis; znany NOT_FOUND → bez wpisu', async () => {
    // Szablony odpowiedzi są wyłączone w trybie ogłoszeniowym (#1211) — zgłaszanie błędów bazy
    // sprawdzamy w trybie RECRUITMENT, w którym akcja dochodzi do RPC.
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    fakeDb.rpc('delete_company_message_template', () => {
      throw pgError('XX000', SECRET_ROW);
    });
    expect(await deleteMessageTemplate(TEMPLATE, COMPANY)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'templates.delete', sqlstate: 'XX000' }]);

    reports.length = 0;
    fakeDb.rpc('delete_company_message_template', () => {
      throw pgError('P0001', 'NOT_FOUND');
    });
    expect(await deleteMessageTemplate(TEMPLATE, COMPANY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(reports).toEqual([]);
  });

  it('zapisane oferty na liście publicznej: awaria odczytu nie jest już cicha', async () => {
    resetFakeDb({ id: USER, role: 'candidate' });
    fakeDb.rows('candidate.public-saved-jobs', () => {
      throw pgError('53300', SECRET_ROW);
    });
    expect(await getPublicSavedJobs([JOB])).toEqual({ status: 'error' });
    expect(reports).toEqual([{ code: 'INTERNAL', area: 'public-saved-jobs.getPublicSavedJobs', sqlstate: '53300' }]);
  });

  it('kontrola ujemna: udany odczyt zapisanych ofert nie zgłasza niczego', async () => {
    resetFakeDb({ id: USER, role: 'candidate' });
    fakeDb.rows('candidate.public-saved-jobs', [{ job_id: JOB }]);
    expect(await getPublicSavedJobs([JOB])).toEqual({ status: 'candidate', savedIds: [JOB] });
    expect(reports).toEqual([]);
  });
});

/**
 * Strażnik źródeł (#1068): w Server Actions żaden blok `catch`, który kończy się błędem dla
 * użytkownika, nie może pominąć kanału błędów, a mapowanie błędu bazy nie może zwracać kodu
 * bez `reportUnmappedDbError` (wzorzec sprzed #1068).
 */
const ACTIONS_DIR = path.join(process.cwd(), 'src/lib/actions');
const REPORTS = /captureError|captureActionError|reportUnmappedDbError|failureCode\(|failure\(|unexpected\(|mapFailure\(|toErrorCode\(|appealFailure\(|throw /;
const FAILS = /'INTERNAL'|status: 'error'|ok: false|'failed'/;
/** Wyjątki (plik albo `plik:linia`) — obecnie brak; `auth.ts` zgłasza błędy przez `failureCode`
 *  (kontynuacja #1068, `auth-error-reporting.test.ts`). Nowy plik akcji nie trafia tu automatycznie. */
const ALLOWED = new Set<string>();
const SILENT_DB_MAPPING = /isDatabaseError\((\w+)\)\)\s*return[^;]*map\w*Error\(databaseErrorMessage\(\1\)\)/;

function silentCatches(file: string, source: string): string[] {
  const found: string[] = [];
  const re = /\}\s*catch\s*(\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(m.index + m[0].length, i - 1);
    const line = source.slice(0, m.index).split('\n').length;
    if (FAILS.test(body) && !REPORTS.test(body) && !ALLOWED.has(file) && !ALLOWED.has(`${file}:${line}`)) {
      found.push(`${file}:${line}`);
    }
    if (SILENT_DB_MAPPING.test(body)) found.push(`${file}:${line} (mapowanie bez reportUnmappedDbError)`);
  }
  return found;
}

describe('strażnik: Server Actions bez cichych błędów (#1068)', () => {
  it('żaden plik akcji nie ma cichego catch ani mapowania bazy bez zgłoszenia', () => {
    const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.flatMap((f) => silentCatches(f, readFileSync(path.join(ACTIONS_DIR, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('kontrole ujemne: wzorce sprzed #1068 są wykrywane', () => {
    expect(silentCatches('x.ts', "try { a(); } catch {\n  return { status: 'error' };\n}")).toEqual(['x.ts:1']);
    expect(
      silentCatches(
        'y.ts',
        "try { a(); } catch (error) {\n  if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };\n  captureError(error, { area: 'y' });\n  return { ok: false, error: 'INTERNAL' };\n}",
      ),
    ).toEqual(['y.ts:1 (mapowanie bez reportUnmappedDbError)']);
    expect(silentCatches('z.ts', "try { a(); } catch (e) {\n  captureActionError(e, 'z');\n  return { status: 'error' };\n}")).toEqual([]);
    // Wzorzec akcji kont sprzed zdjęcia wyjątku `auth.ts`: kod z `mapAuthError` bez zgłoszenia.
    expect(
      silentCatches('auth.ts', "try { a(); } catch (e) {\n  return { ok: false, error: isAppError(e) ? e.code : 'INTERNAL' };\n}"),
    ).toEqual(['auth.ts:1']);
  });
});
