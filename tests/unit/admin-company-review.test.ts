import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { setCompanyStatus } from '@/lib/actions/admin';
import { COMPANY_REASON_MAX, companyReasonError } from '@/lib/admin/company-review';
import { getCompanyDetail } from '@/lib/data/admin';
import { titleKeyForType } from '@/lib/data/notifications';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #310 — decyzja admina o firmie: wymagane uzasadnienie (akcja + reguły wspólne z dialogiem),
 * szczegół firmy (dane, członkowie, oferty), tytuły powiadomień i e-maile do właściciela
 * w JEGO języku (Invariant #1 — locale z wiersza kolejki, nie z sesji admina).
 */

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isSupabaseConfigured: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const COMPANY_ID = '0b9a9c0e-5f4e-4c1a-9d52-6f1f3c1d2e01';

type Result = { data?: unknown; error?: unknown; count?: number | null };

/** Łańcuch zapytania Supabase: filtry zwracają siebie; `await`/`maybeSingle` dają wynik. */
function chain(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'eq', 'in', 'or', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

/** Sesja pod RLS: getUser + rola z profilu + `rpc` (akcja zapisu). */
function mockSession(role: string | null, rpcResult: { error: unknown } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn(() => chain({ data: role ? { role } : null, error: null })),
    rpc,
  } as never);
  return rpc;
}

function mockAdminTables(byTable: Record<string, Result>) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      const result = byTable[table];
      if (!result) throw new Error(`unexpected table ${table}`);
      return chain(result);
    }),
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('#310 reguły uzasadnienia (dialog i akcja)', () => {
  it('odrzucenie i zawieszenie wymagają niepustego powodu, weryfikacja nie', () => {
    expect(companyReasonError('rejected', '')).toBe('required');
    expect(companyReasonError('suspended', '   ')).toBe('required');
    expect(companyReasonError('rejected', 'VAT')).toBeNull();
    expect(companyReasonError('verified', null)).toBeNull();
  });

  it('limit długości zgodny z CHECK w migracji 0085', () => {
    expect(companyReasonError('rejected', 'x'.repeat(COMPANY_REASON_MAX))).toBeNull();
    expect(companyReasonError('rejected', 'x'.repeat(COMPANY_REASON_MAX + 1))).toBe('tooLong');
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/0085_admin_company_review.sql'),
      'utf8',
    );
    expect(sql).toContain(`char_length(status_reason) <= ${COMPANY_REASON_MAX}`);
    expect(sql).toContain(`char_length(v_reason) > ${COMPANY_REASON_MAX}`);
  });
});

