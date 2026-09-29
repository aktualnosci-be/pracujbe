import { expect, test, type Browser, type Page } from '@playwright/test';

import { messages } from './fixtures/messages';

/**
 * #1236: formularze z polami wrażliwymi (hasło, kod dostępu sprawy) nie mogą wysłać danych
 * w adresie URL, zanim React przejmie `onSubmit` (wolna sieć) albo gdy JS jest wyłączony.
 * Wzorzec #817 (`ContactForm`): `method="post"` na `<form>`, przycisk wysyłki zablokowany do
 * hydracji (bez JS — trwale, więc Enter w polu też nic nie wysyła) i komunikat w `<noscript>`.
 *
 * Kontrola ujemna: ten sam formularz z HTML-em bez `method="post"` i bez `disabled` na
 * przycisku (podmiana odpowiedzi serwera) wysyła hasło w query — test to wykrywa.
 */

const pl = messages('pl');
const auth = pl.auth!;
const report = pl.contentReport!;
const SECRET = 'Sekret-Haslo-123';
const CODE = 'SECRETCODE12';

interface FormCase {
  name: string;
  path: string;
  submit: string;
  /** Pola do wypełnienia: etykieta → wartość. */
  fields: Array<[string, string]>;
  /** Wartości, które nie mogą pojawić się w żadnym adresie żądania. */
  secrets: string[];
}

const CASES: FormCase[] = [
  {
    name: 'logowanie',
    path: '/pl/logowanie',
    submit: auth.submitLogin!,
    fields: [
      [auth.email!, 'ala@example.com'],
      [auth.password!, SECRET],
    ],
    secrets: [SECRET, 'ala%40example.com'],
  },
  {
    name: 'rejestracja kandydata',
    path: '/pl/rejestracja',
    submit: auth.submitRegister!,
    fields: [
      [auth.email!, 'ala@example.com'],
      [auth.password!, SECRET],
      [auth.passwordConfirm!, SECRET],
    ],
    secrets: [SECRET],
  },
  {
    name: 'rejestracja pracodawcy',
    path: '/pl/rejestracja-pracodawca',
    submit: auth.submitRegister!,
    fields: [
      [auth.email!, 'firma@example.com'],
      [auth.password!, SECRET],
      [auth.passwordConfirm!, SECRET],
    ],
    secrets: [SECRET],
  },
  {
    name: 'reset hasła',
    path: '/pl/reset-hasla',
    submit: auth.resetSubmit!,
    fields: [[auth.email!, 'ala@example.com']],
    secrets: ['ala%40example.com', 'ala@example.com'],
  },
  {
    name: 'sprawdzenie sprawy DSA',
    path: '/pl/zglos-tresc/sprawa',
    submit: report.lookupSubmit!,
    fields: [
      [report.caseNumberLabel!, 'DSA-ABCD-EFGH-IJKL-MNOP'],
      [report.accessCodeLabel!, CODE],
    ],
    secrets: [CODE],
  },
];

async function noJsPage(browser: Browser, baseURL: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'forms-no-js-e2e',
      }),
      url: baseURL,
      sameSite: 'Lax',
    },
  ]);
  return { page: await context.newPage(), close: () => context.close() };
}

function trackRequestUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

async function fillAndTrySubmit(page: Page, c: FormCase): Promise<void> {
  for (const [label, value] of c.fields) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  const lastLabel = c.fields[c.fields.length - 1]![0];
  // Enter w ostatnim polu = niejawna wysyłka (autouzupełnienie menedżera haseł + Enter).
  await page.getByLabel(lastLabel, { exact: true }).press('Enter');
  await page.getByRole('button', { name: c.submit, exact: true }).click({ force: true });
  await page.waitForTimeout(300);
}

for (const c of CASES) {
  test(`${c.name} bez JavaScriptu nie wysyła danych w adresie URL (#1236)`, async ({ browser, baseURL }) => {
    const { page, close } = await noJsPage(browser, baseURL!);
    const urls = trackRequestUrls(page);
    await page.goto(c.path);

    const submit = page.getByRole('button', { name: c.submit, exact: true });
    await expect(page.locator('form', { has: submit })).toHaveAttribute('method', 'post');
    await expect(submit).toBeDisabled();
    await expect(page.getByText(pl.common!.formJsRequired!, { exact: true })).toBeVisible();

    await fillAndTrySubmit(page, c);

    const url = new URL(page.url());
    expect(url.pathname).toBe(c.path);
    expect(url.search).toBe('');
    for (const secret of c.secrets) {
      expect(urls.filter((u) => u.includes(secret)), `żaden adres żądania nie zawiera ${secret}`).toEqual([]);
    }
    await close();
  });
}

test('kontrola ujemna: formularz bez method="post" i z aktywnym przyciskiem wysyła hasło w URL (#1236)', async ({
  browser,
  baseURL,
}) => {
  const { page, close } = await noJsPage(browser, baseURL!);
  const c = CASES[0]!;
  await page.route(
    (url) => url.pathname === c.path,
    async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replaceAll(' method="post"', '').replaceAll(' disabled=""', '');
      await route.fulfill({ response, body: html });
    },
  );
  const urls = trackRequestUrls(page);
  await page.goto(c.path);
  await expect(page.getByRole('button', { name: c.submit, exact: true })).toBeEnabled();

  await fillAndTrySubmit(page, c);

  expect(urls.some((u) => u.includes(`password=${SECRET}`)), 'bez naprawy hasło trafia do query').toBe(true);
  await close();
});

test('logowanie przed hydracją (opóźnione chunki JS) nie wysyła hasła w URL (#1236)', async ({ page }) => {
  let releaseChunks: () => void = () => undefined;
  const chunksReleased = new Promise<void>((resolve) => {
    releaseChunks = resolve;
  });
  await page.route('**/_next/static/chunks/**', async (route) => {
    await chunksReleased;
    await route.continue();
  });
  const urls = trackRequestUrls(page);
  await page.goto('/pl/logowanie', { waitUntil: 'domcontentloaded' });

  const submit = page.getByRole('button', { name: auth.submitLogin!, exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel(auth.email!, { exact: true }).fill('ala@example.com');
  await page.getByLabel(auth.password!, { exact: true }).fill(SECRET);
  await page.getByLabel(auth.password!, { exact: true }).press('Enter');
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe('');

  releaseChunks();
  // Po hydracji przycisk działa normalnie (akcja serwerowa, nie natywna wysyłka).
  await expect(submit).toBeEnabled();
  expect(urls.filter((u) => u.includes(SECRET))).toEqual([]);
});
