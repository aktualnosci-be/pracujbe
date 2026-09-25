import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #393 — czas interakcji (INP) otwarcia „Aplikuj” i menu mobilnego.
 *
 * W ramce tapnięcia `LightDialog*` renderuje tylko nakładkę, a treść dialogu (Portal, Presence,
 * FocusScope, DismissableLayer, `hideOthers`) montuje się w osobnym zadaniu zaraz po
 * narysowaniu tej ramki.
 *
 * Test sprawdza na profilu mobilnym (412×823, dotyk):
 * - mechanizm: po obsłużeniu kliknięcia (wraz z synchroniczną pracą Reacta) nakładka już jest,
 *   a treści dialogu jeszcze nie ma;
 * - dostępność: dialog się otwiera, fokus trafia do środka, Esc zamyka i oddaje fokus
 *   wyzwalaczowi;
 * - czas: przy CPU 4× mediana `duration` zdarzenia (Event Timing) poniżej 200 ms — progu
 *   „dobrego” INP. Próg jest luźny wobec pomiaru (~60 ms), żeby nie migotał na runnerach CI,
 *   a łapie powrót do pracy całego dialogu w ramce tapnięcia (przed #393: 136–296 ms).
 */

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), "src", "messages", "pl.json"), "utf-8"),
) as { nav: { menu: string }; jobs: { applyNow: string } };

const VIEWPORT = { width: 412, height: 823 };
const INP_BUDGET_MS = 200;

test.use({ viewport: VIEWPORT, hasTouch: true, isMobile: true });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
        categories: { necessary: true, preferences: false, analytics: false },
        ts: "2026-01-01T00:00:00.000Z",
        id: "dialog-open-inp-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
});

const cases = [
  {
    name: "ApplyModal (dolny pasek)",
    path: "/pl/oferty-pracy/bricklayer-brussels-1002",
    trigger: (page: Page) =>
      page.getByTestId("job-mobile-cta-bar").getByRole("button", { name: pl.jobs.applyNow }),
  },
  {
    name: "menu mobilne",
    path: "/pl",
    trigger: (page: Page) => page.getByRole("button", { name: pl.nav.menu, exact: true }),
  },
];

/** Obserwuje pierwsze kliknięcie: stan DOM tuż po jego obsłużeniu i czas interakcji. */
async function armProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __probe: { overlay: boolean; dialog: boolean } | null;
      __clickDurations: number[];
    };
    w.__probe = null;
    w.__clickDurations = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.name === "click" && entry.interactionId) w.__clickDurations.push(entry.duration);
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
    // Faza bąbelkowania na window: po listenerze Reacta (root = document) i jego mikrozadaniach.
    window.addEventListener(
      "click",
      () => {
        w.__probe = {
          overlay: document.querySelector("body > [aria-hidden='true'][data-state='open']") !== null,
          dialog: document.querySelector("[role='dialog']") !== null,
        };
      },
      { once: true },
    );
  });
}

async function tap(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

for (const c of cases) {
  test(`${c.name}: nakładka w ramce tapnięcia, treść zaraz potem, fokus i Esc`, async ({ page }) => {
    await page.goto(c.path);
    const trigger = c.trigger(page);
    await expect(trigger).toBeVisible();
    await armProbe(page);

    await tap(page, trigger);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const probe = await page.evaluate(
      () => (window as unknown as { __probe: { overlay: boolean; dialog: boolean } | null }).__probe,
    );
    expect(probe, "nakładka już w ramce tapnięcia").toMatchObject({ overlay: true });
    expect(probe, "treść dialogu montuje się po narysowaniu ramki").toMatchObject({ dialog: false });

    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)), {
        message: "fokus w dialogu",
      })
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("body > [aria-hidden='true'][data-state]")).toHaveCount(0);
  });

  test(`${c.name}: czas interakcji otwarcia przy CPU 4× < ${INP_BUDGET_MS} ms`, async ({ context }) => {
    test.setTimeout(90_000);
    const durations: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      // Świeża karta na każdy pomiar: pierwsze otwarcie, bez rozgrzanego JIT.
      const page = await context.newPage();
      await page.goto(c.path);
      const trigger = c.trigger(page);
      await expect(trigger).toBeVisible();
      // Hydratacja i zadania startowe za nami — mierzymy samą interakcję.
      await page.evaluate(() => new Promise((done) => requestIdleCallback(() => done(null))));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await armProbe(page);
      await tap(page, trigger);
      await expect(page.getByRole("dialog")).toBeVisible();
      // Wpis Event Timing przychodzi asynchronicznie, po narysowaniu ramki.
      const read = () =>
        page.evaluate(() => (window as unknown as { __clickDurations: number[] }).__clickDurations);
      await expect
        .poll(async () => (await read()).length, { timeout: 2_000 })
        .toBeGreaterThan(0)
        .catch(() => {});
      const measured = await read();
      await cdp.detach();
      await page.close();
      // Poniżej progu 16 ms obserwator nie raportuje wpisu — to też mieści się w budżecie.
      durations.push(measured.length ? Math.max(...measured) : 0);
    }
    const median = [...durations].sort((a, b) => a - b)[1];
    test.info().annotations.push({ type: "inp-ms", description: durations.join(", ") });
    expect(median, `czasy: ${durations.join(", ")} ms`).toBeLessThan(INP_BUDGET_MS);
  });
}
