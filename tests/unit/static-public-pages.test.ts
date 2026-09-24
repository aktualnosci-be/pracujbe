// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PUBLIC_JOBS_REVALIDATE_SECONDS, prerenderParamsAtBuild } from '@/lib/static-rendering';

/**
 * Strażnik #298: strony publiczne są statyczne/ISR. Wystarczy jedno wywołanie next-intl bez
 * jawnego locale w chrome'ie (Header/Footer/SkipLink), żeby next-intl sięgnął po `headers()`
 * i całe drzewo `(public)` wróciło do SSR z `Cache-Control: no-store`. Pełny dowód daje build
 * (`scripts/check-next-build.mjs` sprawdza prerender) i E2E `public-cache-headers.spec.ts`.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const PUBLIC = 'src/app/[locale]/(public)';

const JOB_PAGES = [
  `${PUBLIC}/page.tsx`,
  `${PUBLIC}/praca/page.tsx`,
  `${PUBLIC}/praca/kategoria/[category]/page.tsx`,
  `${PUBLIC}/praca/miasto/[city]/page.tsx`,
  `${PUBLIC}/oferty-pracy/[slug]/page.tsx`,
];

describe('chrome stron publicznych nie wymusza renderowania dynamicznego', () => {
  it('layout (public) ustawia locale i podaje je jawnie do Header/Footer/SkipLink', () => {
    const layout = read(`${PUBLIC}/layout.tsx`);
    expect(layout).toMatch(/setRequestLocale\(locale\)/);
    for (const component of ['SkipLink', 'Header', 'Footer']) {
      expect(layout).toContain(`<${component} locale={locale} />`);
    }
  });

  for (const file of ['Header', 'Footer', 'SkipLink']) {
    it(`${file}: tłumaczenia z jawnym locale, bez getLocale()`, () => {
      const source = read(`src/components/layout/${file}.tsx`);
      expect(source).not.toMatch(/getLocale\(/);
      // Każde getTranslations dostaje obiekt { locale, namespace }, nie gołą przestrzeń nazw.
      expect(source).not.toMatch(/getTranslations\(\s*['"]/);
      expect(source).toMatch(/getTranslations\(\{ locale, namespace:/);
    });
  }

  it('strony publiczne i chrome nie czytają cookies/nagłówków żądania', () => {
    const files = [
      `${PUBLIC}/layout.tsx`,
      ...JOB_PAGES,
      'src/components/layout/Header.tsx',
      'src/components/layout/Footer.tsx',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/from 'next\/headers'/);
      expect(source, file).not.toMatch(/supabase\/server|getCurrentUser|getSession/);
    }
  });
});

describe('ISR stron z ofertami', () => {
  for (const file of JOB_PAGES) {
    it(`${file}: revalidate = PUBLIC_JOBS_REVALIDATE_SECONDS`, () => {
      // Next wymaga literału w `export const revalidate`, więc pilnujemy zgodności ze stałą.
      expect(read(file)).toContain(`export const revalidate = ${PUBLIC_JOBS_REVALIDATE_SECONDS};`);
    });
  }

  it('strony treściowe mają górną granicę świeżości w layoucie (public)', () => {
    expect(read(`${PUBLIC}/layout.tsx`)).toMatch(/export const revalidate = 3600;/);
  });
});

describe('prerenderParamsAtBuild — build nie łączy się z bazą', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez bazy (demo/CI) prerenderuje wszystkie parametry', () => {
    vi.stubEnv('DATABASE_APP_URL', '');
    expect(prerenderParamsAtBuild([{ locale: 'pl' }, { locale: 'nl' }])).toEqual([
      { locale: 'pl' },
      { locale: 'nl' },
    ]);
  });

  it('ze skonfigurowaną bazą zwraca pustą listę (strony powstają przy pierwszym żądaniu)', () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://app@db.internal/pracujbe');
    expect(prerenderParamsAtBuild([{ locale: 'pl' }])).toEqual([]);
  });

  it('layout [locale] i landingi z ofertami korzystają z helpera', () => {
    for (const file of [
      'src/app/[locale]/layout.tsx',
      `${PUBLIC}/praca/page.tsx`,
      `${PUBLIC}/praca/kategoria/[category]/page.tsx`,
      `${PUBLIC}/praca/miasto/[city]/page.tsx`,
    ]) {
      expect(read(file), file).toContain('prerenderParamsAtBuild(');
    }
  });
});
