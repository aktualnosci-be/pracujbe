import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

import { openZoomController, ZOOM_EXTENSION_ARGS } from './fixtures/zoom-controller';


const titles = {
  pl: 'Twój profil zawodowy',
  en: 'Your work profile',
  fr: 'Votre profil professionnel',
  nl: 'Je werkprofiel',
} as const;
const emptyFields = { pl: 'Jeszcze nie podano', en: 'Not added yet', fr: 'Pas encore indiqué', nl: 'Nog niet ingevuld' } as const;
const emptyNames = { pl: 'Imię niepodane', en: 'First name not added', fr: 'Prénom non indiqué', nl: 'Geen voornaam opgegeven' } as const;

for (const [locale, title] of Object.entries(titles)) {
  for (const width of [320, 640]) {
    test(`paszport profilu ${locale} mieści się przy ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}/candidate/profil`);

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      const identity = page.getByTestId('candidate-identity');
      await expect(identity.getByRole('heading', { level: 2, name: emptyNames[locale as keyof typeof emptyNames] })).toBeVisible();
      await expect(identity).not.toContainText('Od zaraz');
      await expect(identity).not.toContainText('Michał Kowalski');
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page.locator(`a[href="/${locale}/candidate/onboarding"]`).first()).toBeVisible();
      await expect(page.getByText(emptyFields[locale as keyof typeof emptyFields]).first()).toBeVisible();
      await expect(page.getByText('0%', { exact: true }).first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'Profil nie powinien wymagać przewijania w poziomie.').toBeLessThanOrEqual(1);

      const box = await identity.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    });
  }
}

// #172: rzeczywiste powiększenie przeglądarki 200% (nie tylko węższy viewport).
for (const [locale, title] of Object.entries(titles)) {
  test(`paszport tożsamości ${locale} mieści się przy powiększeniu 200%`, async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'pracujbe-profile-zoom-'));
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: ZOOM_EXTENSION_ARGS,
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const zoomController = await openZoomController(context, page);
      const baseURL = test.info().project.use.baseURL;
      expect(baseURL).toBeTruthy();
      await page.goto(new URL(`/${locale}/candidate/profil`, baseURL).toString());
      const tabId = await zoomController.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((entry) => entry.url?.startsWith(url));
        if (!tab?.id) throw new Error('Profile tab missing');
        await chrome.tabs.setZoom(tab.id, 2);
        return tab.id;
      }, baseURL!);
      expect(await zoomController.evaluate((id) => chrome.tabs.getZoom(id), tabId)).toBe(2);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(640);

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      const identity = page.getByTestId('candidate-identity');
      await expect(identity.getByRole('heading', { level: 2, name: emptyNames[locale as keyof typeof emptyNames] })).toBeVisible();
      // Demo nie ma zapisanej dostępności ani zdjęcia — karta ich nie wymyśla.
      await expect(identity.getByTestId('candidate-identity-availability')).toHaveCount(0);
      await expect(identity.locator('img')).toHaveCount(0);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'Profil nie powinien wymagać przewijania w poziomie przy 200%.').toBeLessThanOrEqual(1);
      const box = await identity.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(641);
    } finally {
      await context.close();
      await rm(profileDir, { recursive: true, force: true });
    }
  });
}
