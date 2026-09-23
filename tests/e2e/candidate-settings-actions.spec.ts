import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Messages = {
  common: { cancel: string };
  dashboard: {
    add: string;
    checkSkills: string;
    rowActions: string;
    withdrawApplication: string;
    withdrawConfirmTitle: string;
    declineProposal: string;
    declineConfirmTitle: string;
    acceptProposal: string;
  };
  onboarding: { step3Title: string };
  settings: { title: string; inAppEnabledLabel: string };
};

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
}

async function dismissCookies(page: Page) {
  const banner = page.locator('[aria-labelledby="cookie-banner-title"] button').first();
  if (await banner.isVisible()) await banner.click();
}

for (const locale of LOCALES) {
  for (const path of ['profil', ''] as const) {
    test(`checklista ${path || 'pulpitu'} prowadzi do kroku kreatora (#317): ${locale}`, async ({ page }) => {
      const m = messages(locale);
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/${locale}/candidate${path ? `/${path}` : ''}`);
      await dismissCookies(page);

      const add = page.getByRole('link', { name: `${m.dashboard.add}: ${m.dashboard.checkSkills}` });
      await add.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/onboarding\\?step=3$`));
      await expect(page.getByRole('heading', { level: 2, name: m.onboarding.step3Title })).toBeVisible();
    });
  }

  test(`ustawienia nie pokazują nieczynnego push (#312): ${locale}`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/candidate/ustawienia`);
    await expect(page.getByRole('heading', { level: 1, name: m.settings.title })).toBeVisible();
    await expect(page.getByLabel(m.settings.inAppEnabledLabel)).toBeVisible();
    await expect(page.locator('#pref-pushEnabled')).toHaveCount(0);
  });
}

test('odrzucenie propozycji wymaga potwierdzenia, anulowanie niczego nie wysyła (#328)', async ({ page }) => {
  const m = messages('pl');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/candidate/propozycje');
  await dismissCookies(page);

  const decline = page.getByRole('button', { name: m.dashboard.declineProposal });
  await decline.click();
  const dialog = page.getByRole('alertdialog', { name: m.dashboard.declineConfirmTitle });
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: m.common.cancel });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(decline).toBeFocused();
  // Bez potwierdzenia nie było żądania — brak komunikatu błędu trybu demo.
  await expect(page.getByText('Coś poszło nie tak. Spróbuj ponownie.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('wycofanie aplikacji wymaga potwierdzenia i oddaje fokus „…” (#328)', async ({ page }) => {
  const m = messages('pl');
  await page.goto('/pl/candidate/aplikacje');
  await dismissCookies(page);

  const trigger = page.getByRole('button', { name: m.dashboard.rowActions }).first();
  await trigger.click();
  await page.getByRole('menuitem', { name: m.dashboard.withdrawApplication }).click();
  const dialog = page.getByRole('alertdialog', { name: m.dashboard.withdrawConfirmTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: m.common.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText('Coś poszło nie tak. Spróbuj ponownie.')).toHaveCount(0);
});
