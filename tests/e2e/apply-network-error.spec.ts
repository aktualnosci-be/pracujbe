import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

/**
 * Regresja #360 (serwer fixture `playwright.applications-fixture.config.ts`: oferty fikcyjne
 * z formularzem aplikowania, bez bazy — od #297 zwykły tryb demo pokazuje komunikat zamiast
 * formularza): przerwane żądanie server action nie zostawia modalu w „Wysyłanie…”.
 * Przycisk wraca, pojawia się komunikat o połączeniu, dane zostają, a ponowienie wysyła ten sam
 * klucz idempotencji. Bez nieobsłużonego odrzucenia obietnicy w konsoli.
 * Kontrola ujemna: po usunięciu try/catch w ApplyModal przycisk zostaje „Wysyłanie…” i test pada.
 */

const DEMO_JOB_PATH = '/pl/oferty-pracy/bricklayer-brussels-1002';

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf-8'),
) as { apply: Record<string, string>; jobs: { applyNow: string } };

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'apply-network-error-e2e',
      }),
      url: baseURL!,
      sameSite: 'Lax',
    },
  ]);
});

test('przerwane żądanie: komunikat, aktywny przycisk, zachowane dane, ten sam klucz przy ponowieniu', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(DEMO_JOB_PATH);

  const bodies: string[] = [];
  let abort = true;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    // Tylko wywołanie applyToJob (inne akcje strony, np. odczyt sesji, idą normalnie).
    if (!request.headers()['next-action'] || !body.includes('"idempotencyKey"')) {
      return route.continue();
    }
    bodies.push(body);
    if (abort) return route.abort('connectionreset');
    return route.continue();
  });

  await page.getByRole('button', { name: pl.jobs.applyNow }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#apply-phone').fill('470123456');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: pl.apply.submit }).click();

  await expect(dialog.getByRole('alert')).toHaveText(pl.apply.errorNetwork);
  const submit = dialog.getByRole('button', { name: pl.apply.submit });
  await expect(submit).toBeEnabled();
  await expect(dialog.locator('#apply-phone')).toHaveValue('470123456');

  abort = false;
  await submit.click();
  // Demo: akcja zwraca „tryb demonstracyjny” — ważne, że żądanie doszło z tym samym kluczem.
  await expect(dialog.getByRole('alert')).toHaveText(pl.apply.demoUnavailable);

  expect(bodies).toHaveLength(2);
  const key = (body: string) => /"idempotencyKey":"([^"]+)"/.exec(body)?.[1];
  expect(key(bodies[0]!)).toBeTruthy();
  expect(key(bodies[1]!)).toBe(key(bodies[0]!));
  expect(pageErrors.filter((m) => m.includes('Failed to fetch'))).toEqual([]);
});
