import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * #492 — deklaracja progu wieku przy rejestracji kandydata (osobny komponent
 * `AgeDeclarationField`, obok zgody z #493). Sprawdza w 4 językach:
 * - etykieta „mam co najmniej {age} lat” z progiem z serwera (bez bazy = 18) i podpowiedź,
 *   że nie pytamy o datę urodzenia; pole wymagane (`aria-required`);
 * - bez deklaracji: błąd przy polu, fokus na deklaracji, żadne żądanie nie wychodzi;
 * - z deklaracją: akcja dostaje sam próg (`ageConfirmed`, `minAge`), bez daty urodzenia;
 * - rejestracja pracodawcy nie ma deklaracji wieku kandydata.
 * Kontrola ujemna (lokalnie): bez `AgeDeclarationField` w AuthForm test „bez deklaracji” pada.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof LOCALES)[number];
type Messages = { auth: { ageConfirm: string; ageConfirmHint: string; error: { ageConfirmRequired: string } } };

function msgs(locale: Locale): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;
}

async function fillCandidate(page: Page): Promise<void> {
  await page.locator('#firstName').fill('Jan');
  await page.locator('#lastName').fill('Kowalski');
  await page.locator('#email').fill('jan@example.com');
  await page.locator('#password').fill('Haslo1234');
  await page.locator('#passwordConfirm').fill('Haslo1234');
  await page.locator('#agreeTerms').press('Space');
}

/** Akcje serwera rejestracji — przechwycone (500), więc test nie zależy od bazy. */
function captureActions(page: Page, path: string): string[] {
  const bodies: string[] = [];
  void page.route(`**${path}`, async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postData() ?? '');
      await route.fulfill({ status: 500, body: '' });
      return;
    }
    await route.continue();
  });
  return bodies;
}

for (const locale of LOCALES) {
  test(`/${locale}/rejestracja: deklaracja wieku wymagana, do serwera idzie sam próg`, async ({ page }) => {
    const t = msgs(locale);
    const path = `/${locale}/rejestracja`;
    const bodies = captureActions(page, path);
    await page.goto(path);

    const age = page.getByRole('checkbox', { name: t.auth.ageConfirm.replace('{age}', '18') });
    await expect(age).toBeVisible();
    await expect(age).toHaveAttribute('aria-required', 'true');
    await expect(age).toHaveAccessibleDescription(t.auth.ageConfirmHint);

    await fillCandidate(page);
    await page.locator('form button[type="submit"]').click();
    await expect(age).toHaveAttribute('aria-invalid', 'true');
    await expect(age).toBeFocused();
    await expect(age).toHaveAccessibleDescription(`${t.auth.ageConfirmHint} ${t.auth.error.ageConfirmRequired}`);
    expect(bodies).toHaveLength(0);

    await age.press('Space');
    await page.locator('form button[type="submit"]').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toContain('"ageConfirmed":true');
    expect(bodies[0]).toContain('"minAge":18');
    expect(bodies[0]).not.toMatch(/birth/i);
  });
}

test('rejestracja pracodawcy nie ma deklaracji wieku kandydata', async ({ page }) => {
  await page.goto('/pl/rejestracja-pracodawca');
  await expect(page.locator('#agreeTerms')).toBeVisible();
  await expect(page.locator('#ageConfirmed')).toHaveCount(0);
});
