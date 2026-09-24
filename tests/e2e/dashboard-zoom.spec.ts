import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
const viewports = [
  { width: 640, height: 900, label: "200%" },
  { width: 320, height: 800, label: "320 px" },
] as const;

type Locale = (typeof locales)[number];

type Messages = {
  common: { appName: string; cancel: string; skipToContent: string };
  dashboard: {
    addJob: string;
    navSummary: string;
    recommendedJobs: string;
    myApplications: string;
    latestMessages: string;
    seeAll: string;
  };
  nav: { menu: string };
};

type OverflowReport = {
  documentWidth: number;
  viewportWidth: number;
  offenders: Array<{
    tag: string;
    id: string;
    className: string;
    left: number;
    right: number;
  }>;
};

type DashboardCase = {
  role: "candidate" | "employer";
  mainAction: (page: Page, t: Messages) => Locator;
};

const dashboards: readonly DashboardCase[] = [
  {
    role: "candidate",
    mainAction: (page, t) =>
      page
        .getByRole("heading", { name: t.dashboard.recommendedJobs })
        .locator("..")
        .getByRole("link", { name: t.dashboard.seeAll }),
  },
  {
    role: "employer",
    mainAction: (page, t) =>
      page.getByRole("link", { name: t.dashboard.addJob }),
  },
];

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

async function setNecessaryCookieConsent(page: Page): Promise<void> {
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "1.0",
    categories: {
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false,
    },
    ts: "2026-01-01T00:00:00.000Z",
    id: "dashboard-zoom-e2e",
  };

  await page.context().addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify(consent),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

async function measureHorizontalOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          (bounds.left < -1 || bounds.right > viewportWidth + 1)
        );
      })
      .slice(0, 10)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        };
      });

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      offenders,
    };
  });
}

async function expectNoHorizontalOverflow(
  page: Page,
  context: string,
): Promise<void> {
  const report = await measureHorizontalOverflow(page);
  const evidence = `${context}\n${JSON.stringify(report, null, 2)}`;

  expect(report.documentWidth, evidence).toBeLessThanOrEqual(
    report.viewportWidth + 1,
  );
  expect(report.offenders, evidence).toEqual([]);
}

async function expectBottomTabsDoNotOverlap(page: Page): Promise<void> {
  const tabs = page
    .locator("nav.fixed.inset-x-0.bottom-0")
    .locator(":scope > *");
  await expect(tabs).toHaveCount(5);

  const boxes = await tabs.evaluateAll((items) =>
    items.map((item) => {
      const bounds = item.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    }),
  );
  const viewportWidth = await page.evaluate(
    () => document.documentElement.clientWidth,
  );

  expect(boxes[0]?.left).toBeGreaterThanOrEqual(-1);
  expect(boxes.at(-1)?.right).toBeLessThanOrEqual(viewportWidth + 1);
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index - 1]!.right).toBeLessThanOrEqual(boxes[index]!.left + 1);
  }
}

for (const locale of locales) {
  for (const dashboard of dashboards) {
    for (const viewport of viewports) {
      test(`${dashboard.role} zachowuje reflow i fokus przy ${viewport.label}: ${locale}`, async ({
        page,
      }) => {
        const t = messages(locale);
        await setNecessaryCookieConsent(page);

        // Przy zoomie przeglądarki 200% ekran 1280 px daje aplikacji 640 CSS px.
        // 320 px dodatkowo pilnuje najmniejszej wspieranej szerokości.
        await page.setViewportSize(viewport);
        await page.goto(`/${locale}/${dashboard.role}`);

        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(dashboard.mainAction(page, t)).toBeVisible();
        await expect(
          page
            .getByRole("banner")
            .getByRole("img", { name: t.common.appName, exact: true }),
        ).toBeVisible();
        await expectNoHorizontalOverflow(
          page,
          `${locale}/${dashboard.role} (${viewport.label}): panel`,
        );
        if (viewport.width === 320) {
          await expectBottomTabsDoNotOverlap(page);
        }

        const menuTrigger = page
          .getByRole("button", { name: t.nav.menu, exact: true })
          .first();
        await page.evaluate(() =>
          (document.activeElement as HTMLElement)?.blur(),
        );
        // Pierwszy przystanek: „Przejdź do treści” (#389 — renderuje go [locale]/layout).
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("link", { name: t.common.skipToContent, exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(menuTrigger).toBeFocused();

        await menuTrigger.press("Enter");
        const drawer = page.getByRole("dialog", {
          name: t.nav.menu,
          exact: true,
        });
        await expect(drawer).toBeVisible();
        await expect(
          drawer.getByRole("link", {
            name: t.dashboard.navSummary,
            exact: true,
          }),
        ).toHaveAttribute("aria-current", "page");
        await expect(
          drawer.getByRole("button", { name: t.common.cancel, exact: true }),
        ).toBeFocused();
        await expectNoHorizontalOverflow(
          page,
          `${locale}/${dashboard.role} (${viewport.label}): otwarta nawigacja`,
        );

        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        await expect(menuTrigger).toBeFocused();
      });
    }
  }
}

test("długie nazwy w panelu kandydata są w całości widoczne bez przewijania poziomego", async ({
  page,
}) => {
  await setNecessaryCookieConsent(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/pl/candidate");
  const main = page.getByRole("main");
  const t = messages("pl").dashboard;
  const section = (name: string) => main.getByRole("heading", { name }).locator("../..");
  const labels = [
    section(t.recommendedJobs).locator("ul li:first-child a").first(),
    section(t.myApplications).locator("ul li:first-child a").first(),
    // Pozycja wiadomości to link do wątku (#340); tytuł rozmowy = pierwszy pogrubiony tekst.
    section(t.latestMessages).locator("ul li:first-child a span.font-semibold").first(),
  ];
  const longTitle = "Koordynator ds. obsługi międzynarodowych zamówień i procesów magazynowych w belgijskim centrum dystrybucji";
  for (const [index, title] of labels.entries()) {
    await expect(title).toBeVisible();
    await title.evaluate((element, value) => { element.textContent = value; }, longTitle);
    await expect(title).toHaveText(longTitle);
    await expectNoHorizontalOverflow(page, `długa nazwa w sekcji ${index}`);
    const wraps = await title.evaluate((element) => element.getBoundingClientRect().height > parseFloat(getComputedStyle(element).lineHeight) * 1.5);
    expect(wraps).toBe(true);
  }

  // Kontrola ujemna: dawna klasa obcinająca tekst powinna złamać asercję zawijania.
  await labels[0].evaluate((element) => { element.classList.remove("break-words"); element.classList.add("truncate"); });
  const truncated = await labels[0].evaluate((element) => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) * 1.5);
  expect(truncated).toBe(true);
});
