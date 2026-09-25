import { describe, expect, it, vi } from 'vitest';

import { setCandidateMinAge } from '@/lib/actions/admin-age-policy';
import { AGE_POLICY_REASON_MAX, agePolicyReasonError } from '@/lib/admin/age-policy';
import { getAgePolicySettings } from '@/lib/data/admin-age-policy';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Panel administratora — próg wieku kandydatów (#492, `/admin/ustawienia`).
 *
 * `setCandidateMinAge` woła RPC `admin_set_candidate_min_age` (0126) pod sesją admina:
 * uzasadnienie ZAWSZE wymagane (jak `admin_set_company_status`), próg tylko 16/18, bez
 * sesji/roli admina → `PERMISSION_DENIED` (egzekwowane w bazie, `is_admin()`), bez env → DEMO
 * bez wywołania bazy. `getAgePolicySettings` odczytuje service-rolem PO potwierdzeniu roli
 * admina (`requireAdmin` → `notFound()` dla innej roli) i buduje „ostatnią zmianę” z
 * `audit_logs` (akcja `age_policy.updated`).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';

describe('reguły uzasadnienia (lustro RPC 0126)', () => {
  it('puste albo za długie uzasadnienie odrzucone', () => {
    expect(agePolicyReasonError('')).toBe('required');
    expect(agePolicyReasonError('   ')).toBe('required');
    expect(agePolicyReasonError('x'.repeat(AGE_POLICY_REASON_MAX))).toBeNull();
    expect(agePolicyReasonError('x'.repeat(AGE_POLICY_REASON_MAX + 1))).toBe('tooLong');
  });
});

describe('setCandidateMinAge', () => {
  it('zły próg (nie 16/18) → VALIDATION_FAILED bez wywołania bazy', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    await expect(setCandidateMinAge(17, true, 'Powód')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('brak uzasadnienia → VALIDATION_FAILED, pole reason, bez wywołania bazy', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    await expect(setCandidateMinAge(18, true, '   ')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('za długie uzasadnienie → VALIDATION_FAILED, pole reason, bez wywołania bazy', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    await expect(setCandidateMinAge(18, true, 'x'.repeat(AGE_POLICY_REASON_MAX + 1))).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'tooLong',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji → PERMISSION_DENIED bez wywołania bazy', async () => {
    resetFakeDb(null);
    await expect(setCandidateMinAge(18, true, 'Decyzja właściciela')).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('KONTROLA UJEMNA: odmowa bazy (nie-admin) → PERMISSION_DENIED, nie ciche powodzenie', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'employer' });
    fakeDb.rpc('admin_set_candidate_min_age', () => {
      throw pgError('P0001', 'PERMISSION_DENIED');
    });
    await expect(setCandidateMinAge(18, true, 'Decyzja właściciela')).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('poprawne wywołanie: RPC pod sesją admina z argumentami, wynik = liczba ukrytych profili', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('admin_set_candidate_min_age', () => 3);
    await expect(setCandidateMinAge(18, true, '  Decyzja właściciela 25.09.2026  ')).resolves.toEqual({
      ok: true,
      hiddenProfiles: 3,
    });
    const [call] = fakeDb.callsTo('admin_set_candidate_min_age');
    expect(call).toMatchObject({
      as: ADMIN_ID,
      args: { p_min_age: 18, p_confirmed: true, p_reason: 'Decyzja właściciela 25.09.2026' },
    });
  });

  it('tryb demo nic nie zapisuje', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeSession.configured = false;
    await expect(setCandidateMinAge(18, true, 'Decyzja właściciela')).resolves.toEqual({
      ok: true,
      demo: true,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('getAgePolicySettings', () => {
  it('bez roli admina → notFound przed odczytem service-role', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'employer' });
    await expect(getAgePolicySettings()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo: wartości startowe z migracji 0126, bez wywołania bazy', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeSession.configured = false;
    await expect(getAgePolicySettings()).resolves.toMatchObject({
      status: 'ok',
      demo: true,
      minAge: 16,
      confirmed: true,
      lastChange: null,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('próg + ostatnia zmiana z dziennika (aktor po nazwie)', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb
      .rows('admin.age-policy', [
        {
          candidate_min_age: 18,
          confirmed: true,
          reason: 'Decyzja właściciela',
          updated_at: '2026-09-25T10:00:00.000000+00:00',
          updated_by: ADMIN_ID,
        },
      ])
      .rows('admin.age-policy-last-change', [
        {
          actor_id: ADMIN_ID,
          before_data: { candidate_min_age: 16, confirmed: true },
          after_data: {
            candidate_min_age: 18,
            confirmed: true,
            reason: 'Decyzja właściciela',
            hidden_profiles: 5,
          },
          created_at: '2026-09-25T10:00:00.000000+00:00',
        },
      ])
      .rows('admin.age-policy-actor', [{ first_name: 'Anna', last_name: 'Adminowa', email: 'a@example.test' }]);

    const result = await getAgePolicySettings();
    expect(result).toMatchObject({
      status: 'ok',
      demo: false,
      minAge: 18,
      confirmed: true,
      reason: 'Decyzja właściciela',
      updatedByName: 'Anna Adminowa',
      lastChange: {
        actorName: 'Anna Adminowa',
        beforeMinAge: 16,
        afterMinAge: 18,
        beforeConfirmed: true,
        afterConfirmed: true,
        reason: 'Decyzja właściciela',
        hiddenProfiles: 5,
      },
    });
  });

  it('brak wiersza w age_policy i brak wpisu w dzienniku → wartość awaryjna 18, bez zmiany', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rows('admin.age-policy', []).rows('admin.age-policy-last-change', []);
    await expect(getAgePolicySettings()).resolves.toMatchObject({
      status: 'ok',
      demo: false,
      minAge: 18,
      confirmed: false,
      lastChange: null,
    });
  });

  it('KONTROLA UJEMNA: błąd odczytu → status error (nigdy dane częściowe)', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rows('admin.age-policy', () => {
      throw pgError('P0001', 'INTERNAL');
    });
    await expect(getAgePolicySettings()).resolves.toEqual({ status: 'error' });
  });
});
