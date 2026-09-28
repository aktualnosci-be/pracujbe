import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * #843: link decyzji o firmie (e-mail/powiadomienie) niesie `?firma=<id>` firmy, której
 * DOTYCZY zdarzenie. Na danych DEMO (bez env, brak per-firmowego kontekstu — `getCompanyById`
 * zwraca `not_found`) sprawdzamy, że strona pokazuje jawny, bezpieczny stan „niedostępna",
 * a nie ciche dane innej (aktywnej) firmy ani surowy błąd.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const RANDOM_COMPANY_ID = '9b7f8e2c-1a4d-4e6b-8c3f-2d5a7e9b1c40';

function companyMessages(locale: string): {
  detailsTitle: string;
  targetUnavailableTitle: string;
  targetUnavailableHint: string;
} {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8'),
  ).company;
}

async function acceptConsent(page: import('@playwright/test').Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'employer-company-target-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

for (const locale of locales) {
  test(`?firma= obcej firmy pokazuje jawny stan niedostępności, nie dane aktywnej (${locale})`, async ({
    page,
  }) => {
    const t = companyMessages(locale);
    await acceptConsent(page);

    await page.goto(`/${locale}/employer/firma?firma=${RANDOM_COMPANY_ID}`);

    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: t.targetUnavailableTitle, exact: true }),
    ).toBeVisible();
    await expect(main.getByText(t.targetUnavailableHint)).toBeVisible();
    // Nigdy ciche podstawienie: sekcja danych aktywnej (demo) firmy nie renderuje się tutaj.
    await expect(
      main.getByRole('heading', { name: t.detailsTitle, exact: true }),
    ).not.toBeVisible();
  });

  test(`bez ?firma= strona firmy wygląda jak dotychczas, bez komunikatu (${locale})`, async ({
    page,
  }) => {
    const t = companyMessages(locale);
    await acceptConsent(page);

    await page.goto(`/${locale}/employer/firma`);

    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: t.detailsTitle, exact: true }),
    ).toBeVisible();
    // KONTROLA UJEMNA: bez parametru komunikat o niedostępności nie ma się pojawić —
    // gdyby gałąź `?firma=` uruchamiała się zawsze, ten test byłby czerwony.
    await expect(main.getByText(t.targetUnavailableHint)).not.toBeVisible();
  });
}
