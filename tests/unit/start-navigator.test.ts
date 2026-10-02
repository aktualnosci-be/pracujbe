import { describe, expect, it, vi } from 'vitest';

import { routing, type Locale } from '@/i18n/routing';
import { getAllGuideSlugs } from '@/lib/guides/guides';
import {
  getNavigatorRegionGuide,
  getNavigatorRegions,
  NAVIGATOR_NEEDS,
  NAVIGATOR_PATH,
  NAVIGATOR_REGIONS,
  NAVIGATOR_REVIEW,
} from '@/lib/guides/start-navigator';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #907 — nawigator „Jak zacząć pracę w Belgii?”: drzewo region → potrzeba, komplet treści
 * w PL/NL/FR/EN, granice zakresu (bez nazw urzędów i aktów prawnych, bez linków zewnętrznych —
 * lista oficjalnych adresów czeka na decyzję właściciela), termin przeglądu treści, strony
 * indeksowalne z hreflang i w sitemap, nieznany region = 404.
 */

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' }, isProductionDeployment: () => true }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
  setRequestLocale: () => undefined,
}));
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));

const indexPage = await import('@/app/[locale]/(public)/poradniki/jak-zaczac-prace/page');
const regionPage = await import('@/app/[locale]/(public)/poradniki/jak-zaczac-prace/[region]/page');

const MESSAGES = { pl, nl, fr, en } as const;

function allTexts(locale: Locale): string[] {
  const texts: string[] = [];
  for (const region of NAVIGATOR_REGIONS) {
    const guide = getNavigatorRegionGuide(region, locale)!;
    texts.push(guide.name, guide.summary);
    for (const need of guide.needs) texts.push(need.title, need.summary, ...need.steps, ...need.regionFacts);
  }
  const navigatorKeys = Object.entries(MESSAGES[locale].guides).filter(([k]) => k.startsWith('navigator'));
  for (const [, value] of navigatorKeys) texts.push(value);
  return texts;
}

/**
 * Granica treści (repo publiczne, #907): bez linków, nazw konkretnych urzędów/serwisów
 * i aktów prawnych. Lista celowo konkretna — ogólne „regionalny urząd pracy” jest dozwolone.
 */
const OUT_OF_SCOPE = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b(VDAB|Actiris|Forem|ADG|NARIC|Bruxelles Formation|Huis van het Nederlands|belgium\.be)\b/i,
  /(?<!\p{L})(ustaw(a|ą|y|ie|ę)(?!\p{L})|dyrektyw|rozporządz|wet van|decreet|loi du|décret|directive|act of)/iu,
];

function outOfScope(texts: readonly string[]): string[] {
  return texts.filter((text) => OUT_OF_SCOPE.some((re) => re.test(text)));
}

