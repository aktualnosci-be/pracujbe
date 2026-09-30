import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCompanyDescription } from '@/lib/actions/company';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Zgłoszenie opisu firmy WSKAZANEJ przez `companyId` (#868, 0198): akcja pyta o rolę TYLKO dla
 * `companyId` z formularza, woła wyłącznie RPC `submit_company_description` pod sesją (bez
 * bezpośredniego UPDATE — blokuje go strażnik w bazie) i zwraca wynik RPC. Numer identyfikacyjny
 * w tekście i tekst ponad limit odpadają przed bazą; nieoczekiwany wynik nie udaje sukcesu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from 'next/cache';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function submit(result: unknown | (() => never)) {
  fakeDb.rpc('submit_company_description', typeof result === 'function' ? result : () => result);
}

function membership(role: string, status = 'verified') {
  fakeDb.rows('company.membership-for-company', () => [{ role, status }]);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  membership('owner');
});

describe('company description submission (scoped to companyId, review by admin, 0198)', () => {
  it('rejects an invalid company id before touching the database', async () => {
    expect(await updateCompanyDescription('not-a-uuid', { description: 'Opis' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('rejects a regular member before writing', async () => {
    submit('pending');
    membership('member');
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'Opis' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.callsTo('submit_company_description')).toHaveLength(0);
  });

  it('rejects a company the user is not an active member of (stale form after switching company)', async () => {
    fakeDb.rows('company.membership-for-company', () => []);
    expect(await updateCompanyDescription(OTHER_COMPANY_ID, { description: 'Opis' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(fakeDb.callsTo('submit_company_description')).toHaveLength(0);
  });

  it('a new text goes to the admin queue (outcome pending), scoped to the company from the form', async () => {
    submit('pending');
    expect(await updateCompanyDescription(COMPANY_ID, { description: '  Nowy opis.  ' })).toEqual({
      ok: true,
      outcome: 'pending',
    });
    const [call] = fakeDb.callsTo('submit_company_description');
    expect(call).toMatchObject({ as: USER });
    expect(call?.args).toEqual({ p_company_id: COMPANY_ID, p_description: 'Nowy opis.', p_description_locale: null });
    expect(fakeDb.callsTo('company.membership-for-company')[0]?.values).toEqual([USER, COMPANY_ID]);
  });

  it('an admin of the company may also submit; removal (empty text) is applied immediately', async () => {
    submit('applied');
    membership('admin');
    expect(await updateCompanyDescription(COMPANY_ID, { description: '' })).toEqual({
      ok: true,
      outcome: 'applied',
    });
    expect(fakeDb.callsTo('submit_company_description')[0]?.args).toEqual({
      p_company_id: COMPANY_ID,
      p_description: '',
      p_description_locale: null,
    });
  });

  // 0975 (decyzja właściciela 30.09.2026): język opisu jedzie razem z propozycją.
  it('sends the description language with the proposal (approved together with the text)', async () => {
    submit('pending');
    expect(
      await updateCompanyDescription(COMPANY_ID, { description: 'Nous construisons des ponts.', descriptionLocale: 'fr' }),
    ).toEqual({ ok: true, outcome: 'pending' });
    expect(fakeDb.callsTo('submit_company_description')[0]?.args).toEqual({
      p_company_id: COMPANY_ID,
      p_description: 'Nous construisons des ponts.',
      p_description_locale: 'fr',
    });
    // Propozycja nie zmienia profilu publicznego do decyzji admina.
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).not.toContain('/[locale]/pracodawcy/[slug]');
  });

  it('a language change of the approved text is applied at once and refreshes the public profile', async () => {
    submit('locale_applied');
    expect(
      await updateCompanyDescription(COMPANY_ID, { description: 'Opis', descriptionLocale: 'nl' }),
    ).toEqual({ ok: true, outcome: 'locale_applied' });
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toContain('/[locale]/pracodawcy/[slug]');
  });

  it('negative control: a language outside the site languages is rejected before the database', async () => {
    expect(
      await updateCompanyDescription(COMPANY_ID, {
        description: 'Opis',
        descriptionLocale: 'de' as unknown as 'pl',
      }),
    ).toMatchObject({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('an identification number is rejected at the field before the database', async () => {
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'Kontakt: 85.07.30-033-28' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'description',
      reason: 'sensitive',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('a text over the limit is rejected at the field before the database', async () => {
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'x'.repeat(1501) })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'description',
      reason: 'tooLong',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('maps database rejections to user codes', async () => {
    submit(() => {
      throw pgError('42501', 'PERMISSION_DENIED: opis firmy — tylko owner/admin firmy');
    });
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'Opis' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    submit(() => {
      throw pgError('22023', 'VALIDATION_FAILED: DESCRIPTION_TOO_LONG');
    });
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'Opis' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it('negative control: an unexpected RPC result is not reported as success', async () => {
    submit(null);
    expect(await updateCompanyDescription(COMPANY_ID, { description: 'Opis' })).toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('demo (no database): the demo identifier is not a UUID and does not get NOT_FOUND', async () => {
    fakeSession.configured = false;
    expect(await updateCompanyDescription('demo-company', { description: 'Opis' })).toEqual({
      ok: true,
      demo: true,
      outcome: 'unchanged',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
