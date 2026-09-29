import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * Automatyczne sprawdzenie VAT w VIES (decyzja właściciela 26.09.2026) z trwałą kolejką w bazie
 * (0976, #706/#879). VIES wyłącznie jako atrapa `fetch`; kolejkę bazy modeluje `queue` niżej
 * (claim / finish / record = te same RPC co w produkcji, reguły sprawdza rls.sql sekcja VQ976).
 * Kontrole ujemne: chwilowa awaria VIES nie jest zapisywana jako wynik, ale NIE gubi zadania;
 * brak zadania = brak zapytania do VIES; sama zmiana nazwy nie planuje sprawdzenia.
 */

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => Promise<void>> }));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => afterTasks.push(task) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { createAdditionalCompany, createCompany, updateCompany } from '@/lib/actions/company';
import {
  processCompanyViesAutoQueue,
  runCompanyViesAutoCheck,
  VIES_AUTO_MAX_ATTEMPTS,
} from '@/lib/vies/auto-check';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const VAT = '0417497106';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const VALID_BODY = { countryCode: 'BE', vatNumber: VAT, requestDate: '2026-09-26+02:00', valid: true, name: 'NV ACME' };
const INVALID_BODY = { countryCode: 'BE', vatNumber: VAT, requestDate: '2026-09-26+02:00', valid: false, name: '---' };
const fast = { sleep: async () => {}, random: () => 0 };

/** Model kolejki 0976: jeden wiersz na firmę, próba liczona przy pobraniu, termin po awarii. */
interface QueueRow {
  vat: string;
  attempts: number;
  due: boolean;
  leased: boolean;
  lastOutcome: string | null;
}
let queue: Map<string, QueueRow>;
let stored: Map<string, { vat: string; result: string }>;

function enqueue(companyId: string, vat: string): void {
  queue.set(companyId, { vat, attempts: 0, due: true, leased: false, lastOutcome: null });
}

type Args = { args: Record<string, unknown> };

function installQueue(): void {
  fakeDb.rpc('claim_company_vies_auto_checks', ({ args }: Args) => {
    const out: Array<{ company_id: string; vat_number: string; attempts: number }> = [];
    for (const [id, row] of queue) {
      if (args['p_company_id'] && args['p_company_id'] !== id) continue;
      if (!row.due || row.leased || row.attempts >= VIES_AUTO_MAX_ATTEMPTS) continue;
      if (out.length >= Number(args['p_limit'])) break;
      row.attempts += 1;
      row.leased = true;
      out.push({ company_id: id, vat_number: row.vat, attempts: row.attempts });
    }
    return out;
  });
  fakeDb.rpc('finish_company_vies_auto_check', ({ args }: Args) => {
    const id = String(args['p_company_id']);
    const row = queue.get(id);
    if (!row || row.vat !== args['p_vat_number']) return false;
    if (args['p_outcome'] === 'done') queue.delete(id);
    else Object.assign(row, { leased: false, due: false, lastOutcome: args['p_outcome'] });
    return true;
  });
  fakeDb.rpc('record_company_vies_check_auto', ({ args }: Args) => {
    const id = String(args['p_company_id']);
    const vat = String(args['p_vat_number']);
    if (stored.get(id)?.vat === vat) return false;
    stored.set(id, { vat, result: String(args['p_result']) });
    // Trigger 0976: wynik dla bieżącego numeru zdejmuje zadanie.
    if (queue.get(id)?.vat === vat) queue.delete(id);
    return true;
  });
}

/** Upływ terminu ponowienia (backoff w bazie). */
function makeDue(): void {
  for (const row of queue.values()) row.due = true;
}

function statusWrites() {
  return fakeDb.calls.filter((c) => /status/.test(c.name) || /admin_set_company_status/.test(c.name));
}

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  resetFakeDb({ id: USER, role: 'employer' });
  queue = new Map();
  stored = new Map();
  installQueue();
});

