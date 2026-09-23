import { expect, test } from '@playwright/test';

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  for (const path of ['', '/oferty-pracy']) {
    test(`obraz udostępniania ${locale}${path || '/'} pochodzi z publicznego zasobu`, async ({ page, request }) => {
      await page.goto(`/${locale}${path}`);
      const expectedImage = new URL('/og.png', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').href;

      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', expectedImage);
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', expectedImage);
      expect(new URL(expectedImage).protocol).toMatch(/^https?:$/);

      const image = await request.get(expectedImage);
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toMatch(/^image\/png/);
    });
  }
}

const seoTitles = {
  pl: { praca: 'Przeglądaj pracę w Belgii — branże i miasta | Pracuj.be', poradniki: 'Poradniki — praca w Belgii | Pracuj.be' },
  nl: { praca: 'Ontdek werk in België — sectoren en steden | Pracuj.be', poradniki: 'Gidsen — werken in België | Pracuj.be' },
  fr: { praca: 'Parcourez les emplois en Belgique — secteurs et villes | Pracuj.be', poradniki: 'Guides — travailler en Belgique | Pracuj.be' },
  en: { praca: 'Browse jobs in Belgium — industries and cities | Pracuj.be', poradniki: 'Guides — working in Belgium | Pracuj.be' },
} as const;

for (const [locale, titles] of Object.entries(seoTitles)) {
  for (const route of ['praca', 'poradniki'] as const) {
    test(`${locale}/${route} ma jedną nazwę marki w tytule oraz pełny canonical i hreflang`, async ({ page }) => {
      await page.goto(`/${locale}/${route}`);
      await expect(page).toHaveTitle(titles[route]);
      const origin = new URL(page.url()).origin;

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute('href', `${origin}/${locale}/${route}`);

      for (const language of ['pl', 'nl', 'fr', 'en']) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute(
          'href',
          `${origin}/${language}/${route}`,
        );
      }
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
        'href',
        `${origin}/pl/${route}`,
      );
    });
  }
}

/**
 * Testy SEO — działają na danych demonstracyjnych (bez Supabase).
 *
 * Zakres:
 *  1. Szczegóły oferty: dane strukturalne JobPosting (JSON-LD) + <html lang="pl">.
 */

/** Pobiera slug pierwszej oferty demonstracyjnej z listy. */
async function firstJobSlugHref(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/pl/oferty-pracy');
  const href = await page.locator('a[href*="/oferty-pracy/"]').first().getAttribute('href');
  expect(href, 'Lista ofert powinna zawierać co najmniej jeden link do szczegółów').toBeTruthy();
  return href as string;
}

test('szczegóły oferty zawierają JSON-LD JobPosting oraz <html lang="pl">', async ({ page }) => {
  const href = await firstJobSlugHref(page);
  await page.goto(href);

  // <html lang="pl">
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Dane strukturalne JobPosting (JSON-LD).
  const jsonLdBlocks = page.locator('script[type="application/ld+json"]');
  const count = await jsonLdBlocks.count();
  expect(count).toBeGreaterThan(0);

  let foundJobPosting = false;
  for (let i = 0; i < count; i += 1) {
    const raw = await jsonLdBlocks.nth(i).textContent();
    if (!raw) continue;
    const parsed: unknown = JSON.parse(raw);
    const type = (parsed as { '@type'?: unknown })['@type'];
    if (type === 'JobPosting') {
      foundJobPosting = true;
      const data = parsed as Record<string, unknown>;
      expect(typeof data['title']).toBe('string');
      expect(typeof data['datePosted']).toBe('string');
      expect(data['hiringOrganization']).toBeTruthy();
      expect(data['jobLocation']).toBeTruthy();
      break;
    }
  }
  expect(foundJobPosting, 'Brak danych strukturalnych JobPosting (JSON-LD)').toBe(true);
});
