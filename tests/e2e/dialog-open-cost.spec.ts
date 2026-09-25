import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Regresja #393: otwarcie „Aplikuj teraz” i menu mobilnego nie może przeliczać stylów całej
 * strony. Tryb `modal` Radix wstrzykiwał arkusz blokady przewijania do <head> i ustawiał
 * `pointer-events: none` na <body> — obie zmiany unieważniały style całego dokumentu.
 * Test pilnuje mechanizmu (brak tych mutacji) i tego, że zachowanie modalne zostaje:
 * pułapka fokusu, Esc/nakładka zamykają z powrotem fokusu na wyzwalacz, przewijanie strony
 * zablokowane, a otwarcie nie przesuwa układu strony.
 */

const DEMO_JOB_PATH = "/pl/oferty-pracy/bricklayer-brussels-1002";
const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), "src", "messages", "pl.json"), "utf-8"),
) as { nav: { menu: string }; jobs: { applyNow: string } };

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: "2026-01-01T00:00:00.000Z",
        id: "dialog-open-cost-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
});

type Snapshot = { headStyles: number; bodyPointerEvents: string; headerLeft: number; headerWidth: number };

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const header = document.querySelector("header")!.getBoundingClientRect();
    return {
      headStyles: document.head.querySelectorAll("style").length,
      bodyPointerEvents: document.body.style.pointerEvents,
      headerLeft: header.left,
      headerWidth: header.width,
    };
  });
}

const cases = [
  {
    name: "ApplyModal",
    path: DEMO_JOB_PATH,
    viewport: { width: 1280, height: 900 },
    trigger: (page: Page) => page.getByRole("button", { name: pl.jobs.applyNow }).first(),
  },
  {
    name: "menu mobilne",
    path: "/pl/oferty-pracy",
    viewport: { width: 412, height: 823 },
    trigger: (page: Page) => page.getByRole("button", { name: pl.nav.menu }),
  },
];

for (const c of cases) {
  test(`${c.name}: otwarcie bez globalnych mutacji stylu, z zachowaniem modalnym`, async ({ page }) => {
    await page.setViewportSize(c.viewport);
    await page.goto(c.path);
    await page.evaluate(() => window.scrollTo(0, 200));
    // Zamknięte dialogi (np. centrum zgód w layoucie) niczego nie blokują.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
    await expect(page.locator("body > [data-aria-hidden]")).toHaveCount(0);
    const before = await snapshot(page);

    const trigger = c.trigger(page);
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const after = await snapshot(page);
    expect(after.headStyles, "brak arkusza wstrzykniętego do <head>").toBe(before.headStyles);
    expect(after.bodyPointerEvents, "brak pointer-events na <body>").toBe("");
    // Blokada przewijania nie przesuwa układu (np. przez zniknięcie paska przewijania).
    expect(after.headerLeft).toBe(before.headerLeft);
    expect(after.headerWidth).toBe(before.headerWidth);

    // Przewijanie strony pod dialogiem zablokowane.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
      .toBe("hidden");
    // Pozycję bierzemy po otwarciu: klik Playwrighta sam przewija do wyzwalacza.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(5, c.viewport.height - 5);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Pułapka fokusu: Tab i Shift+Tab nie wychodzą poza dialog.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    // Reszta strony ukryta przed czytnikami (jak w trybie modal).
    await expect(page.locator("body > [data-aria-hidden='true']").first()).toBeAttached();

    // Esc zamyka, fokus wraca na wyzwalacz, przewijanie odblokowane.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow))
      .not.toBe("hidden");

    // Klik w nakładkę zamyka i również oddaje fokus wyzwalaczowi.
    await trigger.click();
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const x = box!.x > 20 ? 5 : c.viewport.width - 5;
    await page.mouse.click(x, 5);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