describe('runCompanyViesAutoCheck', () => {
  it('ważny numer z kolejki: zapis przez RPC service_role z wynikiem, nazwą i datą; zadanie znika', async () => {
    enqueue(COMPANY, VAT);
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('saved');
    const [claim] = fakeDb.callsTo('claim_company_vies_auto_checks');
    expect(claim).toMatchObject({ as: 'service', args: { p_company_id: COMPANY, p_limit: 1 } });
    const [call] = fakeDb.callsTo('record_company_vies_check_auto');
    expect(call).toMatchObject({
      as: 'service',
      args: { p_company_id: COMPANY, p_vat_number: VAT, p_result: 'valid', p_vies_name: 'NV ACME' },
    });
    expect(queue.has(COMPANY)).toBe(false);
    expect(statusWrites()).toHaveLength(0);
  });

  it('nieważny numer: zapis `invalid` bez nazwy; status firmy bez zmian', async () => {
    enqueue(COMPANY, VAT);
    const fetch = vi.fn(async () => jsonResponse(200, INVALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('saved');
    expect(fakeDb.callsTo('record_company_vies_check_auto')[0]?.args).toMatchObject({ p_result: 'invalid', p_vies_name: null });
    expect(statusWrites()).toHaveLength(0);
  });

  it('istniejący wynik dla tego numeru (np. admina) — baza nie nadpisuje; zadanie zamknięte', async () => {
    enqueue(COMPANY, VAT);
    stored.set(COMPANY, { vat: VAT, result: 'valid' });
    const fetch = vi.fn(async () => jsonResponse(200, INVALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('not_saved');
    expect(stored.get(COMPANY)?.result).toBe('valid');
    expect(fakeDb.callsTo('finish_company_vies_auto_check')[0]?.args).toMatchObject({ p_outcome: 'done' });
    expect(queue.has(COMPANY)).toBe(false);
  });

  it('kontrola ujemna: bez zadania w kolejce (brak numeru / już sprawdzony) — bez zapytania do VIES', async () => {
    const fetch = vi.fn();
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
    expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(0);
  });

  it('błąd bazy przy zapisie — nie rzuca, zadanie wraca z terminem ponowienia', async () => {
    enqueue(COMPANY, VAT);
    fakeDb.rpc('record_company_vies_check_auto', () => {
      throw new Error('db down');
    });
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch, ...fast })).toBe('error');
    expect(queue.get(COMPANY)).toMatchObject({ lastOutcome: 'error', leased: false });
  });

  it('błąd pobrania zadania — nie rzuca', async () => {
    fakeDb.rpc('claim_company_vies_auto_checks', () => {
      throw new Error('db down');
    });
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch: vi.fn(), ...fast })).toBe('error');
  });
});

describe('#706: chwilowa niedostępność VIES nie gubi sprawdzenia', () => {
  for (const [label, status, body] of [
    ['503', 503, { valid: false }],
    ['429 (limit)', 429, null],
  ] as const) {
    it(`${label}: brak zapisu wyniku, zadanie zostaje z terminem; późniejszy przebieg zapisuje wynik`, async () => {
      enqueue(COMPANY, VAT);
      const down = vi.fn(async () => jsonResponse(status, body));
      expect(await runCompanyViesAutoCheck(COMPANY, { fetch: down, ...fast })).toBe('unavailable');
      // Kontrola ujemna: awaria nie staje się wynikiem „nieważny”.
      expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(0);
      expect(stored.has(COMPANY)).toBe(false);
      expect(fakeDb.callsTo('finish_company_vies_auto_check')[0]?.args).toMatchObject({
        p_company_id: COMPANY,
        p_vat_number: VAT,
        p_outcome: status === 429 ? 'rate_limited' : 'unavailable',
      });
      expect(queue.get(COMPANY)).toMatchObject({ attempts: 1, leased: false, due: false });

      // Przed terminem ponowienia maintenance niczego nie pobiera.
      const early = vi.fn();
      expect(await processCompanyViesAutoQueue({ fetch: early, ...fast })).toMatchObject({ claimed: 0 });
      expect(early).not.toHaveBeenCalled();

      makeDue();
      const up = vi.fn(async () => jsonResponse(200, VALID_BODY));
      expect(await processCompanyViesAutoQueue({ fetch: up, ...fast })).toEqual({
        claimed: 1, saved: 1, notSaved: 0, skipped: 0, deferred: 0, errors: 0,
      });
      expect(stored.get(COMPANY)).toEqual({ vat: VAT, result: 'valid' });
      expect(queue.has(COMPANY)).toBe(false);
    });
  }

  it('wyjątek sieci: zadanie odroczone, nie zapisane', async () => {
    enqueue(COMPANY, VAT);
    const throwing = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await runCompanyViesAutoCheck(COMPANY, { fetch: throwing, ...fast })).toBe('unavailable');
    expect(stored.has(COMPANY)).toBe(false);
    expect(queue.get(COMPANY)?.lastOutcome).toBe('unavailable');
  });

  it('limit prób: po wyczerpaniu kolejka nie pyta VIES bez końca', async () => {
    enqueue(COMPANY, VAT);
    const down = vi.fn(async () => jsonResponse(503, { valid: false }));
    for (let i = 0; i < VIES_AUTO_MAX_ATTEMPTS; i += 1) {
      makeDue();
      await processCompanyViesAutoQueue({ fetch: down, ...fast });
    }
    const calls = down.mock.calls.length;
    makeDue();
    expect(await processCompanyViesAutoQueue({ fetch: down, ...fast })).toMatchObject({ claimed: 0 });
    expect(down.mock.calls.length).toBe(calls);
    expect(queue.get(COMPANY)?.attempts).toBe(VIES_AUTO_MAX_ATTEMPTS);
  });

  it('maintenance: partia po kolei, liczniki wyników; błąd pobrania rzuca (zadanie maintenance)', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    enqueue(COMPANY, VAT);
    enqueue(OTHER, '0403170701');
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      String(init?.body ?? '').includes('403170701') ? jsonResponse(503, null) : jsonResponse(200, VALID_BODY),
    );
    expect(await processCompanyViesAutoQueue({ fetch, ...fast })).toMatchObject({ claimed: 2, saved: 1, deferred: 1 });
    fakeDb.rpc('claim_company_vies_auto_checks', () => {
      throw new Error('db down');
    });
    await expect(processCompanyViesAutoQueue({ fetch, ...fast })).rejects.toThrow('db down');
  });
});

