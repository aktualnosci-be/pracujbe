import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCompanyVies } from '@/lib/actions/admin';
import { captureError } from '@/lib/error-report';
import {
  formatBelgianVat,
  hasValidBelgianChecksum,
  parseBelgianVat,
} from '@/lib/vies/belgian-vat';
import {
  VIES_ENDPOINT,
  checkBelgianVatInVies,
  interpretViesResponse,
  type ViesCheckResult,
} from '@/lib/vies/client';
import { compareCompanyNames } from '@/lib/vies/name-match';
import { buildViesState, companyVatSource } from '@/lib/vies/state';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #92 — weryfikacja belgijskich firm w VIES bez fałszywych ostrzeżeń.
 *
 * Wszystkie odpowiedzi VIES to fixture'y (mock `fetch`) — w zwykłych testach nie ma
 * żadnego zapytania sieciowego. Jedyny test na żywo jest opt-in (`VIES_LIVE_SMOKE=1`).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const VALID = '0417497106';
const CHECKED_AT = '2026-09-24T10:00:00.000Z';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* ---------------------------------------------------------------------------
 * Fixture'y odpowiedzi VIES (REST `check-vat-number`)
 * ------------------------------------------------------------------------- */

const VALID_BODY = {
  countryCode: 'BE',
  vatNumber: VALID,
  requestDate: '2026-09-24T10:00:00.000Z',
  valid: true,
  name: 'NV  ANHEUSER-BUSCH INBEV ',
  address: 'Grote Markt 1\n1000 Brussel',
};
const INVALID_BODY = {
  countryCode: 'BE',
  vatNumber: VALID,
  requestDate: '2026-09-24+02:00',
  valid: false,
  name: '---',
  address: '---',
};

/** Odpowiedzi infrastruktury: każda oznacza WYŁĄCZNIE brak możliwości weryfikacji. */
const INFRA_FIXTURES: Array<{ name: string; status: number; body: unknown; expected: string }> = [
  { name: 'HTTP 429', status: 429, body: null, expected: 'rate_limited' },
  { name: 'HTTP 500', status: 500, body: null, expected: 'unavailable' },
  { name: 'HTTP 502 z HTML', status: 502, body: '<html>Bad gateway</html>', expected: 'unavailable' },
  { name: 'HTTP 503', status: 503, body: { valid: false }, expected: 'unavailable' },
  { name: 'HTTP 400', status: 400, body: { valid: false }, expected: 'unavailable' },
  {
    name: 'actionSucceed:false bez kodu',
    status: 200,
    body: { actionSucceed: false, valid: false },
    expected: 'unavailable',
  },
  {
    name: 'actionSucceed:false MS_MAX_CONCURRENT_REQ',
    status: 200,
    body: { actionSucceed: false, errorWrappers: [{ error: 'MS_MAX_CONCURRENT_REQ' }] },
    expected: 'rate_limited',
  },
  {
    name: 'errorWrappers GLOBAL_MAX_CONCURRENT_REQ',
    status: 200,
    body: { errorWrappers: [{ error: 'GLOBAL_MAX_CONCURRENT_REQ', message: 'x' }], valid: false },
    expected: 'rate_limited',
  },
  {
    name: 'HTTP 500 z MS_MAX_CONCURRENT_REQ',
    status: 500,
    body: { actionSucceed: false, errorWrappers: [{ error: 'MS_MAX_CONCURRENT_REQ' }] },
    expected: 'rate_limited',
  },
  {
    name: 'errorWrappers SERVICE_UNAVAILABLE',
    status: 200,
    body: { actionSucceed: false, errorWrappers: [{ error: 'SERVICE_UNAVAILABLE' }] },
    expected: 'unavailable',
  },
  {
    name: 'errorWrappers MS_UNAVAILABLE',
    status: 200,
    body: { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] },
    expected: 'unavailable',
  },
  {
    name: 'errorWrappers TIMEOUT',
    status: 200,
    body: { actionSucceed: false, errorWrappers: [{ error: 'TIMEOUT' }] },
    expected: 'unavailable',
  },
  {
    name: 'valid:false + userError MS_UNAVAILABLE',
    status: 200,
    body: { countryCode: 'BE', valid: false, userError: 'MS_UNAVAILABLE' },
    expected: 'unavailable',
  },
  {
    name: 'isValid:false + userError MS_MAX_CONCURRENT_REQ',
    status: 200,
    body: { isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' },
    expected: 'rate_limited',
  },
  {
    name: 'sprzeczne: valid:false + userError VALID',
    status: 200,
    body: { valid: false, userError: 'VALID' },
    expected: 'unavailable',
  },
  { name: 'brak pola valid', status: 200, body: { countryCode: 'BE' }, expected: 'unavailable' },
  { name: 'odpowiedź innego kraju', status: 200, body: { countryCode: 'NL', valid: false }, expected: 'unavailable' },
  { name: 'pusta treść', status: 200, body: null, expected: 'unavailable' },
];

