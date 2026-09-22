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
  common: { cancel: string };
  dashboard: {
    addJob: string;
    navSummary: string;
    recommendedJobs: string;
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

test("kontrola ujemna wykrywa cofnięcie min-w-0 kolumny kandydata", async ({
  page,
}) => {
  await setNecessaryCookieConsent(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/pl/candidate");
  const repairedColumn = page
    .getByRole("main")
    .locator("div.grid.gap-6.lg\\:grid-cols-3 > div")
    .first();
  await expect(repairedColumn).toHaveClass(/min-w-0/);
  await expectNoHorizontalOverflow(page, "kontrola ujemna: stan początkowy");

  await repairedColumn.evaluate((element) =>
    element.classList.remove("min-w-0"),
  );
  const broken = await measureHorizontalOverflow(page);

  expect(broken.documentWidth).toBeGreaterThan(broken.viewportWidth + 1);
  expect(
    broken.offenders.some((offender) =>
      offender.className.includes("space-y-6"),
    ),
  ).toBe(true);

  await repairedColumn.evaluate((element) => element.classList.add("min-w-0"));
  await expectNoHorizontalOverflow(
    page,
    "kontrola ujemna: po przywróceniu min-w-0",
  );
});
