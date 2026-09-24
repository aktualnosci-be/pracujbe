import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type BrowserContext, type Locator } from '@playwright/test';

/**
 * #22 — wynagrodzenie na szczególe oferty i na karcie (dane demo):
 * - 1025 (ogrodnik): stawka godzinowa z groszami 14,50–16,75,
 * - 1026 (stażysta): tylko dolna granica → „od”,
 * - 1024 (brygadzista): bez kwoty → brak pola (kontrola ujemna: bez „do negocjacji”).
 * Liczby i waluta w locale strony. Tekst porównujemy dokładnie (NBSP z `Intl`).
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof locales)[number];

const NBSP = ' ';

const HOURLY: Record<Locale, string> = {
  pl: `14,50${NBSP}€ – 16,75${NBSP}€ brutto / godz.`,
  nl: `€${NBSP}14,50 – €${NBSP}16,75 bruto / uur`,
  fr: `14,50${NBSP}€ – 16,75${NBSP}€ brut / heure`,
  en: '€14.50 – €16.75 gross / hour',
};

const ONLY_MIN: Record<Locale, string> = {
  pl: `od 850${NBSP}€ brutto / mies.`,
  nl: `vanaf €${NBSP}850 bruto / maand`,
  fr: `à partir de 850${NBSP}€ brut / mois`,
  en: 'from €850 gross / month',
};

type Messages = { jobs: { passport: { location: string; salary: string; conditions: string } }; job: { salaryNotProvided?: string } };

function messages(locale: Locale): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;
}

async function setNecessaryConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'job-detail-salary-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

test.beforeEach(async ({ context }) => {
  await setNecessaryConsent(context);
});

async function exactText(locator: Locator): Promise<string> {
  return (await locator.textContent())?.trim() ?? '';
}

for (const locale of locales) {
  test(`szczegół: stawka z groszami, „od” i brak kwoty w locale strony: ${locale}`, async ({ page }) => {
    const t = messages(locale);

    await page.goto(`/${locale}/oferty-pracy/gardener-leuven-1025`);
    const hourly = page.getByTestId('job-detail-passport').locator('[data-passport-field="salary"]');
    await expect(hourly.locator('dt')).toHaveText(t.jobs.passport.salary);
    expect(await exactText(hourly.locator('dd'))).toBe(HOURLY[locale]);

    await page.goto(`/${locale}/oferty-pracy/logistics-intern-ghent-1026`);
    const onlyMin = page.getByTestId('job-detail-passport').locator('[data-passport-field="salary"] dd');
    expect(await exactText(onlyMin)).toBe(ONLY_MIN[locale]);

    // Kontrola ujemna: bez kwoty nie ma pola wynagrodzenia ani zastępczej deklaracji.
    await page.goto(`/${locale}/oferty-pracy/warehouse-supervisor-liege-1024`);
    const passport = page.getByTestId('job-detail-passport');
    await expect(passport.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(passport.locator('[data-passport-field="salary"]')).toHaveCount(0);
    await expect(passport.locator('dt')).toHaveText([t.jobs.passport.location, t.jobs.passport.conditions]);
    if (t.job.salaryNotProvided) await expect(passport).not.toContainText(t.job.salaryNotProvided);
  });
}

test('karta na liście ofert pokazuje tę samą kwotę co szczegół', async ({ page }) => {
  await page.goto('/pl/oferty-pracy?keyword=Ogrodnik');
  const card = page.locator('article').filter({ has: page.locator('a[href$="/gardener-leuven-1025"]') });
  await expect(card).toHaveCount(1);
  const salary = card.locator('dt', { hasText: messages('pl').jobs.passport.salary }).locator('xpath=following-sibling::dd');
  expect(await exactText(salary)).toBe(HOURLY.pl);
});
