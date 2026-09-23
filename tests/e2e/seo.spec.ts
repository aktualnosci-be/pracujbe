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

// #118: tytuł z nazwą marki nie może dodatkowo przejść przez szablon layoutu
// („… | Pracuj.be · Pracuj.be”). Sprawdzamy każdą trasę, której tytuł z
// komunikatów już zawiera markę.
const brandTitleRoutes = ['', '/praca', '/poradniki', '/praca/kategoria/construction', '/praca/miasto/brussels'];

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  for (const route of brandTitleRoutes) {
    test(`${locale}${route || '/'} ma dokładnie jedną nazwę marki w <title>`, async ({ page }) => {
      await page.goto(`/${locale}${route}`);
      const title = await page.title();
      expect(title.match(/Pracuj\.be/g) ?? [], title).toHaveLength(1);
      expect(title).not.toMatch(/·\s*Pracuj\.be$/);
    });
  }
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const canonical = (page: import('@playwright/test').Page) => page.locator('link[rel="canonical"]');
const hreflang = (page: import('@playwright/test').Page, lang: string) =>
  page.locator(`link[rel="alternate"][hreflang="${lang}"]`);

async function jobPostingCount(page: import('@playwright/test').Page): Promise<number> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.filter((raw) => (JSON.parse(raw) as { '@type'?: unknown })['@type'] === 'JobPosting').length;
}

// #314: sama paginacja jest kanoniczna sama dla siebie; filtry → lista bazowa; page=1 → bez parametru.
test('lista ofert ?page=2 ma canonical i hreflang ze stroną 2', async ({ page }) => {
  await page.goto('/pl/oferty-pracy?page=2');
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}/pl/oferty-pracy?page=2`);
  await expect(hreflang(page, 'nl')).toHaveAttribute('href', `${SITE}/nl/oferty-pracy?page=2`);
  await expect(hreflang(page, 'x-default')).toHaveAttribute('href', `${SITE}/pl/oferty-pracy?page=2`);
});

for (const query of ['?page=1', '?keyword=kierowca&page=2', '?sort=salary&page=2']) {
  test(`lista ofert ${query} kanonizuje się do listy bazowej`, async ({ page }) => {
    await page.goto(`/pl/oferty-pracy${query}`);
    await expect(canonical(page)).toHaveAttribute('href', `${SITE}/pl/oferty-pracy`);
  });
}

// #308: strony noindex nie dziedziczą canonicala strony głównej.
for (const path of ['/pl/logowanie', '/pl/rejestracja', '/pl/rejestracja-pracodawca', '/pl/reset-hasla', '/pl/nie-ma-takiej', '/pl/oferty-pracy/nie-istnieje', '/pl/offline']) {
  test(`${path} (noindex) nie ma link[rel=canonical]`, async ({ page }) => {
    await page.goto(path);
    // 404 z notFound() może mieć dwa meta robots (strona + Next) — wystarczy, że któreś ma noindex.
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(canonical(page)).toHaveCount(0);
  });
}

test('strona główna nadal deklaruje własny canonical', async ({ page }) => {
  await page.goto('/nl');
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}/nl`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${SITE}/nl`);
});

// #299: landing z ofertami pozostaje indeksowalny (pusty — patrz tests/unit/landing-empty-noindex.test.ts).
test('landing kategorii z ofertami jest indeksowalny z canonicalem', async ({ page }) => {
  await page.goto('/pl/praca/kategoria/construction');
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}/pl/praca/kategoria/construction`);
});

// #301: oferta demo 1026 ma treść tylko po niderlandzku.
const NL_ONLY_JOB = '/oferty-pracy/logistics-intern-ghent-1026';

test('oferta bez tłumaczenia: wersja PL kanonizuje się do NL, bez hreflang i JobPosting', async ({ page }) => {
  await page.goto(`/pl${NL_ONLY_JOB}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}/nl${NL_ONLY_JOB}`);
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  expect(await jobPostingCount(page)).toBe(0);

  // Treść oznaczona językiem oryginału (WCAG 3.1.2) + etykieta w języku strony.
  await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'nl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Stagiair logistiek');
  await expect(page.locator('#opis p[lang="nl"]')).toBeVisible();
  await expect(page.getByTestId('job-content-language')).toContainText('niderlandzki');
  await expect(page.getByTestId('job-content-language')).not.toHaveAttribute('lang', /.+/);
});

test('oferta bez tłumaczenia: wersja NL jest kanoniczna, hreflang tylko dla NL', async ({ page }) => {
  await page.goto(`/nl${NL_ONLY_JOB}`);
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}/nl${NL_ONLY_JOB}`);
  await expect(hreflang(page, 'nl')).toHaveAttribute('href', `${SITE}/nl${NL_ONLY_JOB}`);
  await expect(hreflang(page, 'x-default')).toHaveAttribute('href', `${SITE}/nl${NL_ONLY_JOB}`);
  for (const lang of ['pl', 'fr', 'en']) await expect(hreflang(page, lang)).toHaveCount(0);
  expect(await jobPostingCount(page)).toBe(1);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveAttribute('lang', /.+/);
  await expect(page.getByTestId('job-content-language')).toHaveCount(0);
});

test('oferta z kompletem tłumaczeń ma hreflang dla 4 języków i canonical na siebie', async ({ page }) => {
  await page.goto(`/fr/oferty-pracy/${(await firstJobSlugHref(page)).split('/').pop()}`);
  const url = page.url().replace(/^https?:\/\/[^/]+/, '');
  await expect(canonical(page)).toHaveAttribute('href', `${SITE}${url}`);
  for (const lang of ['pl', 'nl', 'fr', 'en', 'x-default']) await expect(hreflang(page, lang)).toHaveCount(1);
  await expect(page.getByTestId('job-content-language')).toHaveCount(0);
});
