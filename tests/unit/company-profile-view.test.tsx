import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Widok publicznego profilu firmy (#686, #708): logo i strona WWW zatwierdzone przez admina
 * (0156) są widoczne w dostępny sposób; opis jest oznaczony językiem wskazanym przez firmę
 * (0201), a odwiedzający dowiaduje się, gdy opis jest w innym języku niż strona albo język
 * nie jest znany. Kontrole ujemne: logo spoza witryny (CSP), link nie-https, brak pól.
 */

const { getCompanyProfile } = vi.hoisted(() => ({ getCompanyProfile: vi.fn() }));

vi.mock('@/lib/companies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/companies')>()),
  getCompanyProfile,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === 'string' ? arg : arg.namespace;
    return (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values ? `(${Object.values(values).join('|')})` : ''}`;
  },
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/public/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/public/JobCard', () => ({ JobCard: () => null }));
vi.mock('@/components/public/Pagination', () => ({ Pagination: () => null }));
vi.mock('@/components/public/PublicSavedJobs', () => ({
  PublicSavedJobsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const view = await import('@/app/[locale]/(public)/pracodawcy/_profile/company-profile');
const page = await import('@/app/[locale]/(public)/pracodawcy/[slug]/page');

type Company = {
  description?: string;
  descriptionLocale?: 'pl' | 'nl' | 'fr' | 'en';
  logoUrl?: string;
  website?: string;
};

function profile(company: Company = {}) {
  return {
    company: {
      id: 'c1',
      slug: 'firma-x',
      name: 'Firma X',
      description: 'Wij bouwen bruggen.',
      activeJobsCount: 1,
      ...company,
    },
    jobs: [],
    page: 1,
    lastPage: 1,
    pageSize: 50,
  };
}

async function render(company: Company, locale = 'nl'): Promise<Document> {
  getCompanyProfile.mockResolvedValue(profile(company));
  const element = await view.CompanyProfileView({ locale, slug: 'firma-x', page: 1 });
  return new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html');
}

beforeEach(() => {
  getCompanyProfile.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
});
afterEach(() => vi.unstubAllEnvs());

describe('profil firmy — logo (#686)', () => {
  it('logo z hosta witryny: obraz z nazwą firmy w alt, bez inicjałów', async () => {
    const doc = await render({ logoUrl: 'https://pracuj.be/uploads/firma-x.png' });
    const img = doc.querySelector('[data-testid="company-logo"]');
    expect(img?.getAttribute('src')).toBe('https://pracuj.be/uploads/firma-x.png');
    expect(img?.getAttribute('alt')).toBe('companyProfile.logoAlt(Firma X)');
    expect(doc.querySelector('header [aria-hidden="true"]')?.textContent).not.toBe('FX');
  });

  it('kontrola ujemna: logo z obcego hosta (CSP img-src) → inicjały, bez żądania do serwera firmy', async () => {
    const doc = await render({ logoUrl: 'https://cdn.firma-x.example/logo.png' });
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('header div[aria-hidden="true"]')?.textContent).toBe('FX');
  });

  it('kontrola ujemna: brak logo albo adres nie-https → inicjały', async () => {
    for (const logoUrl of [undefined, 'http://pracuj.be/logo.png', 'javascript:alert(1)']) {
      const doc = await render({ logoUrl });
      expect(doc.querySelector('img'), String(logoUrl)).toBeNull();
    }
  });

  it('profileLogoSrc: tylko https z hosta witryny', () => {
    expect(view.profileLogoSrc('https://pracuj.be/a.png', 'pracuj.be')).toBe('https://pracuj.be/a.png');
    expect(view.profileLogoSrc('https://evil.example/a.png', 'pracuj.be')).toBeNull();
    expect(view.profileLogoSrc('https://pracuj.be/a.png', '')).toBeNull();
  });
});

describe('profil firmy — strona WWW (#686)', () => {
  it('link zewnętrzny z etykietą, nową kartą zapowiedzianą czytnikowi i bezpiecznym rel', async () => {
    const doc = await render({ website: 'https://www.firma-x.example/' });
    const link = doc.querySelector<HTMLAnchorElement>('[data-testid="company-website"]');
    expect(link?.getAttribute('href')).toBe('https://www.firma-x.example/');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')?.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer']);
    expect(link?.textContent).toContain('firma-x.example');
    expect(link?.querySelector('.sr-only')?.textContent).toContain('companyProfile.opensInNewTab');
    expect(link?.parentElement?.textContent).toContain('companyProfile.websiteLabel');
  });

  it('kontrola ujemna: brak strony albo adres nie-https → brak linku', async () => {
    for (const website of [undefined, 'http://firma-x.example', 'javascript:alert(1)']) {
      const doc = await render({ website });
      expect(doc.querySelector('[data-testid="company-website"]'), String(website)).toBeNull();
    }
  });
});

describe('profil firmy — język opisu (#708)', () => {
  it('opis w języku strony: atrybut lang, bez dodatkowej informacji', async () => {
    const doc = await render({ descriptionLocale: 'nl' }, 'nl');
    expect(doc.querySelector('[data-testid="company-description"]')?.getAttribute('lang')).toBe('nl');
    expect(doc.querySelector('[data-testid="company-description-language"]')).toBeNull();
  });

  it('opis w innym języku: lang opisu i informacja z nazwą języka w języku strony', async () => {
    const doc = await render({ descriptionLocale: 'nl' }, 'pl');
    expect(doc.querySelector('[data-testid="company-description"]')?.getAttribute('lang')).toBe('nl');
    expect(doc.querySelector('[data-testid="company-description-language"]')?.textContent).toBe(
      'companyProfile.descriptionLanguageOther(languageNames.nl)',
    );
  });

  it('język nieznany (albo opis zmieniony po wskazaniu): bez lang, informacja o możliwym innym języku', async () => {
    const doc = await render({}, 'pl');
    expect(doc.querySelector('[data-testid="company-description"]')?.hasAttribute('lang')).toBe(false);
    expect(doc.querySelector('[data-testid="company-description-language"]')?.textContent).toBe(
      'companyProfile.descriptionLanguageUnknown',
    );
  });

  it('brak opisu: tekst zastępczy, bez informacji o języku', async () => {
    const doc = await render({ description: '  ' }, 'pl');
    expect(doc.body.textContent).toContain('companyProfile.noDescription');
    expect(doc.querySelector('[data-testid="company-description"]')).toBeNull();
    expect(doc.querySelector('[data-testid="company-description-language"]')).toBeNull();
  });

  it('metadane: opis w innym języku niż strona → ogólny opis w języku strony; hreflang bez zmian', async () => {
    getCompanyProfile.mockResolvedValue(profile({ descriptionLocale: 'nl' }));
    const other = await page.generateMetadata({ params: Promise.resolve({ locale: 'pl', slug: 'firma-x' }) });
    expect(other.description).toBe('companyProfile.metaDescription(Firma X)');
    expect(Object.keys(other.alternates?.languages ?? {})).toEqual(['pl', 'nl', 'fr', 'en', 'x-default']);
    // Kontrola ujemna: w języku opisu metadane biorą tekst firmy (#647).
    const same = await page.generateMetadata({ params: Promise.resolve({ locale: 'nl', slug: 'firma-x' }) });
    expect(same.description).toBe('Wij bouwen bruggen.');
    expect(same.openGraph?.description).toBe('Wij bouwen bruggen.');
  });
});
