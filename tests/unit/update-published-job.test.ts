import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updatePublishedJob } from '@/lib/actions/jobs';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #325 — akcja `updatePublishedJob`: poprawka aktywnej/wstrzymanej oferty. Egzekwowanie (stan
 * oferty, recruiter+, firma verified, kompletność, CAS) jest w RPC `update_published_job`
 * (rls.sql sekcja RR); tu pilnujemy granicy: walidacja wszystkich kroków PRZED RPC, jedno
 * wywołanie z całą treścią, wersja do CAS bez zmian i kody użytkowe zamiast tekstu bazy.
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER = '22222222-2222-4222-8222-222222222222';
let rpcResult: () => unknown;

function calls() {
  return fakeDb.callsTo('update_published_job');
}

const JOB = '11111111-1111-4111-8111-111111111111';
const VERSION = '2026-09-24T10:00:00.123456+00:00';

function steps(): unknown[] {
  return [
    { title: 'Magazynier – zmiana nocna', category: 'warehouse', occupation: 'Magazynier' },
    { contractType: 'temporary', workingHours: '40 h', shifts: 'noc', startImmediately: false, startDate: '2026-10-15' },
    { city: 'Gandawa', region: 'Flandria', address: '', remote: false },
    { salaryMin: 16, salaryMax: 18, currency: 'EUR', salaryPeriod: 'hour' },
    { description: 'Praca na magazynie w Gandawie, zmiana nocna, stała ekipa.', responsibilities: ['Kompletacja'] },
    { requirementsMandatory: ['Praca w nocy'], mandatorySkills: ['Skaner'], minExperienceYears: 1 },
    {
      requirementsOptional: ['Wózek'],
      skills: ['Excel'],
      languages: [{ language: 'Angielski', level: 'basic' }],
      requiredCertificates: ['VCA'],
      requiresDrivingLicense: false,
      noLanguageRequired: true,
    },
    { conditions: ['Umowa przez agencję'], benefits: ['Dodatek nocny'], accommodation: true, transport: false },
    // Edycja nie wymaga ponownej zgody na publikację (oferta już jest opublikowana).
    { companyDescription: 'Firma A — logistyka w Gandawie.', contactEmail: 'hr@firma-a.be' },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  rpcResult = () => ({ slug: 'magazynier-abc', updated_at: '2026-09-24T10:05:00.5+00:00' });
  fakeDb.rpc('update_published_job', () => rpcResult());
});

describe('updatePublishedJob (#325)', () => {
  it('wysyła całą treść jednym RPC z wersją do CAS i zwraca slug oraz nową wersję', async () => {
    const result = await updatePublishedJob(JOB, steps(), VERSION);

    expect(result).toEqual({ ok: true, slug: 'magazynier-abc', updatedAt: '2026-09-24T10:05:00.5+00:00' });
    expect(calls()).toHaveLength(1);
    const { args, as } = calls()[0]!;
    expect(as).toBe(USER);
    expect(args.p_job_id).toBe(JOB);
    expect(args.p_expected_updated_at).toBe(VERSION);
    expect(JSON.parse(String(args.p_content))).toMatchObject({
      job: {
        title: 'Magazynier – zmiana nocna',
        contract_type: 'temporary',
        start_date: '2026-10-15',
        salary_min: 16,
        salary_period: 'hour',
        address: null,
        no_language_required: true,
        accommodation: true,
        contact_email: 'hr@firma-a.be',
      },
      translation: { responsibilities: ['Kompletacja'], benefits: ['Dodatek nocny'] },
      requirements_mandatory: ['Praca w nocy'],
      requirements_optional: ['Wózek'],
      skills_mandatory: ['Skaner'],
      skills_optional: ['Excel'],
      languages: [{ language: 'Angielski', level: 'basic' }],
      certificates: ['VCA'],
    });
  });

  it('kontrola ujemna: niekompletny krok (brak wymagań obowiązkowych) nie dochodzi do bazy', async () => {
    const invalid = steps();
    invalid[5] = { requirementsMandatory: [], mandatorySkills: [] };
    expect(await updatePublishedJob(JOB, invalid, VERSION)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(calls()).toHaveLength(0);
  });

  it('odrzuca brak kroku, zły identyfikator i zniekształconą wersję przed RPC', async () => {
    expect(await updatePublishedJob(JOB, steps().slice(0, 8), VERSION)).toMatchObject({ ok: false });
    expect(await updatePublishedJob('demo-draft', steps(), VERSION)).toMatchObject({ ok: false });
    expect(await updatePublishedJob(JOB, steps(), 'wczoraj')).toMatchObject({ ok: false });
    expect(calls()).toHaveLength(0);
  });

  it('limit żądań zatrzymuje zapis przed RPC', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await updatePublishedJob(JOB, steps(), VERSION)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(calls()).toHaveLength(0);
  });

  it.each([
    ['JOB_EDIT_CONFLICT: oferta zmieniła się w międzyczasie', 'JOB_EDIT_CONFLICT'],
    ['JOB_NOT_EDITABLE: edytować można ofertę aktywną lub wstrzymaną (stan closed)', 'JOB_NOT_EDITABLE'],
    ['COMPANY_NOT_VERIFIED: firma nie jest zweryfikowana', 'COMPANY_NOT_VERIFIED'],
    ['VALIDATION_FAILED: brak wymagań obowiązkowych', 'VALIDATION_FAILED'],
    ['PERMISSION_DENIED: edycja oferty wymaga roli recruiter+', 'PERMISSION_DENIED'],
  ])('błąd bazy „%s” → kod %s bez tekstu technicznego', async (message, code) => {
    rpcResult = () => {
      throw pgError('P0001', message);
    };
    const result = await updatePublishedJob(JOB, steps(), VERSION);
    expect(result).toEqual({ ok: false, error: code });
    expect(JSON.stringify(result)).not.toContain(message.slice(message.indexOf(':') + 1).trim());
  });

  it('bez zalogowanego użytkownika nie wywołuje RPC', async () => {
    fakeSession.identity = null;
    expect(await updatePublishedJob(JOB, steps(), null)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(calls()).toHaveLength(0);
  });
});
