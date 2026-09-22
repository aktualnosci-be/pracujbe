import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;

type Locale = (typeof locales)[number];

type Messages = {
  admin: { brandTag: string };
  common: { appName: string };
};

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

async function setNecessaryCookieConsent(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "1.0",
        categories: {
          necessary: true,
          preferences: false,
          analytics: false,
          marketing: false,
        },
        ts: "2026-01-01T00:00:00.000Z",
        id: "admin-sidebar-logo-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

async function expectNoHorizontalOverflow(
  page: Page,
  context: string,
): Promise<void> {
  const report = await page.evaluate(() => {
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
  const evidence = `${context}\n${JSON.stringify(report, null, 2)}`;

  expect(report.documentWidth, evidence).toBeLessThanOrEqual(
    report.viewportWidth + 1,
  );
  expect(report.offenders, evidence).toEqual([]);
}

for (const locale of locales) {
  test(`desktopowy sidebar admina pokazuje logo i podpis: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);
    await setNecessaryCookieConsent(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${locale}/admin`);

    const sidebar = page.getByRole("complementary");
    const logo = sidebar.getByRole("img", {
      name: t.common.appName,
      exact: true,
    });

    await expect(sidebar).toBeVisible();
    await expect(logo).toBeVisible();
    await expect(
      sidebar.getByText(t.admin.brandTag, { exact: true }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(
      page,
      `${locale}/admin: desktopowy sidebar`,
    );
  });
}

test("kontrola ujemna wykrywa brak dostępnej roli logo w sidebarze", async ({
  page,
}) => {
  const t = messages("pl");
  await setNecessaryCookieConsent(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/pl/admin");

  const sidebar = page.getByRole("complementary");
  const logo = sidebar.getByRole("img", {
    name: t.common.appName,
    exact: true,
  });
  await expect(logo).toBeVisible();

  await logo.evaluate((element) => element.removeAttribute("role"));
  await expect(
    sidebar.getByRole("img", { name: t.common.appName, exact: true }),
  ).toHaveCount(0);
});
