import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const viewports = [
  { width: 320, height: 800 },
  { width: 640, height: 900 }, // 1280 px at 200% browser zoom
] as const;

for (const locale of locales) {
  for (const viewport of viewports) {
    test(`firma pracodawcy pozostaje czytelna: ${locale}, ${viewport.width} px`, async ({
      page,
    }) => {
      const messages = JSON.parse(
        readFileSync(
          resolve(process.cwd(), 'src', 'messages', `${locale}.json`),
          'utf8',
        ),
      ) as {
        company: {
          title: string;
          detailsTitle: string;
          editTitle: string;
          submitSave: string;
        };
      };

      await page.setViewportSize(viewport);
      await page.context().addCookies([
        {
          name: 'pracujbe_consent',
          value: JSON.stringify({
            v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
            categories: {
              necessary: true,
              preferences: false,
              analytics: false,
              marketing: false,
            },
            ts: '2026-01-01T00:00:00.000Z',
            id: 'company-passport-e2e',
          }),
          url: 'http://localhost:3000',
          sameSite: 'Lax',
        },
      ]);
      await page.goto(`/${locale}/employer/firma`);

      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        main.getByRole('heading', {
          name: messages.company.detailsTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        main.getByRole('heading', {
          name: messages.company.editTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        main.getByRole('button', { name: messages.company.submitSave }),
      ).toBeVisible();
      const save = main.getByRole('button', {
        name: messages.company.submitSave,
      });
      const box = await save.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(48);
      await main.getByRole('textbox', { name: messages.company.name }).focus();
      await expect(
        main.getByRole('textbox', { name: messages.company.name }),
      ).toBeFocused();

      const width = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(width.page).toBeLessThanOrEqual(width.viewport + 1);
    });
  }
}
