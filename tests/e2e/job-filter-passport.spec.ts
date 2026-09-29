import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Locale = (typeof locales)[number];

type Messages = {
  filters: {
    title: string;
    close: string;
    immediate: string;
    noLanguageRequired: string;
    showResults: string;
  };
  jobs: {
    pageTitle: string;
    empty: string;
  };
  locations: Record<string, string>;
  categories: Record<string, string>;
  contractTypes: Record<string, string>;
};

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src', 'messages', `${locale}.json`),
      'utf-8',
    ),
  ) as Messages;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function undersizedTargets(
  root: Locator,
): Promise<Array<{ target: string | null; height: number }>> {
  const targets = root.locator('[data-filter-target]');
  expect(await targets.count()).toBeGreaterThanOrEqual(8);

  return targets.evaluateAll((elements) =>
    elements
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          target: element.getAttribute('data-filter-target'),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      })
      .filter(({ height }) => height < 48),
  );
}

async function expectTargetsAtLeast48(root: Locator): Promise<void> {
  expect(await undersizedTargets(root)).toEqual([]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wzorzec etykiety „Pokaż N ofert” — obsługuje odmianę ICU (`{count, plural, …}`, #226). */
function resultsPattern(template: string): RegExp {
  const branches = [...template.matchAll(/\{([^{}]*#[^{}]*)\}/g)].map(
    (match) => match[1],
  );
  const variants = branches.length > 0 ? branches : [template];
  const alternatives = variants.map((variant) =>
    escapeRegExp(variant)
      .replace('\\{count\\}', '\\d+')
      .replace('#', '\\d+'),
  );
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

test('formularz no-JS zachowuje pojedynczą lokalizację spoza facetów przy zerowym wyniku', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();
  const location = 'Zero Jobs Place';
  const t = messages('en');

  await page.goto(`/en/oferty-pracy?location=${encodeURIComponent(location)}`);
  await expect(page.getByText(t.jobs.empty)).toBeVisible();

  const form = page.locator('[data-filter-passport="no-js"]');
  const checkbox = form.getByRole('checkbox', { name: location, exact: true });
  await expect(checkbox).toHaveCount(1);
  await expect(checkbox).toBeChecked();

  await form.locator('button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');
  expect(new URL(page.url()).searchParams.get('location')).toBe(location);
  await expect(page.getByText(t.jobs.empty)).toBeVisible();
  await expect(
    page
      .locator('[data-filter-passport="no-js"]')
      .getByRole('checkbox', { name: location, exact: true }),
  ).toBeChecked();

  await context.close();
});

test('formularz no-JS pozwala dopisać i usunąć pojedynczą wartość z istniejącego zestawu (#795)', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();
  const t = messages('en');
  const tCat = t.categories;

  // Zestaw startowy: jedna kategoria zaznaczona z URL.
  await page.goto('/en/oferty-pracy?category=construction');
  const form = page.locator('[data-filter-passport="no-js"]');
  const construction = form.getByRole('checkbox', {
    name: tCat.construction,
    exact: true,
  });
  const transport = form.getByRole('checkbox', {
    name: tCat.transport,
    exact: true,
  });
  await expect(construction).toBeChecked();
  await expect(transport).not.toBeChecked();

  // Dopisanie drugiej wartości do zestawu — oba checkboxy zaznaczone, oba trafiają do URL
  // (GET z przeglądarki koduje dwa zaznaczone checkboxy tej samej nazwy jako powtórzony klucz).
  await transport.check();
  await form.locator('button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');
  expect(
    [...new URL(page.url()).searchParams.getAll('category')].sort(),
  ).toEqual(['construction', 'transport']);
  await expect(construction).toBeChecked();
  await expect(transport).toBeChecked();

  // Usunięcie jednej wartości z zestawu — druga zostaje zaznaczona i w URL, reszta filtrów
  // (słowo kluczowe) przechodzi bez zmian, jak w edycji zestawu z głównego panelu.
  await construction.uncheck();
  await form.locator('button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');
  const finalParams = new URL(page.url()).searchParams;
  expect(finalParams.getAll('category')).toEqual(['transport']);
  await expect(construction).not.toBeChecked();
  await expect(transport).toBeChecked();
  await expect(
    page.getByRole('heading', { level: 1, name: t.jobs.pageTitle }),
  ).toBeVisible();

  await context.close();
});

for (const locale of locales) {
  test(`filtry paszportowe zachowują SSR i hierarchię na desktopie i mobile: ${locale}`, async ({
    browser,
  }) => {
    const t = messages(locale);

    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const desktop = await desktopContext.newPage();
    await desktop.goto(`/${locale}/oferty-pracy`);

    const rail = desktop.locator('[data-filter-passport="desktop"]');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(rail).toHaveCSS('border-right-style', 'solid');
    await expect(rail).toHaveCSS('border-left-width', '0px');
    await expect(rail.locator('section').nth(1)).toHaveCSS(
      'border-top-style',
      'solid',
    );
    await expectTargetsAtLeast48(rail);
    const visibleLabels = rail.locator(
      '[data-filter-target="checkbox-label"]:visible',
    );
    for (let index = 0; index < (await visibleLabels.count()); index += 1) {
      const id = await visibleLabels.nth(index).getAttribute('for');
      expect(
        id,
        'każda widoczna opcja filtra ma powiązany identyfikator',
      ).toBeTruthy();
      await expect(rail.locator(`[data-filter-count="${id}"]`)).toHaveCount(1);
      await expect(rail.locator(`[data-filter-count="${id}"]`)).toHaveText(
        /^\d+$/,
      );
    }
    await expectNoHorizontalOverflow(desktop);

    const desktopImmediate = rail.getByRole('checkbox', {
      name: t.filters.immediate,
    });
    await desktopImmediate.focus();
    await expect(desktopImmediate).toBeFocused();
    await desktopImmediate.click();
    await rail
      .getByRole('button', { name: resultsPattern(t.filters.showResults) })
      .click();
    await expect(desktop).toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 320, height: 800 },
    });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`/${locale}/oferty-pracy`);
    const trigger = mobile.locator('[data-filter-passport="mobile-trigger"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS('min-height', '48px');
    // Przy pierwszym, zimnym wejściu czekamy na podpięcie wyspy klienckiej Radix.
    await mobile.waitForTimeout(500);
    await trigger.click();

    const sheet = mobile.locator('[data-filter-passport="mobile-sheet"]');
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', { name: t.filters.close });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(48);
    expect(closeBox?.height).toBeGreaterThanOrEqual(48);
    await expect(sheet.locator('section').nth(1)).toHaveCSS(
      'border-top-style',
      'solid',
    );
    await expectTargetsAtLeast48(sheet);
    await expectNoHorizontalOverflow(mobile);

    const mobileImmediate = sheet.getByRole('checkbox', {
      name: t.filters.immediate,
    });
    await mobileImmediate.click();
    await close.click();
    await expect(mobile).not.toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);

    // Kontrola ujemna: zamknięcie odrzuca stan oczekujący zamiast potajemnie zmieniać URL.
    await trigger.click();
    await expect(
      sheet.getByRole('checkbox', { name: t.filters.immediate }),
    ).not.toBeChecked();
    await sheet.getByRole('checkbox', { name: t.filters.immediate }).click();
    const mobileCta = sheet.getByRole('button', {
      name: resultsPattern(t.filters.showResults),
    });
    await expect(mobileCta).toHaveCSS('min-height', '48px');
    await mobileCta.click();
    await expect(mobile).toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);
    await expectNoHorizontalOverflow(mobile);
    await mobileContext.close();

    const noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 800 },
    });
    const noJs = await noJsContext.newPage();
    const expectedNoJsParams = new URLSearchParams({
      keyword: 'operator',
      city: 'Brussels',
      sort: 'salary',
      category: 'construction,transport',
      location: 'Brussels,Antwerp',
      contractType: 'permanent,temporary',
      accommodation: 'provided,unavailable',
      immediate: '1',
    });
    await noJs.goto(`/${locale}/oferty-pracy?${expectedNoJsParams.toString()}`);
    await expect(
      noJs.getByRole('heading', { level: 1, name: t.jobs.pageTitle }),
    ).toBeVisible();
    await expect(
      noJs.locator('[data-filter-passport="mobile-trigger"]'),
    ).toBeHidden();
    const noJsForm = noJs.locator('[data-filter-passport="no-js"]');
    await expect(noJsForm).toBeVisible();
    await expect(
      noJsForm.getByRole('checkbox', { name: t.filters.immediate }),
    ).toBeChecked();
    // #795: każda wartość wielokrotnego filtra ma WŁASNY, niezależny checkbox — zestaw
    // z adresu jest w pełni edytowalny (dopisanie/usunięcie pojedynczej wartości), a nie
    // tylko zachowywany w całości jako jedna opcja.
    for (const key of ['construction', 'transport'] as const) {
      await expect(
        noJsForm.getByRole('checkbox', { name: t.categories[key], exact: true }),
      ).toBeChecked();
    }
    await expect(
      noJsForm.getByRole('checkbox', { name: t.categories.warehouse, exact: true }),
    ).not.toBeChecked();
    for (const key of ['permanent', 'temporary'] as const) {
      await expect(
        noJsForm.getByRole('checkbox', { name: t.contractTypes[key], exact: true }),
      ).toBeChecked();
    }
    await noJsForm
      .getByRole('checkbox', { name: t.filters.noLanguageRequired, exact: true })
      .check();
    await noJsForm.locator('button[type="submit"]').click();
    await expect(noJs).toHaveURL(/(?:\?|&)noLang=1(?:&|$)/);
    await noJs.waitForLoadState('domcontentloaded');
    await expect(noJs.locator('html')).toBeAttached();
    const submittedParams = new URL(noJs.url()).searchParams;
    // #795: kategoria/lokalizacja/rodzaj umowy/zakwaterowanie mają teraz WŁASNY checkbox na
    // wartość, więc natywny GET wysyła je jako powtórzony klucz (`category=a&category=b`),
    // nie jako jedną wartość CSV — dokładnie to samo koduje przeglądarka dla realnych
    // checkboxów, a `flattenSearchParams` łączy je z powrotem po stronie serwera. Kolejność
    // checkboxów w DOM (alfabetyczna dla lokalizacji) może różnić się od kolejności w adresie
    // startowym, więc porównanie jest niewrażliwe na kolejność (zestaw, nie CSV).
    const submittedSet = (key: string): string[] =>
      [...submittedParams.getAll(key)].sort();
    // #189: formularz pokazuje i odsyła miasta pod nazwą w języku strony (to samo miasto).
    const expectedSubmitted = new URLSearchParams(expectedNoJsParams);
    expectedSubmitted.set(
      'location',
      `${t.locations['brussels']},${t.locations['antwerp']}`,
    );
    for (const [key, value] of expectedSubmitted) {
      expect(submittedSet(key), key).toEqual(value.split(',').sort());
    }
    expect(submittedSet('noLang')).toEqual(['1']);
    await expectNoHorizontalOverflow(noJs);
    await noJsContext.close();
  });
}

test('kontrola ujemna wykrywa zbyt mały cel filtra', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/pl/oferty-pracy');
  const rail = page.locator('[data-filter-passport="desktop"]');
  await expectTargetsAtLeast48(rail);

  const mutation = await page.addStyleTag({
    content:
      '[data-filter-target="checkbox-label"]{height:24px!important;min-height:0!important}',
  });
  await expect
    .poll(async () =>
      (await undersizedTargets(rail)).some(
        ({ target, height }) => target === 'checkbox-label' && height < 48,
      ),
    )
    .toBe(true);

  await mutation.evaluate((node) => (node as Element).remove());
  await expectTargetsAtLeast48(rail);
});
