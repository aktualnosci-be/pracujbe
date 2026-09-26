import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * Automatyczne sprawdzenie VAT w VIES po założeniu firmy (decyzja właściciela 26.09.2026).
 * VIES wyłącznie jako atrapa `fetch`. Kontrole ujemne: awaria VIES / bazy nie blokuje
 * założenia firmy, stan nierozstrzygający nie jest zapisywany, status firmy nie jest ruszany.
 */

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => Promise<void>> }));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => afterTasks.push(task) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { createAdditionalCompany, createCompany } from '@/lib/actions/company';
import { runCompanyViesAutoCheck } from '@/lib/vies/auto-check';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const VAT = '0417497106';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const VALID_BODY = { countryCode: 'BE', vatNumber: VAT, requestDate: '2026-09-26+02:00', valid: true, name: 'NV ACME' };
const INVALID_BODY = { countryCode: 'BE', vatNumber: VAT, requestDate: '2026-09-26+02:00', valid: false, name: '---' };
const fast = { sleep: async () => {}, random: () => 0 };

function source(vat: string | null, kbo: string | null = null): void {
  fakeDb.rows('company.vies-auto-source', [{ vat_number: vat, registration_number: kbo }]);
}
function statusWrites() {
  return fakeDb.calls.filter((c) => /status/.test(c.name) || /admin_set_company_status/.test(c.name));
}

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  resetFakeDb({ id: USER, role: 'employer' });
  fakeDb.rpc('record_company_vies_check_auto', true);
});

describe('runCompanyViesAutoCheck', () => {
  it('ważny numer: zapis przez RPC service_role z wynikiem, nazwą i datą', async () => {
    source('BE 0417.497.106');
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('saved');
    const [call] = fakeDb.callsTo('record_company_vies_check_auto');
    expect(call).toMatchObject({
      as: 'service',
      args: { p_company_id: COMPANY, p_vat_number: VAT, p_result: 'valid', p_vies_name: 'NV ACME' },
    });
    expect(statusWrites()).toHaveLength(0);
  });

  it('nieważny numer: zapis `invalid` bez nazwy; status firmy bez zmian', async () => {
    source(null, '0417497106');
    const fetch = vi.fn(async () => jsonResponse(200, INVALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('saved');
    expect(fakeDb.callsTo('record_company_vies_check_auto')[0]?.args).toMatchObject({ p_result: 'invalid', p_vies_name: null });
    expect(statusWrites()).toHaveLength(0);
  });

  it('istniejący wynik (np. admina) — baza nie nadpisuje, wynik `not_saved`', async () => {
    source(VAT);
    fakeDb.rpc('record_company_vies_check_auto', false);
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('not_saved');
  });

  it('kontrola ujemna: awaria/limit VIES nie jest zapisywana', async () => {
    for (const [status, body] of [[503, { valid: false }], [429, null]] as const) {
      resetFakeDb({ id: USER, role: 'employer' });
      fakeDb.rpc('record_company_vies_check_auto', true);
      source(VAT);
      const fetch = vi.fn(async () => jsonResponse(status, body));
      expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('unavailable');
      expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(0);
    }
    resetFakeDb({ id: USER, role: 'employer' });
    source(VAT);
    const throwing = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch: throwing, ...fast })).toBe('unavailable');
  });

  it('brak numeru / numer spoza BE / zła suma — bez zapytania do VIES', async () => {
    for (const vat of [null, 'DE123456789', 'BE0123456789']) {
      resetFakeDb({ id: USER, role: 'employer' });
      source(vat);
      const fetch = vi.fn();
      expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('skipped');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('błąd bazy przy zapisie — nie rzuca', async () => {
    source(VAT);
    fakeDb.rpc('record_company_vies_check_auto', () => {
      throw new Error('db down');
    });
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('error');
  });
});

describe('zakładanie firmy planuje sprawdzenie po odpowiedzi', () => {
  it('createCompany: sukces zwracany PRZED VIES; potem zapis wyniku', async () => {
    fakeDb.rpc('create_first_company', [{ company_id: COMPANY, created: true }]);
    source(VAT);
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0417497106' })).toEqual({ ok: true, id: COMPANY });
      expect(fetch).not.toHaveBeenCalled();
      expect(afterTasks).toHaveLength(1);
      await afterTasks[0]!();
      expect(fetch).toHaveBeenCalled();
      expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('kontrola ujemna: awaria VIES nie blokuje założenia firmy ani nie zmienia statusu', async () => {
    fakeDb.rpc('create_first_company', [{ company_id: COMPANY, created: true }]);
    source(VAT);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('VIES down');
    }));
    try {
      expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0417497106' })).toEqual({ ok: true, id: COMPANY });
      await expect(afterTasks[0]!()).resolves.toBeUndefined();
      expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(0);
      expect(statusWrites()).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 20_000);

  it('createAdditionalCompany: planuje sprawdzenie nowej firmy', async () => {
    fakeDb.rpc('create_additional_company', [{ company_id: COMPANY }]);
    expect(await createAdditionalCompany({ name: 'Acme Two', vatNumber: 'BE0417497106' })).toEqual({ ok: true, id: COMPANY });
    expect(afterTasks).toHaveLength(1);
  });

  it('nieudane założenie firmy — bez sprawdzenia VIES', async () => {
    fakeDb.rpc('create_first_company', []);
    expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0417497106' })).toEqual({ ok: false, error: 'INTERNAL' });
    expect(afterTasks).toHaveLength(0);
  });
});
