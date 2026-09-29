import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_JOB_FILTERS,
  ADMIN_JOB_FILTER_LABEL,
  adminJobFilterCondition,
  parseAdminJobFilter,
} from '@/lib/admin/job-list-params';
import { ADMIN_PAGE_SIZE, AUDIT_ACTION_KEY, AUDIT_ENTITY_TYPES, decodeAdminCursor } from '@/lib/admin/list-params';
import { listAuditLogs } from '@/lib/data/admin';
import { adminJobPublicPath, listAdminJobs } from '@/lib/data/admin-jobs';
import pl from '@/messages/pl.json';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

/**
 * Lista ofert w panelu admina (`/admin/oferty`): odczyt service-role tylko po potwierdzeniu
 * roli admina, filtr statusu efektywnego, filtr firmy, kursor, publiczny link tylko dla oferty
 * widocznej publicznie, jawny błąd. Plus wpisy dziennika o ofertach (`entity_type = 'job'`).
 */

const ADMIN = { id: '00000000-0000-4000-8000-00000000a001', role: 'admin' } as const;
const COMPANY = '11111111-1111-4111-8111-111111111111';
const PAST = '2020-01-01T00:00:00.000000+00:00';
const FUTURE = '2999-01-01T00:00:00.000000+00:00';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Magazynier',
    status: 'active',
    slug: 'magazynier-gent',
    city: 'Gent',
    created_at: '2026-09-20T10:00:00.123456+00:00',
    published_at: '2026-09-20T11:00:00+00:00',
    expires_at: FUTURE,
    is_demo: false,
    moderated: false,
    company_id: COMPANY,
    company_name: 'Firma A',
    company_status: 'verified',
    company_is_demo: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ ...ADMIN });
});

describe('parametry listy ofert', () => {
  it('nieznany albo brak filtra → wszystkie', () => {
    expect(parseAdminJobFilter(undefined)).toBe('all');
    expect(parseAdminJobFilter('deleted')).toBe('all');
    expect(parseAdminJobFilter("active' OR 1=1")).toBe('all');
    expect(parseAdminJobFilter('moderated')).toBe('moderated');
  });

  it('każdy filtr ma etykietę w pl.json', () => {
    const admin = (pl as { admin: Record<string, string> }).admin;
    for (const filter of ADMIN_JOB_FILTERS) {
      expect(admin[ADMIN_JOB_FILTER_LABEL[filter]], filter).toBeTruthy();
    }
  });

  it('status efektywny: aktywna po terminie należy do „wygasłe”, nie do „aktywne”', () => {
    expect(adminJobFilterCondition('all')).toBeNull();
    expect(adminJobFilterCondition('active')).toContain('j.expires_at > now()');
    expect(adminJobFilterCondition('expired')).toContain("j.status = 'active' AND j.expires_at <= now()");
    expect(adminJobFilterCondition('moderated')).toBe('j.moderation_decision_id IS NOT NULL');
    expect(adminJobFilterCondition('paused')).toBe("j.status = 'paused'");
  });

  it('publiczny link tylko dla oferty widocznej publicznie', () => {
    const base = { status: 'active', slug: 's', companyStatus: 'verified', isDemo: false };
    expect(adminJobPublicPath(base)).toBe('/oferty-pracy/s');
    expect(adminJobPublicPath({ ...base, status: 'expired' })).toBeNull();
    expect(adminJobPublicPath({ ...base, status: 'draft' })).toBeNull();
    expect(adminJobPublicPath({ ...base, companyStatus: 'suspended' })).toBeNull();
    expect(adminJobPublicPath({ ...base, isDemo: true })).toBeNull();
    expect(adminJobPublicPath({ ...base, slug: null })).toBeNull();
  });
});