describe('treść nawigatora (#907)', () => {
  it.each(routing.locales)('%s: każdy region ma wszystkie potrzeby z krokami i faktami regionu', (locale) => {
    for (const region of NAVIGATOR_REGIONS) {
      const guide = getNavigatorRegionGuide(region, locale)!;
      expect(guide.name.length).toBeGreaterThan(0);
      expect(guide.needs.map((need) => need.key)).toEqual([...NAVIGATOR_NEEDS]);
      for (const need of guide.needs) {
        expect(need.steps.length, `${region}/${need.key}`).toBeGreaterThanOrEqual(3);
        expect(need.regionFacts.length, `${region}/${need.key}`).toBeGreaterThanOrEqual(1);
        for (const text of [need.title, need.summary, ...need.steps, ...need.regionFacts]) {
          expect(text.trim().length, `${region}/${need.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('fakty regionów różnią się między regionami (prowadzi do ścieżki właściwej dla regionu)', () => {
    for (const locale of routing.locales) {
      const facts = NAVIGATOR_REGIONS.map((region) =>
        getNavigatorRegionGuide(region, locale)!.needs.find((n) => n.key === 'diploma-recognition')!.regionFacts[0],
      );
      expect(new Set(facts).size, locale).toBe(NAVIGATOR_REGIONS.length);
    }
  });

  it('tłumaczenia nie są kopią polskiego tekstu', () => {
    const plTexts = allTexts('pl');
    for (const locale of routing.locales.filter((l) => l !== 'pl')) {
      const texts = allTexts(locale);
      expect(texts.length, locale).toBe(plTexts.length);
      const copied = texts.filter((text, i) => text === plTexts[i] && text.length > 12);
      expect(copied, locale).toEqual([]);
    }
  });

  it.each(routing.locales)('%s: bez linków, nazw urzędów i aktów prawnych', (locale) => {
    expect(outOfScope(allTexts(locale))).toEqual([]);
  });

  it('kontrola ujemna: nazwa urzędu, link albo akt prawny w treści = czerwony', () => {
    expect(outOfScope(['Zarejestruj się w VDAB.'])).toHaveLength(1);
    expect(outOfScope(['Sprawdź https://example.org'])).toHaveLength(1);
    expect(outOfScope(['Zgodnie z ustawą o cudzoziemcach'])).toHaveLength(1);
    expect(outOfScope(['Na mocy dyrektywą unijną'])).toHaveLength(1);
    expect(outOfScope(['Zarejestruj się w regionalnym urzędzie pracy.'])).toEqual([]);
  });

  it('NL: forma je/jouw (bez u/uw), FR: forma vous', () => {
    expect(allTexts('nl').filter((t) => /(^|[^\p{L}])(u|uw|U|Uw)(?![\p{L}/])/u.test(t))).toEqual([]);
    expect(allTexts('fr').filter((t) => /(^|[^\p{L}’'])(tu|ton|ta|tes)\b/u.test(t))).toEqual([]);
  });

  it('zastrzeżenie zakresu i data przeglądu w każdym języku', () => {
    const disclaimer: Record<Locale, RegExp> = {
      pl: /charakter ogólny/,
      nl: /algemene informatie/,
      fr: /informations générales/,
      en: /general information/,
    };
    for (const locale of routing.locales) {
      expect(MESSAGES[locale].guides.navigatorScope, locale).toMatch(disclaimer[locale]);
      expect(MESSAGES[locale].guides.navigatorReviewed, locale).toContain('{date}');
    }
  });

  it('termin przeglądu: po dacie sprawdzenia i najwyżej 12 miesięcy później, z właścicielem', () => {
    const reviewed = Date.parse(`${NAVIGATOR_REVIEW.reviewedAt}T00:00:00Z`);
    const due = Date.parse(`${NAVIGATOR_REVIEW.reviewDueAt}T00:00:00Z`);
    expect(Number.isFinite(reviewed) && Number.isFinite(due)).toBe(true);
    expect(due).toBeGreaterThan(reviewed);
    expect(due - reviewed).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
    expect(NAVIGATOR_REVIEW.owner.length).toBeGreaterThan(0);
  });

  it('segment nawigatora nie koliduje ze slugiem poradnika', () => {
    expect(NAVIGATOR_PATH).toBe('/poradniki/jak-zaczac-prace');
    expect(getAllGuideSlugs()).not.toContain(NAVIGATOR_PATH.split('/').pop());
  });

  it('nieznany region = brak przewodnika; nieobsługiwany język = język domyślny', () => {
    expect(getNavigatorRegionGuide('limburgia', 'pl')).toBeNull();
    expect(getNavigatorRegions('xx')).toEqual(getNavigatorRegions(routing.defaultLocale));
  });
});

describe('strony nawigatora (#907)', () => {
  const languagesFor = (path: string) => ({
    ...Object.fromEntries(routing.locales.map((l) => [l, `https://pracuj.be/${l}${path}`])),
    'x-default': `https://pracuj.be/${routing.defaultLocale}${path}`,
  });

  it.each(routing.locales)('%s: wybór regionu i strony regionów indeksowalne z hreflang', async (locale) => {
    const meta = await indexPage.generateMetadata({ params: Promise.resolve({ locale }) });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe(`https://pracuj.be/${locale}${NAVIGATOR_PATH}`);
    expect(meta.alternates?.languages).toEqual(languagesFor(NAVIGATOR_PATH));

    for (const region of NAVIGATOR_REGIONS) {
      const path = `${NAVIGATOR_PATH}/${region}`;
      const regionMeta = await regionPage.generateMetadata({ params: Promise.resolve({ locale, region }) });
      expect(regionMeta.robots).toBeUndefined();
      expect(regionMeta.alternates?.canonical).toBe(`https://pracuj.be/${locale}${path}`);
      expect(regionMeta.alternates?.languages).toEqual(languagesFor(path));
    }
  });

  it('statyczne parametry = każdy język × każdy region', () => {
    expect(regionPage.generateStaticParams()).toHaveLength(routing.locales.length * NAVIGATOR_REGIONS.length);
  });

  it('nieznany region: noindex w metadanych i 404 strony', async () => {
    const meta = await regionPage.generateMetadata({ params: Promise.resolve({ locale: 'pl', region: 'x' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    await expect(
      regionPage.default({ params: Promise.resolve({ locale: 'pl', region: 'x' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
