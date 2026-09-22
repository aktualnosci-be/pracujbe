import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

const locales = ['pl', 'nl', 'fr', 'en'] as const;

type Locale = (typeof locales)[number];
type Messages = { messages: { back: string; title: string } };

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), 'src', 'messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf-8')) as Messages;
}

for (const locale of locales) {
  test(`powrót z wiadomości ma 48 px i nie przepełnia ekranu 320 px: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);
    const listPath = `/${locale}/candidate/wiadomosci`;

    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`${listPath}?c=demo-conv-0`);

    const backLink = page.getByRole('link', {
      name: t.messages.back,
      exact: true,
    });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', listPath);

    const measurements = await backLink.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;

      return {
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        linkScrollWidth: element.scrollWidth,
        linkClientWidth: element.clientWidth,
      };
    });

    expect(measurements.height).toBeGreaterThanOrEqual(48);
    expect(measurements.left).toBeGreaterThanOrEqual(-1);
    expect(measurements.right).toBeLessThanOrEqual(
      measurements.viewportWidth + 1,
    );
    expect(measurements.linkScrollWidth).toBeLessThanOrEqual(
      measurements.linkClientWidth + 1,
    );
    expect(measurements.documentWidth).toBeLessThanOrEqual(
      measurements.viewportWidth + 1,
    );

    const mutatingRequests: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutatingRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`${listPath}/?$`));
    await expect(
      page.getByRole('heading', { level: 1, name: t.messages.title }),
    ).toBeVisible();
    await expect(backLink).toBeHidden();
    expect(mutatingRequests).toEqual([]);
  });
}
