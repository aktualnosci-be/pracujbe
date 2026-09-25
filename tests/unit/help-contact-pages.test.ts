import { describe, expect, it, vi } from 'vitest';

import { routing } from '@/i18n/routing';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * #61 — Pomoc i Kontakt mają realną treść: są INDEKSOWALNE (bez `robots` noindex), mają
 * canonical w bieżącym języku i hreflang PL/NL/FR/EN + x-default, są w sitemap, a stopka
 * prowadzi do Pomocy zamiast do atrapy FAQ. Polityka prywatności zostaje placeholderem
 * z `noindex` (kontrola ujemna: nie zdjęliśmy go przy okazji). Treść Pomocy bez placeholdera,
 * bez cen i bez obietnic terminu.
 */

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' }, isProductionDeployment: () => true }));
vi.mock('@/lib/jobs', () => ({
  getJobs: async () => ({ jobs: [], total: 0, page: 1, pageSize: 100 }),
  getCategoryCounts: async () => ({}),
  getCityCounts: async () => ({}),
  getJobsAvailableLocales: async () => ({}),
}));
vi.mock('@/lib/guides/guides', () => ({ getAllGuideSlugs: () => [] }));
vi.mock('@/i18n/navigation', () => ({ Link: () => null, usePathname: () => '/' }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/components/public/ContactForm', () => ({ ContactForm: () => null }));

const { default: sitemap } = await import('@/app/sitemap');
const helpPage = await import('@/app/[locale]/(public)/pomoc/page');
const contactPage = await import('@/app/[locale]/(public)/kontakt/page');
const privacyPage = await import('@/app/[locale]/(public)/polityka-prywatnosci/page');

const MESSAGES = { pl, nl, fr, en } as const;
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

function flatten(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) flatten(v, out);
  return out;
}

describe.each([
  ['/pomoc', helpPage],
  ['/kontakt', contactPage],
] as const)('%s', (path, page) => {
  it.each(routing.locales)('%s: indeksowalna, canonical i hreflang', async (locale) => {
    const meta = await page.generateMetadata(params(locale));
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe(`https://pracuj.be/${locale}${path}`);
    expect(meta.alternates?.languages).toEqual({
      ...Object.fromEntries(routing.locales.map((l) => [l, `https://pracuj.be/${l}${path}`])),
      'x-default': `https://pracuj.be/${routing.defaultLocale}${path}`,
    });
  });

  it('jest w sitemap w każdym języku', async () => {
    const urls = (await sitemap()).map((entry) => entry.url).filter((url) => url.endsWith(path));
    expect(urls).toEqual(routing.locales.map((locale) => `https://pracuj.be/${locale}${path}`));
  });
});

describe('polityka prywatności (bez treści prawnej)', () => {
  it('kontrola ujemna: nadal noindex i poza sitemap', async () => {
    const meta = await privacyPage.generateMetadata(params('pl'));
    expect(meta.robots).toEqual({ index: false, follow: false });
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.some((url) => url.endsWith('/polityka-prywatnosci'))).toBe(false);
  });
});

describe('treść Pomocy i Kontaktu', () => {
  it.each(routing.locales)('%s: te same klucze co PL, bez placeholdera, cen i terminów odpowiedzi', (locale) => {
    for (const ns of ['help', 'contact'] as const) {
      const texts = flatten(MESSAGES[locale][ns]);
      expect(texts.length).toBe(flatten(pl[ns]).length);
      for (const text of texts) {
        expect(text).not.toContain(MESSAGES[locale].legal.placeholder);
        expect(text).not.toMatch(/[€$£]/);
      }
    }
    // Bez obietnic terminu odpowiedzi (dzień roboczy / 24 h / godziny) — nie ma takiej decyzji.
    const all = flatten(MESSAGES[locale].help).concat(flatten(MESSAGES[locale].contact)).join(' ');
    expect(all).not.toMatch(/\b24\s?h\b|dzień robocz|werkdag|jour ouvrable|business day|\bgodzin|\buur\b|\bheures?\b|\bhours?\b/i);
  });

  it('stopka prowadzi do Pomocy, nie do atrapy /faq', async () => {
    const { readFileSync } = await import('node:fs');
    const footer = readFileSync('src/components/layout/Footer.tsx', 'utf8');
    expect(footer).toContain("href: '/pomoc'");
    expect(footer).not.toContain("href: '/faq'");
  });
});
