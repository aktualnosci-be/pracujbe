import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const pl = JSON.parse(readFileSync(resolve(process.cwd(), 'src/messages/pl.json'), 'utf-8')) as {
  auth: { confirmEmailSubmit: string };
};

/**
 * Po nieudanej wysyłce formularza uwierzytelniania fokus musi trafić na komunikat błędu,
 * a nie na <body> (WCAG 2.4.3). Awarię serwera wymuszamy przechwyceniem POST server action
 * (odpowiedź 500), więc test nie zależy od konfiguracji bazy ani trybu demo.
 */

async function failServerActions(page: Page, path: string): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, body: '' });
      return;
    }
    await route.continue();
  });
}

const forms: ReadonlyArray<{ path: string; hash?: string; fill: (page: Page) => Promise<void> }> = [
  {
    path: '/pl/logowanie',
    fill: async (page) => {
      await page.locator('#email').fill('jan@example.com');
      await page.locator('#password').fill('Haslo1234');
    },
  },
  {
    path: '/pl/rejestracja',
    fill: async (page) => {
      await page.locator('#firstName').fill('Jan');
      await page.locator('#lastName').fill('Kowalski');
      await page.locator('#email').fill('jan@example.com');
      await page.locator('#password').fill('Haslo1234');
      await page.locator('#passwordConfirm').fill('Haslo1234');
      await page.locator('#ageConfirmed-18').press('Space');
      await page.locator('#agreeTerms').press('Space');
      await page.locator('#privacyNoticeAck').press('Space');
    },
  },
  {
    path: '/pl/rejestracja-pracodawca',
    fill: async (page) => {
      await page.locator('#companyName').fill('Firma Test');
      await page.locator('#firstName').fill('Jan');
      await page.locator('#lastName').fill('Kowalski');
      await page.locator('#email').fill('jan@example.com');
      await page.locator('#password').fill('Haslo1234');
      await page.locator('#passwordConfirm').fill('Haslo1234');
      await page.locator('#agreeTerms').press('Space');
      await page.locator('#privacyNoticeAck').press('Space');
    },
  },
  {
    path: '/pl/reset-hasla',
    fill: async (page) => {
      await page.locator('#email').fill('jan@example.com');
    },
  },
  {
    path: '/pl/ustaw-nowe-haslo',
    // Token z linku e-mail jest we fragmencie (#24/#505) — bez niego formularza nie ma.
    hash: '#token=AbCdEfGhIjKlMnOpQrStUvWx',
    fill: async (page) => {
      await page.locator('#password').fill('Haslo1234');
      await page.locator('#passwordConfirm').fill('Haslo1234');
    },
  },
];

for (const { path, hash, fill } of forms) {
  test(`po błędzie wysyłki fokus jest na komunikacie: ${path}`, async ({ page }) => {
    await failServerActions(page, path);
    await page.goto(`${path}${hash ?? ''}`);
    await fill(page);

    // Wysyłka klawiaturą (Enter na przycisku) — ścieżka użytkownika klawiatury.
    await page.locator('form button[type="submit"]').press('Enter');

    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();

    // Wpisane dane zostają po błędzie.
    await expect(page.locator('form input[type="password"], form input[type="email"]').first()).not.toHaveValue('');
  });
}

test('komunikat z parametru ?error= nie przejmuje fokusu przy wejściu na stronę', async ({ page }) => {
  await page.goto('/pl/logowanie?error=INTERNAL');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).not.toBeFocused();
});

test('potwierdzenie adresu: po błędzie akcji fokus jest na komunikacie, przycisk wraca', async ({ page }) => {
  await failServerActions(page, '/pl/potwierdz-email');
  await page.goto('/pl/potwierdz-email#token=aaa.bbb.ccc');
  const button = page.locator('main').getByRole('button', { name: pl.auth.confirmEmailSubmit });
  await expect(button).toBeEnabled();
  await button.press('Enter');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(button).toBeEnabled();
});