describe('#92 numer belgijski — normalizacja, format, suma kontrolna', () => {
  it('akceptuje typowe zapisy i normalizuje do 10 cyfr', () => {
    for (const raw of [
      'BE0417497106',
      'be 0417.497.106',
      'BE0417-497-106',
      '0417.497.106',
      '0417 497 106',
      '417497106', // stary zapis 9-cyfrowy
      'BE417497106',
    ]) {
      expect(parseBelgianVat(raw)).toEqual({ ok: true, number: VALID });
    }
    expect(parseBelgianVat('1000000062')).toEqual({ ok: false, reason: 'checksum' });
    expect(formatBelgianVat(VALID)).toBe('BE0417.497.106');
  });

  it('suma kontrolna mod 97: poprawne numery przechodzą, zmiana jednej cyfry nie', () => {
    for (const n of ['0417497106', '0203201340', '0403170701', '0123456749', '0477472701']) {
      expect(hasValidBelgianChecksum(n)).toBe(true);
    }
    expect(hasValidBelgianChecksum('0417497107')).toBe(false);
    expect(hasValidBelgianChecksum('0417497116')).toBe(false);
    expect(hasValidBelgianChecksum('0123456789')).toBe(false);
  });

  it('odrzuca pusty, obcy kraj, złą długość, pierwszą cyfrę spoza 0/1 i złą sumę', () => {
    expect(parseBelgianVat('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseBelgianVat(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseBelgianVat('NL123456789B01')).toEqual({ ok: false, reason: 'not_belgian' });
    expect(parseBelgianVat('BE04174971')).toEqual({ ok: false, reason: 'length' });
    expect(parseBelgianVat('BE04174971060')).toEqual({ ok: false, reason: 'length' });
    expect(parseBelgianVat('2417497106')).toEqual({ ok: false, reason: 'length' });
    expect(parseBelgianVat('BE04A7497106')).toEqual({ ok: false, reason: 'length' });
    expect(parseBelgianVat('BE0123456789')).toEqual({ ok: false, reason: 'checksum' });
  });
});

describe('#92 interpretacja odpowiedzi VIES (fixture)', () => {
  it('valid → ważny z nazwą i datą zapytania', () => {
    expect(interpretViesResponse(VALID, 200, VALID_BODY, CHECKED_AT)).toEqual({
      status: 'valid',
      vatNumber: VALID,
      name: 'NV ANHEUSER-BUSCH INBEV',
      requestDate: '2026-09-24',
      checkedAt: CHECKED_AT,
    });
  });

  it('invalid → nieważny tylko przy jawnym valid:false w poprawnej odpowiedzi', () => {
    expect(interpretViesResponse(VALID, 200, INVALID_BODY, CHECKED_AT)).toEqual({
      status: 'invalid',
      vatNumber: VALID,
      requestDate: '2026-09-24',
      checkedAt: CHECKED_AT,
    });
    expect(
      interpretViesResponse(VALID, 200, { ...INVALID_BODY, userError: 'INVALID' }, CHECKED_AT)
        .status,
    ).toBe('invalid');
  });

  it('nazwa „---” (nieudostępniona) → null', () => {
    const r = interpretViesResponse(VALID, 200, { ...VALID_BODY, name: '---' }, CHECKED_AT);
    expect(r).toMatchObject({ status: 'valid', name: null });
  });

  for (const f of INFRA_FIXTURES) {
    it(`${f.name} → ${f.expected} (nigdy „nieważny”)`, () => {
      const r = interpretViesResponse(VALID, f.status, f.body, CHECKED_AT);
      expect(r.status).toBe(f.expected);
      expect(r.status).not.toBe('invalid');
    });
  }

  it('kontrola ujemna: naiwna interpretacja „nie valid = nieważny” oznaczyłaby awarie jako nieważne', () => {
    // Dowód, że fixture'y rozróżniają poprawną implementację od błędnej.
    const naive = (status: number, body: unknown) =>
      status === 200 && (body as { valid?: unknown } | null)?.valid === true ? 'valid' : 'invalid';
    const falseWarnings = INFRA_FIXTURES.filter((f) => naive(f.status, f.body) === 'invalid');
    expect(falseWarnings.length).toBe(INFRA_FIXTURES.length);
  });
});

describe('#92 adapter VIES — timeout, ponowienia, bez zapytań dla złego formatu', () => {
  it('zły format / suma kontrolna → brak zapytania do VIES', async () => {
    const fetchMock = vi.fn();
    await expect(checkBelgianVatInVies('BE0123456789', { fetch: fetchMock })).resolves.toEqual({
      status: 'format_invalid',
      reason: 'checksum',
    });
    await expect(checkBelgianVatInVies('DE123456789', { fetch: fetchMock })).resolves.toEqual({
      status: 'format_invalid',
      reason: 'not_belgian',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wysyła znormalizowany numer do endpointu VIES metodą POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_BODY));
    const r = await checkBelgianVatInVies('BE 0417.497.106', {
      fetch: fetchMock,
      now: () => new Date(CHECKED_AT),
    });
    expect(r.status).toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(VIES_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ countryCode: 'BE', vatNumber: VALID });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout: zawieszone zapytanie jest przerywane → unavailable/timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const started = Date.now();
    const r = await checkBelgianVatInVies(VALID, {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
      attempts: 2,
      sleep: () => Promise.resolve(),
    });
    expect(r).toEqual({ status: 'unavailable', vatNumber: VALID, reason: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('błąd sieci → unavailable/network, nie wyjątek', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const r = await checkBelgianVatInVies(VALID, {
      fetch: fetchMock,
      attempts: 1,
    });
    expect(r).toEqual({ status: 'unavailable', vatNumber: VALID, reason: 'network' });
  });

  it('stany przejściowe są ponawiane z backoffem i jitterem, potem sukces', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, null))
      .mockResolvedValueOnce(jsonResponse(429, null))
      .mockResolvedValueOnce(jsonResponse(200, VALID_BODY));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await checkBelgianVatInVies(VALID, {
      fetch: fetchMock,
      sleep,
      random: () => 0.5,
      backoffBaseMs: 100,
    });
    expect(r.status).toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50, 100]);
  });

  it('po wyczerpaniu prób zwraca ostatni stan przejściowy (limit), nie „nieważny”', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            actionSucceed: false,
            errorWrappers: [{ error: 'MS_MAX_CONCURRENT_REQ' }],
          }),
        ),
      );
    const r = await checkBelgianVatInVies(VALID, { fetch: fetchMock, sleep: () => Promise.resolve() });
    expect(r).toEqual({ status: 'rate_limited', vatNumber: VALID });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('wynik rozstrzygający (nieważny) nie jest ponawiany', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, INVALID_BODY));
    const r = await checkBelgianVatInVies(VALID, { fetch: fetchMock });
    expect(r.status).toBe('invalid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('#92 porównanie nazwy i stan w panelu admina', () => {
  it('forma prawna, wielkość liter, diakrytyki i interpunkcja nie dają rozbieżności', () => {
    expect(compareCompanyNames('AGO Jobs & HR', 'AGO JOBS & HR BV')).toBe('match');
    expect(compareCompanyNames('Bouwbedrijf De Vos', 'BV BOUWBEDRIJF DE VOS')).toBe('match');
    expect(compareCompanyNames('Société Générale', 'SA SOCIETE GENERALE')).toBe('match');
    expect(compareCompanyNames('Logistiek Antwerpen NV', 'Logistiek Antwerpen')).toBe('match');
  });

  it('inna nazwa → sygnał do ręcznego sprawdzenia; brak nazwy → unknown', () => {
    expect(compareCompanyNames('CleanPro Services', 'NV TRANSPORT PEETERS')).toBe('mismatch');
    expect(compareCompanyNames('CleanPro Services', null)).toBe('unknown');
    expect(compareCompanyNames('', 'X')).toBe('unknown');
  });

  it('stan: brak numeru, zły format, nie sprawdzono, ważny, nieważny, numer zmieniony', () => {
    const stored = {
      vatNumber: VALID,
      result: 'valid' as const,
      viesName: 'NV LOGISTIEK ANTWERPEN',
      checkedAt: CHECKED_AT,
    };
    expect(buildViesState({ companyName: 'X', vatSource: null, stored: null })).toEqual({
      kind: 'no_vat',
    });
    expect(buildViesState({ companyName: 'X', vatSource: 'BE0123456789', stored: null })).toEqual({
      kind: 'format_invalid',
      reason: 'checksum',
    });
    expect(buildViesState({ companyName: 'X', vatSource: 'BE0417497106', stored: null })).toEqual({
      kind: 'not_checked',
      vatNumber: VALID,
    });
    expect(
      buildViesState({ companyName: 'Logistiek Antwerpen NV', vatSource: 'BE0417.497.106', stored }),
    ).toEqual({
      kind: 'valid',
      vatNumber: VALID,
      checkedAt: CHECKED_AT,
      viesName: 'NV LOGISTIEK ANTWERPEN',
      nameMatch: 'match',
    });
    expect(
      buildViesState({
        companyName: 'X',
        vatSource: 'BE0417497106',
        stored: { ...stored, result: 'invalid', viesName: null },
      }),
    ).toEqual({ kind: 'invalid', vatNumber: VALID, checkedAt: CHECKED_AT });
    expect(buildViesState({ companyName: 'X', vatSource: 'BE0203201340', stored })).toEqual({
      kind: 'stale',
      vatNumber: '0203201340',
      checkedAt: CHECKED_AT,
    });
    expect(
      buildViesState({ companyName: 'X', vatSource: VALID, stored: null, storedLoadFailed: true }),
    ).toEqual({ kind: 'load_error', vatNumber: VALID });
    expect(companyVatSource('  ', '0417.497.106')).toBe('0417.497.106');
  });
});

