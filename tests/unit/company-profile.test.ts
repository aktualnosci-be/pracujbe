import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompanyProfile } from '@/lib/companies';

/**
 * Profil publiczny firmy (#591, migracja 0156): `null` = firma nie istnieje / nie jest
 * zweryfikowana / usunięta — strona wywołująca renderuje 404, nigdy technikaliów (Invariant #8).
 * Skonfigurowana baza NIGDY nie degraduje po cichu do braku profilu przy błędzie odczytu.
 */

const adapters = vi.hoisted(() => ({
  company: vi.fn(),
  companyJobs: vi.fn(),
  pool: {},
}));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-companies', () => ({
  getPublicCompany: adapters.company,
  getPublicCompanyJobs: adapters.companyJobs,
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('getCompanyProfile', () => {
  it('mapuje firmę i jej oferty z bazy', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockResolvedValue({
      id: 'c1', slug: 'firma-x', name: 'Firma X', description: 'Opis',
      city: 'Antwerpia', region: 'Flandria', industry: 'logistyka',
      logo_url: 'https://cdn.example.invalid/logo.png',
      website: 'https://firma-x.example.invalid',
      active_jobs_count: 3,
    });
    adapters.companyJobs.mockResolvedValue({
      rows: [{ id: 'j1', slug: 'oferta-1', title: 'Magazynier', company_name: 'Firma X', published_at: '2026-01-01T00:00:00Z' }],
    });

    const result = await getCompanyProfile('firma-x', 'pl');

    expect(adapters.company).toHaveBeenCalledWith(adapters.pool, 'firma-x');
    expect(result).toMatchObject({
      company: {
        id: 'c1', slug: 'firma-x', name: 'Firma X', description: 'Opis',
        city: 'Antwerpia', region: 'Flandria', industry: 'logistyka',
        logoUrl: 'https://cdn.example.invalid/logo.png',
        website: 'https://firma-x.example.invalid',
        activeJobsCount: 3,
      },
      jobs: [{ slug: 'oferta-1', title: 'Magazynier' }],
    });
  });

  it('zły slug / firma niezweryfikowana → null (strona 404), bez błędu', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockResolvedValue(null);
    expect(await getCompanyProfile('nie-taki-slug', 'pl')).toBeNull();
    expect(adapters.companyJobs).not.toHaveBeenCalled();
  });

  it('bez konfiguracji bazy (demo/dev): brak profilu — zestaw demo nie ma prawdziwych firm', async () => {
    expect(await getCompanyProfile('cokolwiek', 'pl')).toBeNull();
    expect(adapters.company).not.toHaveBeenCalled();
  });

  it('produkcja bez konfiguracji bazy: błąd, nie cichy 404 (Invariant #12)', async () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('DATABASE_APP_URL', '');
    await expect(getCompanyProfile('firma-x', 'pl')).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('kontrola ujemna: awaria skonfigurowanej bazy NIE zwraca cicho null (404), tylko błąd', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockRejectedValue(new Error('connection reset'));
    await expect(getCompanyProfile('firma-x', 'pl')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
