import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';
import type { Messages as AppMessages } from './fixtures/messages';

/**
 * Lista ofert panelu admina `/admin/oferty` w trybie DEMO (bez bazy): pozycja w menu, filtr
 * „zablokowane decyzją” (tylko oferty z decyzją moderacyjną — kontrola ujemna: pozostałe znikają),
 * link „Wszystkie oferty firmy” ze szczegółu firmy → lista zawężona do tej firmy z nagłówkiem
 * filtra i linkiem do wszystkich firm. Dane demo są oznaczone i nie linkują do stron publicznych.
 * Axe na tych trasach: `admin-a11y.spec.ts`. Kontrola roli admina: unit `admin-jobs.test.ts`.
 */

type Admin = AppMessages['admin'];

function admin(locale: string): Admin {
  return (JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { admin: Admin }).admin;
}

for (const locale of LOCALES) {
  const t = admin(locale);

  test(`admin: lista ofert — menu, filtr decyzji moderacyjnych (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: t.navJobs, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/oferty$`));
    await expect(page.getByRole('heading', { level: 1, name: t.jobsTitle })).toBeVisible();

    const table = page.getByRole('table');
    const rowsAll = await table.getByRole('row').count();
    expect(rowsAll).toBeGreaterThan(2);
    await expect(table.getByText(t.jobsDemoTag).first()).toBeVisible();
    // Dane demo nie prowadzą do publicznych stron ofert.
    await expect(table.locator('a[href*="/oferty-pracy/"]')).toHaveCount(0);

    await page.getByRole('link', { name: t.jobsFilterModerated }).click();
    await expect(page).toHaveURL(/status=moderated/);
    await expect(page.getByRole('link', { name: t.jobsFilterModerated })).toHaveAttribute('aria-current', 'true');
    const moderatedRows = table.getByRole('row');
    // Nagłówek + jedna oferta z decyzją moderacyjną.
    await expect(moderatedRows).toHaveCount(2);
    await expect(table.getByText(t.jobsModeratedTag)).toBeVisible();
  });

  test(`admin: „Wszystkie oferty firmy” → lista zawężona do firmy (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin/firmy/demo-c2`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: t.companyJobsAllLink }).click();
    await expect(page).toHaveURL(/\/admin\/oferty\?firma=demo-c2$/);
    await expect(
      page.getByText(t.jobsCompanyFilter!.replace('{name}', 'Bouwbedrijf De Vos')),
    ).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'Bouwbedrijf De Vos' }).first()).toBeVisible();
    await expect(table.getByRole('link', { name: 'AGO Jobs & HR' })).toHaveCount(0);

    await page.getByRole('link', { name: t.jobsCompanyFilterClear }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/oferty$`));
    await expect(table.getByRole('link', { name: 'AGO Jobs & HR' }).first()).toBeVisible();
  });
}
