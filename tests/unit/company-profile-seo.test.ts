import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOrganizationJsonLd } from '@/lib/seo/structured-data';
import {
  FIXTURE_COMPANY_WITHOUT_JOBS_SLUG,
  fixtureCompanyBySlug,
  fixtureCompanySlug,
} from '@/lib/company-fixture';

/**
 * Profil publiczny firmy pod SEO i kandydata (#591): profil bez aktywnych ofert ma
 * `noindex, follow` i nie deklaruje canonical/hreflang (jak pusty landing, #299), profil
 * z ofertami jest indeksowalny; Organization JSON-LD tylko z bezpiecznymi linkami https;
 * fixture E2E ma slug i profil wyłącznie dla firmy zweryfikowanej (jak `company_slug` w bazie).
 */

const { getCompanyProfile } = vi.hoisted(() => ({ getCompanyProfile: vi.fn() }));

vi.mock('@/lib/companies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/companies')>()),
  getCompanyProfile,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({ PublicSavedJobsProvider: () => null }));
vi.mock('@/components/public/Pagination', () => ({ Pagination: () => null }));

const page = await import('@/app/[locale]/(public)/pracodawcy/[slug]/page');
const nextPage = await import('@/app/[locale]/(public)/pracodawcy/[slug]/strona/[page]/page');

function profile(activeJobsCount: number, currentPage = 1, description = 'Opis') {
  return {
    company: { id: 'c1', slug: 'firma-x', name: 'Firma X', description, activeJobsCount },
    jobs: [],
    page: currentPage,
    lastPage: Math.max(1, Math.ceil(activeJobsCount / 50)),
    pageSize: 50,
  };
}

const metadata = () => page.generateMetadata({ params: Promise.resolve({ locale: 'nl', slug: 'firma-x' }) });

beforeEach(() => getCompanyProfile.mockReset());

describe('metadane profilu firmy', () => {
  it('z aktywnymi ofertami: indeksowalny, canonical i komplet hreflang', async () => {
    getCompanyProfile.mockResolvedValue(profile(2));
    const meta = await metadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toMatch(/\/nl\/pracodawcy\/firma-x$/);
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(['pl', 'nl', 'fr', 'en', 'x-default']);
  });

  it('bez aktywnych ofert: noindex, follow i brak canonical/hreflang', async () => {
    getCompanyProfile.mockResolvedValue(profile(0));
    const meta = await metadata();
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
  });

  it('brak profilu (firma niezweryfikowana / zły slug): noindex, nofollow', async () => {
    getCompanyProfile.mockResolvedValue(null);
    expect((await metadata()).robots).toEqual({ index: false, follow: false });
  });
});

describe('metadane kolejnej strony ofert profilu (#638)', () => {
  const pageMetadata = (raw: string) =>
    nextPage.generateMetadata({ params: Promise.resolve({ locale: 'nl', slug: 'firma-x', page: raw }) });

  it('strona 2: własny canonical i hreflang tej samej strony, tytuł z numerem strony', async () => {
    getCompanyProfile.mockResolvedValue(profile(120, 2));
    const meta = await pageMetadata('2');
    expect(getCompanyProfile).toHaveBeenCalledWith('firma-x', 'nl', 2);
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toMatch(/\/nl\/pracodawcy\/firma-x\/strona\/2$/);
    expect((meta.alternates?.languages as Record<string, string>)['fr']).toMatch(/\/fr\/pracodawcy\/firma-x\/strona\/2$/);
    expect(meta.title).toEqual({ absolute: 'metaTitlePage' });
  });

  it('kontrola ujemna: strona 1, zapis niekanoniczny i śmieci nie pytają bazy (404, noindex)', async () => {
    for (const raw of ['1', '01', '2.0', 'x', '-2', '1e1']) {
      expect((await pageMetadata(raw)).robots).toEqual({ index: false, follow: false });
    }
    expect(getCompanyProfile).not.toHaveBeenCalled();
  });

  it('strona za ostatnią (brak profilu z getCompanyProfile): noindex, nofollow', async () => {
    getCompanyProfile.mockResolvedValue(null);
    expect((await pageMetadata('9')).robots).toEqual({ index: false, follow: false });
  });
});

