import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPANY_JOBS_PAGE_SIZE,
  companyJobsLastPage,
  companyProfilePath,
  getCompanyProfile,
  parseCompanyJobsPageSegment,
} from '@/lib/companies';

/**
 * Profil publiczny firmy (#591, migracja 0140): `null` = firma nie istnieje / nie jest
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

  it('#708: język opisu z bazy — tylko obsługiwany kod przy niepustym opisie', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.companyJobs.mockResolvedValue({ rows: [] });
    const base = { id: 'c1', slug: 'firma-x', name: 'Firma X', description: 'Opis', active_jobs_count: 0 };
    adapters.company.mockResolvedValue({ ...base, description_locale: 'nl' });
    expect((await getCompanyProfile('firma-x', 'pl'))?.company.descriptionLocale).toBe('nl');
    // Kontrole ujemne: kod spoza języków serwisu, brak wartości, pusty opis → brak języka.
    for (const row of [
      { ...base, description_locale: 'de' },
      { ...base, description_locale: null },
      { ...base, description: '', description_locale: 'nl' },
    ]) {
      adapters.company.mockResolvedValue(row);
      expect((await getCompanyProfile('firma-x', 'pl'))?.company).not.toHaveProperty('descriptionLocale');
    }
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

/**
 * Stronicowanie ofert profilu (#638): dawniej profil brał tylko pierwsze 50 ofert
 * (`p_offset = 0`) bez informacji o obcięciu — oferty od 51. były nieosiągalne z profilu.
 */
describe('getCompanyProfile — strony ofert (#638)', () => {
  function companyWith(count: number) {
    return { id: 'c1', slug: 'firma-x', name: 'Firma X', description: '', active_jobs_count: count };
  }
  function rows(from: number, to: number) {
    return Array.from({ length: to - from }, (_, index) => ({
      id: `j${from + index}`, slug: `oferta-${from + index}`, title: 'Magazynier', company_name: 'Firma X',
      published_at: '2026-01-01T00:00:00Z',
    }));
  }

  it('51 ofert: strona 1 = 50, strona 2 = oferta 51 (offset 50), każda osiągalna', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockResolvedValue(companyWith(51));
    adapters.companyJobs.mockImplementation(async (_pool, _slug, _locale, limit: number, offset: number) => ({
      rows: rows(offset, Math.min(offset + limit, 51)),
    }));

    const first = await getCompanyProfile('firma-x', 'pl');
    const second = await getCompanyProfile('firma-x', 'pl', 2);

    expect(adapters.companyJobs).toHaveBeenNthCalledWith(1, adapters.pool, 'firma-x', 'pl', COMPANY_JOBS_PAGE_SIZE, 0);
    expect(adapters.companyJobs).toHaveBeenNthCalledWith(2, adapters.pool, 'firma-x', 'pl', COMPANY_JOBS_PAGE_SIZE, 50);
    expect(first).toMatchObject({ page: 1, lastPage: 2, pageSize: 50 });
    expect(second).toMatchObject({ page: 2, lastPage: 2 });
    const slugs = [...first!.jobs, ...second!.jobs].map((job) => job.slug);
    expect(slugs).toHaveLength(51);
    expect(new Set(slugs).size).toBe(51);
    expect(slugs.at(-1)).toBe('oferta-50');
  });

  it('kontrola ujemna: strona za ostatnią = null (404) bez zapytania o oferty', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockResolvedValue(companyWith(51));
    expect(await getCompanyProfile('firma-x', 'pl', 3)).toBeNull();
    expect(await getCompanyProfile('firma-x', 'pl', 0)).toBeNull();
    expect(await getCompanyProfile('firma-x', 'pl', 1.5)).toBeNull();
    expect(adapters.companyJobs).not.toHaveBeenCalled();
  });

  it('firma bez ofert: strona 1 istnieje (pusta lista), strona 2 nie', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    adapters.company.mockResolvedValue(companyWith(0));
    adapters.companyJobs.mockResolvedValue({ rows: [] });
    expect(await getCompanyProfile('firma-x', 'pl')).toMatchObject({ jobs: [], page: 1, lastPage: 1 });
    expect(await getCompanyProfile('firma-x', 'pl', 2)).toBeNull();
  });
});

describe('pomocnicze stronicowania profilu (#638)', () => {
  it('ostatnia strona: ceil(count / 50), minimum 1, przycięta do offsetu 10 000 z RPC', () => {
    expect(companyJobsLastPage(0)).toBe(1);
    expect(companyJobsLastPage(50)).toBe(1);
    expect(companyJobsLastPage(51)).toBe(2);
    expect(companyJobsLastPage(1_000_000)).toBe(201);
    expect(companyJobsLastPage(5, 2)).toBe(3);
  });

  it('segment strony: tylko kanoniczne n ≥ 2', () => {
    expect(parseCompanyJobsPageSegment('2')).toBe(2);
    expect(parseCompanyJobsPageSegment('201')).toBe(201);
    for (const raw of ['1', '0', '01', '-2', '2.0', '1e1', 'x', '', '9999999']) {
      expect(parseCompanyJobsPageSegment(raw)).toBeNull();
    }
  });

  it('ścieżka: strona 1 = adres bazowy profilu, kolejne pod /strona/<n>', () => {
    expect(companyProfilePath('firma-x')).toBe('/pracodawcy/firma-x');
    expect(companyProfilePath('firma-x', 1)).toBe('/pracodawcy/firma-x');
    expect(companyProfilePath('firma-x', 3)).toBe('/pracodawcy/firma-x/strona/3');
  });
});
