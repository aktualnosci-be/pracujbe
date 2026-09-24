import { describe, expect, it, vi } from 'vitest';

import { routing } from '@/i18n/routing';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * #339 — publiczna strona dla pracodawców: pozycja „Dla pracodawców” prowadzi do strony
 * informacyjnej (nie do formularza), strona jest w sitemap we wszystkich językach, a jej treść
 * nie zawiera wymyślonych cen ani liczb (#305) — tylko fakty z produktu.
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
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const { default: sitemap } = await import('@/app/sitemap');
const { PRIMARY_NAV } = await import('@/components/layout/MobileNav');

const PATH = '/dla-pracodawcow';
const MESSAGES = { pl, nl, fr, en } as const;

describe('strona dla pracodawców', () => {
  it('nawigacja „Dla pracodawców” prowadzi do strony informacyjnej, nie do rejestracji', () => {
    const entry = PRIMARY_NAV.find((item) => item.key === 'forEmployers');
    expect(entry?.href).toBe(PATH);
    // Kontrola ujemna: żadna pozycja głównej nawigacji nie wskazuje formularza konta.
    expect(PRIMARY_NAV.map((item) => item.href)).not.toContain('/rejestracja-pracodawca');
  });

  it('jest w sitemap w każdym języku z pełnym hreflang', async () => {
    const entries = (await sitemap()).filter((entry) => entry.url.endsWith(PATH));
    expect(entries.map((entry) => entry.url)).toEqual(
      routing.locales.map((locale) => `https://pracuj.be/${locale}${PATH}`),
    );
    for (const entry of entries) {
      expect(entry.alternates?.languages).toEqual({
        ...Object.fromEntries(routing.locales.map((l) => [l, `https://pracuj.be/${l}${PATH}`])),
        'x-default': `https://pracuj.be/${routing.defaultLocale}${PATH}`,
      });
    }
  });

  it.each(routing.locales)('%s: treść bez cen i liczb, z tymi samymi kluczami co PL', (locale) => {
    const copy = MESSAGES[locale].employers as Record<string, string>;
    expect(Object.keys(copy).sort()).toEqual(Object.keys(pl.employers).sort());
    for (const [key, value] of Object.entries(copy)) {
      expect(value, `${locale}.employers.${key}`).not.toMatch(/[0-9€$£%]/);
    }
  });
});