describe('meta description z opisu firmy (#647)', () => {
  it('firma z opisem: description i og:description biorą tekst firmy, nie ogólny klucz', async () => {
    getCompanyProfile.mockResolvedValue(profile(1, 1, 'Produkujemy meble na zamówienie w całej Belgii.'));
    const meta = await metadata();
    expect(meta.description).toBe('Produkujemy meble na zamówienie w całej Belgii.');
    expect(meta.openGraph?.description).toBe(meta.description);
    expect(meta.twitter).toMatchObject({ description: meta.description });
    // Kontrola ujemna: ogólny klucz tłumaczenia (mock zwraca nazwę klucza) nie trafia do metadanych.
    expect(meta.description).not.toBe('metaDescription');
  });

  it('firma bez opisu (pusty/białe znaki): fallback na ogólny tłumaczony tekst', async () => {
    getCompanyProfile.mockResolvedValue(profile(1, 1, '   '));
    const meta = await metadata();
    expect(meta.description).toBe('metaDescription');
  });

  it('długi opis: obcięty do 160 znaków z wielokropkiem, bez łamania na środku wielu spacji', async () => {
    const long = `Firma X ${'oferuje stabilne zatrudnienie i szkolenia '.repeat(6)}.`;
    getCompanyProfile.mockResolvedValue(profile(1, 1, long));
    const meta = await metadata();
    const description = meta.description as string;
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toMatch(/\s{2,}/);
  });
});

describe('Organization JSON-LD', () => {
  const url = 'https://pracuj.be/nl/pracodawcy/firma-x';

  it('nazwa, adres profilu, opis, strona WWW, logo i adres', () => {
    expect(
      buildOrganizationJsonLd(
        {
          name: 'Firma X',
          description: 'Opis',
          city: 'Gent',
          region: 'Oost-Vlaanderen',
          website: 'https://firma-x.example.invalid',
          logoUrl: 'https://cdn.example.invalid/logo.png',
        },
        url,
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Firma X',
      url,
      description: 'Opis',
      sameAs: 'https://firma-x.example.invalid/',
      logo: 'https://cdn.example.invalid/logo.png',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Gent',
        addressRegion: 'Oost-Vlaanderen',
        addressCountry: 'BE',
      },
    });
  });

  it('kontrola ujemna: link inny niż https i pusty opis nie trafiają do danych', () => {
    const data = buildOrganizationJsonLd(
      {
        name: 'Firma X',
        description: '   ',
        website: 'http://firma-x.example.invalid',
        logoUrl: 'javascript:alert(1)',
      },
      url,
    );
    expect(data).not.toHaveProperty('sameAs');
    expect(data).not.toHaveProperty('logo');
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('address');
  });
});

describe('fixture E2E: profil tylko dla firmy zweryfikowanej', () => {
  it('firma zweryfikowana ma slug i profil w języku strony', () => {
    const slug = fixtureCompanySlug('Antwerp Logistics NV', true);
    expect(slug).toBe('antwerp-logistics-nv');
    expect(fixtureCompanyBySlug(slug!, 'nl')).toMatchObject({ name: 'Antwerp Logistics NV', city: expect.any(String) });
  });

  it('kontrola ujemna: firma niezweryfikowana nie ma sluga ani profilu', () => {
    expect(fixtureCompanySlug('CleanPro Services', false)).toBeUndefined();
    // Fikcyjna firma niezweryfikowana (c4) nie ma profilu nawet po poprawnym slugu z nazwy.
    expect(fixtureCompanyBySlug('cleanpro-services', 'pl')).toBeNull();
    expect(fixtureCompanyBySlug('nie-taka-firma', 'pl')).toBeNull();
  });

  it('firma bez aktywnych ofert istnieje (przypadek noindex)', () => {
    expect(fixtureCompanyBySlug(FIXTURE_COMPANY_WITHOUT_JOBS_SLUG, 'fr')).toMatchObject({ slug: FIXTURE_COMPANY_WITHOUT_JOBS_SLUG });
  });
});
