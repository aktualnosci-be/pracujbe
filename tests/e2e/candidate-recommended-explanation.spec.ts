import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from './fixtures/axe';
import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Polecane oferty: krótkie wyjaśnienie zapisanego dopasowania i stan własnego zgłoszenia
 * (tryb demo — `demoRecommended`: karta 1 = 3/3 wymagań + dwa atuty + zgłoszenie `demo-app-0`,
 * karta 2 = bez zgłoszenia). Teksty z `src/messages`, bez pozycji przycisków.
 */

type Msgs = {
  dashboard: {
    navRecommended: string;
    recommendedApplied: string;
    candidateApplicationDetailsLink: string;
    candidateApplicationDetailsLinkLabel: string;
  };
  match: {
    summaryShort: Record<'good' | 'partial' | 'low', string>;
    mandatory: string;
    strengthsTitle: string;
    criteria: Record<string, string>;
  };
};

function msgs(locale: string): Msgs {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Msgs;
}

function icu(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

for (const locale of LOCALES) {
  test(`polecane ${locale}: wyjaśnienie dopasowania i „już aplikowałeś” z linkiem do zgłoszenia`, async ({ page }) => {
    const m = msgs(locale);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/${locale}/candidate/oferty-polecane`);

    const cards = page.getByRole('list', { name: m.dashboard.navRecommended, exact: true }).getByRole('listitem').filter({
      has: page.locator('article'),
    });
    await expect(cards).toHaveCount(5);

    const first = cards.filter({ hasText: m.match.summaryShort.good }).filter({
      hasText: icu(m.match.mandatory, { met: 3, total: 3 }),
    });
    await expect(first).toHaveCount(1);
    const strengths = first.getByRole('list', { name: m.match.strengthsTitle });
    await expect(strengths.getByRole('listitem')).toHaveText([
      m.match.criteria.allMandatorySkills!,
      m.match.criteria.localCandidate!,
    ]);
    await expect(first.getByText(m.dashboard.recommendedApplied, { exact: true })).toBeVisible();

    // Karta bez zgłoszenia nie udaje zgłoszenia.
    const second = cards.filter({ hasText: icu(m.match.mandatory, { met: 2, total: 2 }) });
    await expect(second).toHaveCount(1);
    await expect(second.getByText(m.dashboard.recommendedApplied, { exact: true })).toHaveCount(0);

    const title = (await first.getByRole('heading', { level: 3 }).innerText()).trim();
    const details = first.getByRole('link', {
      name: icu(m.dashboard.candidateApplicationDetailsLinkLabel, { job: title }),
      exact: true,
    });
    await expect(details).toHaveAttribute('href', `/${locale}/candidate/aplikacje/demo-app-0`);

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // Link leży nad nakładką linku tytułu — kliknięcie prowadzi do zgłoszenia, nie do oferty.
    await details.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/candidate/aplikacje/demo-app-0$`));
  });
}
