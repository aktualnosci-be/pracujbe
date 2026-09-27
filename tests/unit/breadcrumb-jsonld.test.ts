import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBreadcrumbListJsonLd } from '@/lib/seo/structured-data';

/**
 * BreadcrumbList z jednego helpera (`buildBreadcrumbListJsonLd`): ta sama lista pozycji co
 * widoczna ścieżka `Breadcrumbs`, prefiks języka, bieżąca strona = jej adres. Strażnik źródeł:
 * każda strona publiczna z widoczną ścieżką (`common.breadcrumb`) ma też BreadcrumbList, szczegół
 * oferty i profil firmy mają je obok JobPosting/Organization, a ręcznie składany JSON
 * (`'@type': 'BreadcrumbList'` w stronie) jest odrzucany — z kontrolą ujemną.
 */

const BASE = 'https://pracuj.be';

describe('buildBreadcrumbListJsonLd', () => {
  it('buduje pozycje z prefiksem języka, a bieżąca strona dostaje currentUrl', () => {
    const data = buildBreadcrumbListJsonLd(
      [
        { label: 'Strona główna', href: '/' },
        { label: 'Praca', href: '/praca' },
        { label: 'Magazyn', href: '/praca/kategoria/warehouse' },
        { label: 'Magazynier' },
      ],
      { base: BASE, locale: 'nl', currentUrl: `${BASE}/nl/oferty-pracy/magazynier-1` },
    );
    expect(data).toEqual({
      '@context': 'https://schema.org/',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Strona główna', item: `${BASE}/nl` },
        { '@type': 'ListItem', position: 2, name: 'Praca', item: `${BASE}/nl/praca` },
        { '@type': 'ListItem', position: 3, name: 'Magazyn', item: `${BASE}/nl/praca/kategoria/warehouse` },
        { '@type': 'ListItem', position: 4, name: 'Magazynier', item: `${BASE}/nl/oferty-pracy/magazynier-1` },
      ],
    });
  });

  it('pomija pozycje bez nazwy i numeruje pozostałe bez dziur', () => {
    const data = buildBreadcrumbListJsonLd(
      [
        { label: 'Home', href: '/' },
        { label: '   ', href: '/praca' },
        { label: ' Firma X ' },
      ],
      { base: BASE, locale: 'en', currentUrl: `${BASE}/en/pracodawcy/firma-x` },
    );
    expect(data.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/en` },
      { '@type': 'ListItem', position: 2, name: 'Firma X', item: `${BASE}/en/pracodawcy/firma-x` },
    ]);
  });

  it('pośrednia pozycja bez href nie dostaje cudzego adresu', () => {
    const data = buildBreadcrumbListJsonLd(
      [{ label: 'A' }, { label: 'B' }],
      { base: BASE, locale: 'pl', currentUrl: `${BASE}/pl/b` },
    );
    expect(data.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'A' },
      { '@type': 'ListItem', position: 2, name: 'B', item: `${BASE}/pl/b` },
    ]);
  });

  it('nazwa z „<” jest bezpieczna po serializacji (dane firmy/oferty z bazy)', async () => {
    const { serializeJsonLd } = await import('@/lib/seo/structured-data');
    const data = buildBreadcrumbListJsonLd([{ label: '</script><b>' }], {
      base: BASE,
      locale: 'pl',
      currentUrl: `${BASE}/pl/x`,
    });
    expect(serializeJsonLd(data)).not.toContain('</script>');
  });
});

const PUBLIC_ROOT = join(process.cwd(), 'src/app/[locale]/(public)');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

/** Problemy źródła strony: ręczny BreadcrumbList albo widoczna ścieżka bez danych strukturalnych. */
function breadcrumbProblems(source: string): string[] {
  const problems: string[] = [];
  if (/['"]@type['"]\s*:\s*['"]BreadcrumbList['"]/.test(source)) problems.push('inline');
  const visible = source.includes("tCommon('breadcrumb')");
  if (visible && !source.includes('buildBreadcrumbListJsonLd(')) problems.push('missing');
  return problems;
}

describe('strony publiczne: BreadcrumbList z helpera', () => {
  const files = pageFiles(PUBLIC_ROOT);

  it('strażnik obejmuje realne strony z widoczną ścieżką', () => {
    const withTrail = files.filter((file) => readFileSync(file, 'utf8').includes("tCommon('breadcrumb')"));
    expect(withTrail.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files.map((file) => [file.slice(PUBLIC_ROOT.length)] as const))('%s', (relative) => {
    const source = readFileSync(join(PUBLIC_ROOT, relative), 'utf8');
    expect(breadcrumbProblems(source)).toEqual([]);
  });

  it('szczegół oferty i profil firmy mają BreadcrumbList obok JobPosting/Organization', () => {
    for (const relative of ['oferty-pracy/[slug]/page.tsx', 'pracodawcy/[slug]/page.tsx']) {
      const source = readFileSync(join(PUBLIC_ROOT, relative), 'utf8');
      expect(source, relative).toContain('buildBreadcrumbListJsonLd(');
    }
  });

  it('kontrola ujemna: ręczny JSON i widoczna ścieżka bez danych są wykrywane', () => {
    const categoryPage = readFileSync(join(PUBLIC_ROOT, 'praca/kategoria/[category]/page.tsx'), 'utf8');
    const withoutHelper = categoryPage.replaceAll('buildBreadcrumbListJsonLd(', 'somethingElse(');
    expect(breadcrumbProblems(withoutHelper)).toContain('missing');
    expect(breadcrumbProblems(`const x = { '@type': 'BreadcrumbList' };`)).toContain('inline');
  });
});
