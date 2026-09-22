import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const viewports = [{ width: 320, height: 800 }, { width: 640, height: 900 }] as const;

for (const locale of locales) {
  for (const viewport of viewports) {
    test(`aplikacje pracodawcy: ${locale}, ${viewport.width} px`, async ({ page }) => {
      const messages = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf8')) as {
        dashboard: { navApplications: string; employerApplicationsCandidateLabel: string; employerApplicationsJobLabel: string; employerApplicationsDemo: string; colStatusEmp: string };
      };
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/employer/aplikacje`);

      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1, name: messages.dashboard.navApplications })).toBeVisible();
      await expect(main.getByText(messages.dashboard.employerApplicationsDemo)).toBeVisible();
      await expect(main.getByRole('list', { name: messages.dashboard.navApplications }).locator('li')).toHaveCount(4);
      await expect(main.getByText(messages.dashboard.employerApplicationsCandidateLabel, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(messages.dashboard.employerApplicationsJobLabel, { exact: true }).first()).toBeVisible();
      await expect(main.getByRole('button', { name: messages.dashboard.colStatusEmp }).first()).toBeVisible();

      const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    });
  }
}
