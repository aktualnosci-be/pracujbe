import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import AxeBuilder from './fixtures/axe';
import { LOCALES } from './fixtures/messages';

/**
 * „Aplikuj u pracodawcy” (#1130, epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * job-detail-employer-apply`. Domyślny przebieg (serwer `RECRUITMENT`, #1136) pomija ten plik —
 * `ApplyModal` pokrywają istniejące specy (`apply-*`, `job-detail-cta-bar`, `guest-apply`).
 *
 * Oferty demo mają kanały w domenie example.com (#1129): 1002 = strona, 1001 = e-mail + telefon.
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const URL_JOB = 'bricklayer-brussels-1002';
const EMAIL_PHONE_JOB = 'warehouse-worker-antwerp-1001';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

type Texts = {
  jobs: { applyNow: string };
  job: { sendMessage: string; employerApply: { button: string; boxTitle: string } };
};
const texts = (locale: string): Texts =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Texts;

async function expectNoBlockingAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
  const summary = blocking.map((v) => `- [${v.impact}] ${v.id}: ${v.nodes[0]?.target.join(' ')}`).join('\n');
  expect(blocking, summary).toEqual([]);
}

async function expectNoRecruitmentCtas(page: Page, t: Texts): Promise<void> {
  await expect(page.getByRole('button', { name: t.jobs.applyNow })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: t.job.sendMessage })).toHaveCount(0);
}

for (const locale of LOCALES) {
  test(`1280 px: przycisk prowadzi na stronę ogłoszeniodawcy w nowej karcie (${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/oferty-pracy/${URL_JOB}`);
    const box = page.getByTestId('employer-apply-box');
    await expect(box.getByRole('heading', { name: t.job.employerApply.boxTitle })).toBeVisible();
    const primary = box.getByTestId('employer-apply-primary');
    await expect(primary).toBeVisible();
    await expect(primary).toContainText(t.job.employerApply.button);
    await expect(primary).toHaveAttribute('href', 'https://example.com/jobs/1002');
    await expect(primary).toHaveAttribute('target', '_blank');
    await expect(primary).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expectNoRecruitmentCtas(page, t);
    await expectNoBlockingAxe(page);
  });

  test(`1280 px: e-mail jako przycisk, telefon jako drugi sposób (${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/oferty-pracy/${EMAIL_PHONE_JOB}`);
    const box = page.getByTestId('employer-apply-box');
    const primary = box.getByTestId('employer-apply-primary');
    await expect(primary).toHaveAttribute('href', /^mailto:jobs\+1001@example\.com\?subject=/);
    await expect(primary).not.toHaveAttribute('target', /.*/);
    await expect(box.locator('a[href="tel:+32000000000"]')).toBeVisible();
    await expectNoRecruitmentCtas(page, t);
  });

  test(`320 px: pasek mobilny z kanałem ogłoszeniodawcy, bez naruszeń axe (${locale})`, async ({ page }) => {
    const t = texts(locale);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`/${locale}/oferty-pracy/${URL_JOB}`);
    const bar = page.getByTestId('job-mobile-cta-bar');
    const primary = bar.getByTestId('employer-apply-primary');
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', 'https://example.com/jobs/1002');
    await expect(primary).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    // Ramka z kanałami jest widoczna także na mobile (w panelu bocznym pod treścią).
    await expect(page.getByTestId('employer-apply-box')).toBeAttached();
    await expectNoRecruitmentCtas(page, t);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoBlockingAxe(page);
  });
}
