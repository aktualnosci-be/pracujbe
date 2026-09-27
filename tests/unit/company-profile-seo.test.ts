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

vi.mock('@/lib/companies', () => ({ getCompanyProfile }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({ PublicSavedJobsProvider: () => null }));

const page = await import('@/app/[locale]/(public)/pracodawcy/[slug]/page');

function profile(activeJobsCount: number) {
  return {
    company: { id: 'c1', slug: 'firma-x', name: 'Firma X', description: 'Opis', activeJobsCount },
    jobs: [],
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
