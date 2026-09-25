import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Strona WWW i logo firmy (#112) — panel pracodawcy w trybie demo (bez bazy). Realny zapis,
 * autoryzację owner/admin, CHECK https i brak wpływu na weryfikację dowodzi
 * `supabase/tests/rls.sql` (sekcja CL162); tu: formularz, walidacja pól, fokus, a11y.
 */

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf8'),
) as {
  company: Record<string, string> & { error: Record<string, string> };
};

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'company-links-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
});

test('formularz strony WWW i logo: pola, walidacja i zapis w trybie demo (#112)', async ({ page }) => {
  const t = pl.company;
  await page.goto('/pl/employer/firma');
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { name: t.linksTitle, exact: true })).toBeVisible();
  const website = main.getByRole('textbox', { name: t.website });
  const logoUrl = main.getByRole('textbox', { name: t.logoUrl });
  await expect(website).toBeVisible();
  await expect(logoUrl).toBeVisible();

  const submit = main.getByRole('button', { name: t.linksSubmit });
  const box = await submit.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // Adres bez https:// — błąd przy polu, fokus na pierwszym błędzie (Invariant #11).
  await website.fill('http://firma-bez-https.example');
  await submit.click();
  await expect(website).toHaveAttribute('aria-invalid', 'true');
  await expect(website).toBeFocused();
  await expect(main.getByText(t.error.urlInvalid)).toBeVisible();

  // Poprawiony adres + logo → zapis (demo: sukces bez rzeczywistego backendu). Uwaga: baner
  // statusu firmy (`CompanyStatusBanner`) ma też `role="status"`, więc komunikat sukcesu
  // sprawdzamy po treści, nie po roli (kilka regionów `status` na stronie).
  await website.fill('https://www.firma-testowa.be');
  await logoUrl.fill('https://www.firma-testowa.be/logo.png');
  await submit.click();
  await expect(main.getByText(t.linksDemoNotice)).toBeVisible();
  await expect(website).toHaveValue('https://www.firma-testowa.be');
});

test('sekcja strony WWW i logo jest dostępna (axe, brak naruszeń critical/serious)', async ({ page }) => {
  await page.goto('/pl/employer/firma');
  await expect(
    page.getByRole('main').getByRole('heading', { name: pl.company.linksTitle, exact: true }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});