describe('listAdminJobs — dostęp', () => {
  it('brak sesji → notFound, bez zapytań service-role', async () => {
    fakeSession.identity = null;
    await expect(listAdminJobs()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('pracodawca → notFound, bez zapytań service-role', async () => {
    fakeSession.identity = { id: '00000000-0000-4000-8000-00000000e001', role: 'employer' };
    await expect(listAdminJobs()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('admin → jedno zapytanie service-role bez usuniętych ofert', async () => {
    fakeDb.rows('admin.jobs', []);
    await expect(listAdminJobs()).resolves.toMatchObject({ status: 'ok', rows: [], nextCursor: null, company: null });
    expect(fakeDb.calls.map((c) => [c.name, c.as])).toEqual([['admin.jobs', 'service']]);
    expect(fakeDb.calls[0]!.text).toContain('j.deleted_at IS NULL');
  });

  it('błąd zapytania → jawny błąd, nie pusta lista', async () => {
    fakeDb.rows('admin.jobs', () => {
      throw pgError('XX000', 'boom');
    });
    await expect(listAdminJobs()).resolves.toEqual({ status: 'error' });
  });
});

describe('listAdminJobs — filtry i mapowanie', () => {
  it('fraza, filtr statusu i firmy idą w parametrach, nie w treści SQL', async () => {
    fakeDb.rows('admin.jobs', []).rows('admin.jobs-company', [{ id: COMPANY, name: 'Firma A' }]);
    const result = await listAdminJobs({ status: 'expired', q: 'mag_azyn', company: COMPANY });
    expect(result).toMatchObject({ status: 'ok', company: { id: COMPANY, name: 'Firma A' } });
    const call = fakeDb.callsTo('admin.jobs')[0]!;
    expect(call.text).not.toContain('mag');
    expect(call.text).not.toContain(COMPANY);
    expect(call.text).toContain(adminJobFilterCondition('expired'));
    expect(call.values).toEqual(expect.arrayContaining([COMPANY, '%mag\\_azyn%', ADMIN_PAGE_SIZE + 1]));
  });

  it('zły UUID firmy = brak filtra firmy (bez drugiego zapytania)', async () => {
    fakeDb.rows('admin.jobs', []);
    await listAdminJobs({ company: 'demo-c1' });
    expect(fakeDb.callsTo('admin.jobs-company')).toHaveLength(0);
    expect(fakeDb.callsTo('admin.jobs')[0]!.text).not.toContain('j.company_id = $');
  });

  it('aktywna po terminie = wygasła i bez publicznego linku; blokada moderacyjna widoczna', async () => {
    fakeDb.rows('admin.jobs', [
      jobRow(),
      jobRow({ id: '33333333-3333-4333-8333-333333333333', expires_at: PAST, moderated: true }),
      jobRow({ id: '44444444-4444-4444-8444-444444444444', company_is_demo: true }),
    ]);
    const result = await listAdminJobs();
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows[0]).toMatchObject({ status: 'active', publicPath: '/oferty-pracy/magazynier-gent', moderated: false });
    expect(result.rows[1]).toMatchObject({ status: 'expired', publicPath: null, moderated: true });
    expect(result.rows[2]).toMatchObject({ isDemo: true, publicPath: null });
  });

  it('kursor następnej strony = ostatni pokazany wiersz (pełna precyzja czasu)', async () => {
    const rows = Array.from({ length: ADMIN_PAGE_SIZE + 1 }, (_, i) =>
      jobRow({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        created_at: `2026-09-20T10:00:00.${String(999999 - i).padStart(6, '0')}+00:00`,
      }),
    );
    fakeDb.rows('admin.jobs', rows);
    const result = await listAdminJobs();
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows).toHaveLength(ADMIN_PAGE_SIZE);
    const last = rows[ADMIN_PAGE_SIZE - 1]!;
    expect(decodeAdminCursor(result.nextCursor)).toEqual({ createdAt: last.created_at, id: last.id });

    fakeDb.rows('admin.jobs', []);
    await listAdminJobs({ cursor: result.nextCursor });
    const next = fakeDb.callsTo('admin.jobs')[1]!;
    expect(next.text).toContain('(j.created_at, j.id) <');
    expect(next.values).toEqual(expect.arrayContaining([last.created_at, last.id]));
  });

  it('tryb demo: bez zapytań, dane oznaczone jako demo, filtr firmy działa', async () => {
    fakeSession.configured = false;
    const all = await listAdminJobs();
    if (all.status !== 'ok') throw new Error('expected ok');
    expect(all.rows.length).toBeGreaterThan(0);
    expect(all.rows.every((row) => row.isDemo && row.publicPath === null)).toBe(true);
    const moderated = await listAdminJobs({ status: 'moderated' });
    expect(moderated.status === 'ok' && moderated.rows.every((row) => row.moderated)).toBe(true);
    const one = await listAdminJobs({ company: 'demo-c1' });
    expect(one.status === 'ok' && one.company?.id).toBe('demo-c1');
    expect(one.status === 'ok' && one.rows.every((row) => row.companyId === 'demo-c1')).toBe(true);
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('dziennik zdarzeń — wpisy o ofertach', () => {
  it('typ obiektu `job` i akcje ofert mają etykiety', () => {
    const admin = (pl as { admin: Record<string, string> }).admin;
    expect(AUDIT_ENTITY_TYPES).toContain('job');
    for (const action of ['job.update_published', 'job.duplicated', 'job.deleted']) {
      expect(admin[AUDIT_ACTION_KEY[action]!], action).toBeTruthy();
    }
  });

  it('wpis o ofercie linkuje do listy ofert wyszukanej po identyfikatorze', async () => {
    const jobId = '55555555-5555-4555-8555-555555555555';
    fakeDb.rows('admin.audit-logs', [
      {
        id: '66666666-6666-4666-8666-666666666666',
        actor_id: null,
        action: 'job.update_published',
        entity_type: 'job',
        entity_id: jobId,
        before_data: null,
        after_data: null,
        created_at: '2026-09-20T10:00:00+00:00',
      },
    ]);
    fakeDb.rows('admin.audit-actors', []);
    const result = await listAuditLogs({ entity: 'job' });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.rows[0]!.entityHref).toEqual({ pathname: '/admin/oferty', query: { q: jobId } });
  });
});