describe('zapis firmy planuje próbę po odpowiedzi', () => {
  function membership(role = 'owner') {
    fakeDb.rows('company.membership-for-company', () => [{ role, status: 'unverified' }]);
  }

  it('createCompany: sukces zwracany PRZED VIES; potem zapis wyniku', async () => {
    fakeDb.rpc('create_first_company', () => {
      enqueue(COMPANY, VAT); // trigger 0976 na companies
      return [{ company_id: COMPANY, created: true }];
    });
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

  it('kontrola ujemna: awaria VIES nie blokuje założenia firmy ani nie zmienia statusu; zadanie czeka', async () => {
    fakeDb.rpc('create_first_company', () => {
      enqueue(COMPANY, VAT);
      return [{ company_id: COMPANY, created: true }];
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('VIES down');
    }));
    try {
      expect(await createCompany({ name: 'Acme Logistics', vatNumber: 'BE0417497106' })).toEqual({ ok: true, id: COMPANY });
      await expect(afterTasks[0]!()).resolves.toBeUndefined();
      expect(fakeDb.callsTo('record_company_vies_check_auto')).toHaveLength(0);
      expect(statusWrites()).toHaveLength(0);
      expect(queue.get(COMPANY)).toMatchObject({ vat: VAT, lastOutcome: 'unavailable' });
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

  it('#879: firma bez numeru → numer dopisany w edycji → sprawdzenie zaplanowane i wynik zapisany', async () => {
    // Założenie bez numeru: trigger nie tworzy zadania, próba po odpowiedzi nic nie robi.
    fakeDb.rpc('create_first_company', [{ company_id: COMPANY, created: true }]);
    const fetch = vi.fn(async () => jsonResponse(200, VALID_BODY));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await createCompany({ name: 'Acme Logistics' })).toEqual({ ok: true, id: COMPANY });
      await afterTasks[0]!();
      expect(fetch).not.toHaveBeenCalled();

      membership();
      fakeDb.exec('company.update', () => {
        enqueue(COMPANY, VAT); // trigger 0976: nowy prawidłowy numer bez wyniku
        return { rows: [{ id: COMPANY, status: 'unverified' }] };
      });
      expect(await updateCompany(COMPANY, { vatNumber: 'BE 0417.497.106' })).toEqual({ ok: true });
      expect(afterTasks).toHaveLength(2);
      await afterTasks[1]!();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(stored.get(COMPANY)).toEqual({ vat: VAT, result: 'valid' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('kontrola ujemna #879: sama zmiana nazwy nie planuje sprawdzenia VIES', async () => {
    membership();
    fakeDb.exec('company.update', () => ({ rows: [{ id: COMPANY, status: 'unverified' }] }));
    expect(await updateCompany(COMPANY, { name: 'Acme Renamed' })).toEqual({ ok: true });
    expect(afterTasks).toHaveLength(0);
    expect(fakeDb.callsTo('claim_company_vies_auto_checks')).toHaveLength(0);
  });

  it('nieudana edycja (0 wierszy) — bez planowania', async () => {
    membership();
    fakeDb.exec('company.update', () => ({ rows: [] }));
    expect(await updateCompany(COMPANY, { vatNumber: 'BE0417497106' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(afterTasks).toHaveLength(0);
  });
});