describe('#310 setCompanyStatus — uzasadnienie', () => {
  it('kontrola ujemna: brak powodu przy odrzuceniu → błąd pola, bez RPC', async () => {
    const rpc = mockSession('admin');
    expect(await setCompanyStatus(COMPANY_ID, 'rejected', 'pending', '  ')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('za długi powód → błąd pola, bez RPC', async () => {
    const rpc = mockSession('admin');
    const res = await setCompanyStatus(COMPANY_ID, 'suspended', 'verified', 'x'.repeat(1001));
    expect(res).toMatchObject({ ok: false, field: 'reason', reason: 'tooLong' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('przekazuje przycięty powód do RPC; przy weryfikacji powód = null', async () => {
    const rpc = mockSession('admin');
    expect(await setCompanyStatus(COMPANY_ID, 'rejected', 'pending', '  Zły VAT  ')).toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith('admin_set_company_status', {
      p_company_id: COMPANY_ID,
      p_status: 'rejected',
      p_expected_status: 'pending',
      p_reason: 'Zły VAT',
    });

    await setCompanyStatus(COMPANY_ID, 'verified', 'rejected', 'ignorowane');
    expect(rpc).toHaveBeenLastCalledWith(
      'admin_set_company_status',
      expect.objectContaining({ p_status: 'verified', p_reason: null }),
    );
  });

  it('błąd REASON_REQUIRED z bazy → błąd pola (nie surowy komunikat)', async () => {
    mockSession('admin', { error: { message: 'VALIDATION_FAILED: REASON_REQUIRED' } });
    expect(await setCompanyStatus(COMPANY_ID, 'rejected', 'pending', 'x')).toMatchObject({
      ok: false,
      field: 'reason',
      reason: 'required',
    });
  });
});

describe('#310 getCompanyDetail', () => {
  it('dane, uzasadnienie, członkowie i oferty z licznikiem', async () => {
    mockSession('admin');
    mockAdminTables({
      companies: {
        data: {
          id: COMPANY_ID,
          name: 'Acme',
          status: 'rejected',
          status_reason: 'VAT nie zgadza się',
          created_at: '2026-01-01T10:00:00Z',
          verified_at: null,
          vat_number: 'BE0123',
          registration_number: '0123',
          email: 'a@acme.be',
          phone: '+32 1',
          website: null,
          address: 'Straat 1',
          postal_code: '2000',
          city: 'Antwerpen',
          region: null,
          country: 'BE',
          industry: null,
          description: null,
        },
        error: null,
      },
      company_members: {
        data: [
          {
            id: 'm1',
            role: 'owner',
            is_active: true,
            joined_at: null,
            created_at: '2026-01-01T10:00:00Z',
            profiles: { first_name: 'Ann', last_name: 'Peeters', email: 'ann@acme.be' },
          },
          { id: 'm2', role: 'recruiter', is_active: false, created_at: null, profiles: null },
        ],
        error: null,
      },
      jobs: {
        data: [{ id: 'j1', title: 'Magazynier', status: 'active', slug: 'magazynier', created_at: null }],
        error: null,
        count: 27,
      },
    });

    const result = await getCompanyDetail(COMPANY_ID);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.company).toMatchObject({
      name: 'Acme',
      statusReason: 'VAT nie zgadza się',
      vatNumber: 'BE0123',
      postalCode: '2000',
      jobsTotal: 27,
    });
    expect(result.company.members).toEqual([
      { id: 'm1', name: 'Ann Peeters', email: 'ann@acme.be', role: 'owner', isActive: true, since: '2026-01-01T10:00:00Z' },
      { id: 'm2', name: '', email: null, role: 'recruiter', isActive: false, since: null },
    ]);
    expect(result.company.jobs[0]).toMatchObject({ title: 'Magazynier', slug: 'magazynier' });
  });

  it('uzasadnienie ukryte dla firmy zweryfikowanej (stara wartość nie wycieka)', async () => {
    mockSession('admin');
    mockAdminTables({
      companies: { data: { id: COMPANY_ID, name: 'Acme', status: 'verified', status_reason: 'stare' }, error: null },
      company_members: { data: [], error: null },
      jobs: { data: [], error: null, count: 0 },
    });
    const result = await getCompanyDetail(COMPANY_ID);
    expect(result.status === 'ok' && result.company.statusReason).toBeNull();
  });

  it('brak firmy / zły identyfikator → not_found; błąd odczytu → error', async () => {
    mockSession('admin');
    expect(await getCompanyDetail('nie-uuid')).toEqual({ status: 'not_found' });

    mockAdminTables({
      companies: { data: null, error: null },
      company_members: { data: [], error: null },
      jobs: { data: [], error: null, count: 0 },
    });
    expect(await getCompanyDetail(COMPANY_ID)).toEqual({ status: 'not_found' });

    mockAdminTables({
      companies: { data: { id: COMPANY_ID, name: 'Acme', status: 'pending' }, error: null },
      company_members: { data: null, error: { message: 'boom' } },
      jobs: { data: [], error: null, count: 0 },
    });
    expect(await getCompanyDetail(COMPANY_ID)).toEqual({ status: 'error' });
  });

  it('kontrola ujemna: sesja bez roli admina → notFound przed klientem service-role', async () => {
    mockSession('employer');
    await expect(getCompanyDetail(COMPANY_ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe('#310 tytuły powiadomień', () => {
  it('decyzja o firmie wg data.status; nieznany status → fallback typu', () => {
    expect(titleKeyForType('company_verified', { kind: 'company_status', status: 'verified' })).toBe(
      'itemCompanyVerified',
    );
    expect(titleKeyForType('system', { kind: 'company_status', status: 'rejected' })).toBe(
      'itemCompanyRejected',
    );
    expect(titleKeyForType('system', { kind: 'company_status', status: 'suspended' })).toBe(
      'itemCompanySuspended',
    );
    expect(titleKeyForType('system', { kind: 'company_status', status: 'x' })).toBe('itemSystem');
    expect(titleKeyForType('system', null)).toBe('itemSystem');
  });
});

describe('#310 e-maile do właściciela firmy w jego języku', () => {
  const SITE = 'https://pracuj.be';
  const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
  const TEMPLATES = ['companyVerified', 'companyRejected', 'companySuspended'] as const;
  const cases = LOCALES.flatMap((locale) => TEMPLATES.map((template) => ({ locale, template })));

  it.each(cases)('$template / $locale', async ({ locale, template }) => {
    const payload: Record<string, unknown> = { companyName: 'Acme BV' };
    if (template !== 'companyVerified') payload.reason = 'VAT <b>niezgodny</b> z KBO';
    const built = buildDeliveryData({ template, locale, payload }, SITE, 'Ann');
    const { html, subject } = await renderEmail(template, built.locale, built.data as never);

    expect(built.locale).toBe(locale);
    expect(subject).toContain('Acme BV');
    expect(html).toContain(`${SITE}/${locale}/employer/firma`);
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
    if (template !== 'companyVerified') {
      // Uzasadnienie admina jako tekst (escapowany), nie HTML.
      expect(html).toContain('VAT &lt;b&gt;niezgodny&lt;/b&gt; z KBO');
      expect(html).not.toContain('<b>niezgodny</b>');
    }
  });

  it('bez uzasadnienia treść nie odsyła do nieistniejącego powodu', async () => {
    const built = buildDeliveryData(
      { template: 'companyRejected', locale: 'pl', payload: { companyName: 'Acme' } },
      SITE,
    );
    const { html } = await renderEmail('companyRejected', built.locale, built.data as never);
    expect(html).not.toContain('Powód podajemy poniżej');
    expect(html).toContain('Nie mogliśmy zweryfikować firmy Acme');
  });

  it('locale spoza obsługiwanych → en (fallback Invariantu #1), nie język admina', () => {
    expect(
      buildDeliveryData({ template: 'companyVerified', locale: 'de', payload: {} }, SITE).locale,
    ).toBe('en');
  });
});