/* ---------------------------------------------------------------------------
 * Server Action `checkCompanyVies`
 * ------------------------------------------------------------------------- */

const COMPANY_ID = '0b9a9c0e-5f4e-4c1a-9d52-6f1f3c1d2e01';

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';

/** Sesja z rolą + RPC zapisu wyniku (void albo błąd bazy). Zwraca wywołania RPC. */
function mockSession(role: 'admin' | 'employer' | null, rpcError?: string) {
  resetFakeDb(role ? { id: ADMIN_ID, role } : null);
  fakeDb.rpc('admin_record_vies_check', () => {
    if (rpcError) throw pgError('42501', rpcError);
    return null;
  });
  return () => fakeDb.calls.filter((c) => c.kind === 'rpc' || c.kind === 'rpcrows');
}

/** Firma odczytywana przez service_role (po potwierdzeniu roli admina). */
function mockCompany(vat: string | null, name = 'Logistiek Antwerpen NV') {
  fakeDb.rows('admin.vies-company', [{ id: COMPANY_ID, name, vat_number: vat, registration_number: null }]);
}

describe('#92 akcja checkCompanyVies — zapis tylko wyników rozstrzygających', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tryb demo: bez zapytań do VIES i do bazy', async () => {
    fakeSession.configured = false;
    await expect(checkCompanyVies('demo-c3')).resolves.toEqual({ ok: true, demo: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('nie-admin: odmowa zanim cokolwiek trafi do VIES', async () => {
    const rpc = mockSession('employer');
    mockCompany('BE0417497106');
    await expect(checkCompanyVies(COMPANY_ID)).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc()).toHaveLength(0);
    // Odmowa przed odczytem service_role.
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji: odmowa bez odczytu firmy i bez VIES', async () => {
    mockSession(null);
    await expect(checkCompanyVies(COMPANY_ID)).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('firma nieistniejąca/usunięta → NOT_FOUND bez VIES', async () => {
    mockSession('admin');
    fakeDb.rows('admin.vies-company', []);
    await expect(checkCompanyVies(COMPANY_ID)).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(fakeDb.callsTo('admin.vies-company')[0]).toMatchObject({ as: 'service', values: [COMPANY_ID] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('niepoprawne id → VALIDATION_FAILED', async () => {
    await expect(checkCompanyVies('x')).resolves.toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });

  it('ważny: zapis wyniku z nazwą, porównanie nazwy; status firmy bez zmian', async () => {
    const rpc = mockSession('admin');
    mockCompany('BE0417497106', 'Anheuser-Busch InBev');
    fetchMock.mockResolvedValue(jsonResponse(200, VALID_BODY));
    const res = await checkCompanyVies(COMPANY_ID);
    expect(res).toMatchObject({
      ok: true,
      saved: true,
      outcome: { status: 'valid', vatNumber: VALID, nameMatch: 'match' },
    });
    expect(rpc()).toHaveLength(1);
    // Odczyt firmy jako service_role, zapis wyniku pod sesją admina.
    expect(fakeDb.callsTo('admin.vies-company')[0]?.as).toBe('service');
    expect(rpc()[0]).toMatchObject({
      name: 'admin_record_vies_check',
      as: ADMIN_ID,
      args: {
        p_company_id: COMPANY_ID,
        p_vat_number: VALID,
        p_result: 'valid',
        p_vies_name: 'NV ANHEUSER-BUSCH INBEV',
        p_request_date: '2026-09-24',
      },
    });
    expect(fakeDb.callsTo('admin_set_company_status')).toHaveLength(0);
  });

  it('nieważny: zapis „invalid”, ale bez automatycznego odrzucenia firmy', async () => {
    const rpc = mockSession('admin');
    mockCompany('BE0417497106');
    fetchMock.mockResolvedValue(jsonResponse(200, INVALID_BODY));
    const res = await checkCompanyVies(COMPANY_ID);
    expect(res).toMatchObject({ ok: true, saved: true, outcome: { status: 'invalid' } });
    expect(rpc().map((c) => c.name)).toEqual(['admin_record_vies_check']);
    expect(rpc()[0]?.args).toMatchObject({ p_result: 'invalid', p_vies_name: null });
  });

  const infraCases: Array<[string, () => Promise<Response> | never, ViesCheckResult['status']]> = [
    ['503', () => Promise.resolve(jsonResponse(503, null)), 'unavailable'],
    ['429', () => Promise.resolve(jsonResponse(429, null)), 'rate_limited'],
    [
      'MS_UNAVAILABLE',
      () =>
        Promise.resolve(
          jsonResponse(200, { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] }),
        ),
      'unavailable',
    ],
    ['błąd sieci', () => Promise.reject(new TypeError('fetch failed')), 'unavailable'],
  ];
  for (const [label, respond, expected] of infraCases) {
    it(`kontrola ujemna — ${label}: nic nie zapisujemy, firma nigdy nie jest „nieważna”`, async () => {
      const rpc = mockSession('admin');
      mockCompany('BE0417497106');
      fetchMock.mockImplementation(respond);
      const res = await checkCompanyVies(COMPANY_ID);
      expect(res).toMatchObject({ ok: true, saved: false, outcome: { status: expected } });
      expect(rpc()).toHaveLength(0);
    });
  }

  it('zły format: bez zapytania do VIES i bez zapisu', async () => {
    const rpc = mockSession('admin');
    mockCompany('BE0123456789');
    const res = await checkCompanyVies(COMPANY_ID);
    expect(res).toEqual({
      ok: true,
      saved: false,
      outcome: { status: 'format_invalid', reason: 'checksum' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc()).toHaveLength(0);
  });

  it('błąd zapisu: wynik wraca do admina z saved:false, log bez numeru i nazwy', async () => {
    mockSession('admin', 'PERMISSION_DENIED');
    mockCompany('BE0417497106');
    fetchMock.mockResolvedValue(jsonResponse(200, VALID_BODY));
    const res = await checkCompanyVies(COMPANY_ID);
    expect(res).toMatchObject({ ok: true, saved: false, outcome: { status: 'valid' } });
    const logged = JSON.stringify(vi.mocked(captureError).mock.calls, (_k, v) =>
      v instanceof Error ? v.message : v,
    );
    expect(logged).not.toContain(VALID);
    expect(logged).not.toContain('ANHEUSER');
  });
});

describe('#92 kontrakt migracji 0088', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0088_company_vies_checks.sql'),
    'utf8',
  );

  it('zapisuje wyłącznie wyniki rozstrzygające; RPC odrzuca inne stany', () => {
    expect(sql).toMatch(/check \(result in \('valid', 'invalid'\)\)/);
    expect(sql).toMatch(/RESULT_NOT_PERSISTABLE/);
  });

  it('RPC nie zmienia statusu firmy (bez automatycznego odrzucania)', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.admin_record_vies_check'));
    expect(body).not.toMatch(/update public\.companies/i);
  });
});

/** Pojedynczy test na żywo — opt-in, nie jest częścią zwykłego przebiegu ani CI. */
describe.skipIf(process.env.VIES_LIVE_SMOKE !== '1')('#92 VIES live smoke (opt-in)', () => {
  it('prawdziwe zapytanie o znany numer zwraca stan z adaptera', async () => {
    vi.unstubAllGlobals();
    const r = await checkBelgianVatInVies(process.env.VIES_LIVE_VAT ?? 'BE0417497106');
    expect(['valid', 'invalid', 'unavailable', 'rate_limited']).toContain(r.status);
  }, 30_000);
});
