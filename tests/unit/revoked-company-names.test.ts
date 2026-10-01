import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

import { getRevokedCompanyNames } from '@/lib/data/revoked-company-access';

/**
 * #1210: nazwy firm z odebranym dostępem — pula service_role, identyfikator z argumentu (sesji),
 * tylko nieaktywne członkostwa nieusuniętych firm, gdy nie ma żadnego aktywnego. Awaria = [].
 */
const ID = '00000000-0000-4000-8000-0000000000e1';

beforeEach(() => resetFakeDb(null));

describe('getRevokedCompanyNames', () => {
  it('czyta service-rolem tylko nazwę, filtr nieaktywnych + brak aktywnych; duplikaty i puste pomija', async () => {
    fakeDb.rows('employer.revoked-company-names', [{ name: 'Acme BV' }, { name: ' Acme BV ' }, { name: '' }, { name: 'Beta' }]);
    expect(await getRevokedCompanyNames(ID)).toEqual(['Acme BV', 'Beta']);
    const call = fakeDb.callsTo('employer.revoked-company-names')[0]!;
    expect(call.as).toBe('service');
    expect(call.values).toEqual([ID]);
    expect(call.text).toMatch(/cm\.is_active = false/);
    expect(call.text).toMatch(/NOT EXISTS[\s\S]*a\.is_active = true/);
    expect(call.text).toMatch(/deleted_at IS NULL/);
    expect(call.text).not.toMatch(/SELECT c\.\*/);
  });

  it('awaria bazy → pusta lista (komunikat ogólny), nie wyjątek', async () => {
    fakeDb.rows('employer.revoked-company-names', () => {
      throw new Error('boom');
    });
    expect(await getRevokedCompanyNames(ID)).toEqual([]);
  });
});
