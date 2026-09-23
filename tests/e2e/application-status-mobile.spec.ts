import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const CASES = [
  { locale: 'pl', consent: 'Tylko niezbędne' },
  { locale: 'nl', consent: 'Alleen noodzakelijke' },
  { locale: 'fr', consent: 'Uniquement nécessaires' },
  { locale: 'en', consent: 'Only necessary' },
] as const;

type Messages = { dashboard: Record<string, string>; status: Record<string, string> };

function fill(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);
}

for (const { locale, consent } of CASES) {
  test(`menu statusu aplikacji: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/aplikacje`);
    await page.getByRole('button', { name: consent }).click();

    const messages = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8'),
    ) as Messages;
    // Drugi rekord demonstracyjny: Katarzyna Zielińska — Operator wózka widłowego, status `viewed`.
    // Nazwa triggera niesie kandydata, ofertę i bieżący status (#333).
    const labelParams = {
      name: 'Katarzyna Zielińska',
      job: 'Operator wózka widłowego',
      status: messages.status.viewed!,
    };
    const statusButton = page.getByRole('button', {
      name: fill(messages.dashboard.statusMenuTrigger!, labelParams),
      exact: true,
    });
    const box = await statusButton.boundingBox();
    expect(box, 'Przycisk zmiany statusu powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Przycisk zmiany statusu powinien mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    await statusButton.click();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('list', {
      name: fill(messages.dashboard.statusMenuOptions!, labelParams),
      exact: true,
    });
    await expect(panel).toBeVisible();
    // Z `viewed` macierz DB dopuszcza: shortlisted, interview, rejected, hired (#306).
    const options = panel.getByRole('button');
    await expect(options).toHaveText(
      ['shortlisted', 'interview', 'rejected', 'hired'].map((key) => messages.status[key]!),
    );
    for (const statusOption of await options.all()) {
      const itemBox = await statusOption.boundingBox();
      expect(itemBox, 'Każda opcja statusu powinna być widoczna i mierzalna.').not.toBeNull();
      expect(itemBox!.height, 'Każda opcja statusu powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);
    }
    await expect(panel.getByRole('button', { name: messages.status.viewed!, exact: true })).toHaveCount(0);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Otwarty panel nie powinien przewijać strony poziomo.').toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'false');
    await expect(statusButton).toBeFocused();

    await statusButton.click();
    await expect(panel).toBeVisible();
    await statusButton.click();
    await expect(panel).toBeHidden();
  });
}
