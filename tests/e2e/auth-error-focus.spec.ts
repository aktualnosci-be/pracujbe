import { expect, test, type Page } from '@playwright/test';

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

const forms: ReadonlyArray<{ path: string; fill: (page: Page) => Promise<void> }> = [
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
      await page.locator('#agreeTerms').press('Space');
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
    fill: async (page) => {
      await page.locator('#password').fill('Haslo1234');
      await page.locator('#passwordConfirm').fill('Haslo1234');
    },
  },
];

for (const { path, fill } of forms) {
  test(`po błędzie wysyłki fokus jest na komunikacie: ${path}`, async ({ page }) => {
    await failServerActions(page, path);
    await page.goto(path);
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
