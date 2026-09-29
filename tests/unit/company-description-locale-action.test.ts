import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { updateCompanyDescriptionLocale } from '@/lib/actions/company-description-locale';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Język opisu firmy (#708, migracja 0975): akcja sprawdza rolę TYLKO dla `companyId` z formularza
 * (#801), woła RPC `set_company_description_locale` pod sesją, odrzuca kod spoza języków serwisu
 * przed bazą i mapuje `DESCRIPTION_EMPTY` na błąd przy polu. Profil publiczny (ISR) odświeżany
 * tylko przy realnej zmianie.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

function membership(role: string, current: string | null = null) {
  fakeDb.rows('company.description-locale-membership', () => [{ role, description_locale: current }]);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe('updateCompanyDescriptionLocale', () => {
  it('owner zapisuje język → RPC z kodem, odświeżenie profilu publicznego', async () => {
    membership('owner');
    fakeDb.rpc('set_company_description_locale', ({ args }: { args: Record<string, unknown> }) => args['p_locale']);
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'nl')).toEqual({ ok: true, outcome: 'saved' });
    expect(fakeDb.callsTo('company.description-locale-membership')[0]).toMatchObject({ as: USER, values: [USER, COMPANY_ID] });
    expect(fakeDb.callsTo('set_company_description_locale')[0]?.args).toEqual({ p_company_id: COMPANY_ID, p_locale: 'nl' });
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/pracodawcy/[slug]', 'page');
  });

  it('ta sama wartość → unchanged, bez odświeżania profilu publicznego', async () => {
    membership('admin', 'fr');
    fakeDb.rpc('set_company_description_locale', 'fr');
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'fr')).toEqual({ ok: true, outcome: 'unchanged' });
    expect(revalidatePath).not.toHaveBeenCalledWith('/[locale]/pracodawcy/[slug]', 'page');
  });

  it('pusty wybór = wyczyszczenie języka (null do RPC)', async () => {
    membership('owner', 'nl');
    fakeDb.rpc('set_company_description_locale', null);
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, '')).toEqual({ ok: true, outcome: 'saved' });
    expect(fakeDb.callsTo('set_company_description_locale')[0]?.args).toEqual({ p_company_id: COMPANY_ID, p_locale: null });
  });

  it('kontrola ujemna: kod spoza języków serwisu odrzucony przed bazą', async () => {
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'de')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kontrola ujemna: member firmy nie zmienia języka (bez RPC)', async () => {
    membership('member');
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'nl')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.callsTo('set_company_description_locale')).toHaveLength(0);
  });

  it('kontrola ujemna: brak członkostwa w firmie z formularza → NOT_FOUND', async () => {
    fakeDb.rows('company.description-locale-membership', () => []);
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'nl')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('firma bez opisu → błąd przy polu (DESCRIPTION_EMPTY)', async () => {
    membership('owner');
    fakeDb.rpc('set_company_description_locale', () => {
      throw pgError('22023', 'VALIDATION_FAILED: DESCRIPTION_EMPTY');
    });
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'nl')).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'descriptionEmpty',
    });
  });

  it('bez konfiguracji bazy (demo) → sukces demo bez zapisu', async () => {
    fakeSession.configured = false;
    expect(await updateCompanyDescriptionLocale(COMPANY_ID, 'nl')).toEqual({ ok: true, demo: true, outcome: 'unchanged' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
