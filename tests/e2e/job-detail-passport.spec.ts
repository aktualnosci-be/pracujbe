import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];

type Messages = {
  jobs: {
    passport: {
      location: string;
      salary: string;
      conditions: string;
    };
    applyNow: string;
    saveUnavailable: string;
  };
  apply: {
    demoJobTitle: string;
    demoJobBody: string;
    close: string;
  };
};

const DEMO_JOB_SLUG = "warehouse-worker-antwerp-1001";

function messages(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src", "messages", `${locale}.json`),
      "utf-8",
    ),
  ) as Messages;
}

async function setNecessaryConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
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
        id: "job-detail-passport-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

test.beforeEach(async ({ context }) => {
  // Ten plik sprawdza paszport oferty, więc każdy test zaczyna od jawnego,
  // ważnego stanu zgody. Zachowanie banera bez zgody pilnuje smoke.spec.ts.
  await setNecessaryConsent(context);
});

async function stableDemoJobDetail(page: Page, locale: Locale): Promise<void> {
  await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}$`),
  );
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right >
          document.documentElement.clientWidth + 1,
      )
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className),
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));

  expect(
    dimensions.document,
    JSON.stringify(dimensions.offenders, null, 2),
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

for (const locale of locales) {
  test(`paszport szczegółu zachowuje dane i akcje na 320 px: ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await stableDemoJobDetail(page, locale);

    const t = messages(locale);
    const passport = page.getByTestId("job-detail-passport");
    await expect(passport).toBeVisible();
    await expect(passport.getByRole("heading", { level: 1 })).toBeVisible();

    const labels = passport.locator("dt");
    await expect(labels).toHaveText([
      t.jobs.passport.location,
      t.jobs.passport.salary,
      t.jobs.passport.conditions,
    ]);
    await expect(passport.locator("dd")).toHaveCount(3);

    // Demo dowodzi połączenia kontrolek z detalem, ale nie trwałości sesji/RLS.
    // Te ścieżki mają osobne testy akcji/integracji; tutaj nie wykonujemy mutacji.
    const save = page
      .getByRole("button", { name: t.jobs.saveUnavailable })
      .last();
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(save).not.toHaveAttribute("aria-pressed");

    const matchSlot = page.getByTestId("job-match-slot");
    await expect(matchSlot).toBeAttached();
    await expect(matchSlot.getByRole("progressbar")).toHaveCount(0);

    const apply = page.getByRole("button", { name: t.jobs.applyNow }).last();
    await expect(apply).toBeVisible();
    await expect(apply).toBeEnabled();
    await apply.click();
    // Oferta demo (#297): dialog mówi, że oferta jest przykładowa, zamiast formularza.
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: t.apply.demoJobTitle }),
    ).toBeVisible();
    await expect(dialog).toContainText(t.apply.demoJobBody);
    await expect(dialog.locator("#apply-phone")).toHaveCount(0);
    await dialog.getByRole("button", { name: t.apply.close }).click();
    await expect(dialog).toBeHidden();
    await expectNoDocumentOverflow(page);
  });
}

test("paszport szczegółu ma trzy czytelne kolumny na desktopie", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stableDemoJobDetail(page, "pl");

  const passport = page.getByTestId("job-detail-passport");
  const fields = passport.locator("dl > div");
  await expect(fields).toHaveCount(3);

  const boxes = await fields.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: Math.round(box.top), width: Math.round(box.width) };
    }),
  );
  expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
  for (const box of boxes) expect(box.width).toBeGreaterThan(150);
  await expectNoDocumentOverflow(page);
});
