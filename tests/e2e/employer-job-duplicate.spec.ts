import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

import { waitForHydrated } from './fixtures/hydration';

/**
 * „Kopiuj jako szkic” (0216) — tryb demo (bez bazy): przycisk przy każdej ofercie listy
 * pracodawcy (dowolny status), nazwa dostępna z tytułem oferty, kliknięcie prowadzi do
 * kreatora bez zapisu. Kopię w bazie, idempotencję, uprawnienia i odmowy dowodzi
 * `rls.sql` sekcja JD216, granicę akcji — `job-duplicate-draft.test.ts`.
 */

const MESSAGES = { pl, nl, fr, en } as const;

for (const [locale, m] of Object.entries(MESSAGES)) {
  test(`[${locale}] każda oferta ma „Kopiuj jako szkic” z tytułem w nazwie`, async ({ page }) => {
    await page.goto(`/${locale}/employer/oferty`);
    const main = page.getByRole('main');
    const buttons = main.getByRole('button', { name: m.dashboard.duplicateJob });
    // Tyle przycisków, ile kart ofert — także szkic i zamknięta.
    const cards = main.getByRole('list', { name: m.dashboard.navOffers }).getByRole('listitem');
    await expect(cards.first()).toBeVisible();
    await expect(buttons).toHaveCount(await cards.count());
  });
}

test('kliknięcie „Kopiuj jako szkic” otwiera kreator (demo bez zapisu)', async ({ page }) => {
  await page.goto('/pl/employer/oferty');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  const copy = page.getByRole('main').getByRole('button', {
    name: pl.dashboard.duplicateJobLabel.replace('{title}', 'Operator wózka widłowego'),
    exact: true,
  });
  await waitForHydrated(copy);
  await copy.click();
  await expect(page).toHaveURL(/\/pl\/employer\/oferty\/nowa$/);
  await expect(page.getByLabel(pl.jobWizard.titleLabel)).toBeVisible();
});

test('kontrola ujemna: nazwa przycisku nie jest wspólna dla wszystkich ofert', async ({ page }) => {
  await page.goto('/pl/employer/oferty');
  const main = page.getByRole('main');
  // Nazwa z tytułem odróżnia przyciski — dokładna nazwa bez tytułu nie pasuje do żadnego.
  await expect(main.getByRole('button', { name: pl.dashboard.duplicateJob, exact: true })).toHaveCount(0);
});

test('lista ofert z przyciskiem kopii bez naruszeń axe (320 px)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/employer/oferty');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking).toEqual([]);
});
