import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { routing } from "../../src/i18n/routing";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import nl from "../../src/messages/nl.json";
import pl from "../../src/messages/pl.json";
import { E2E_GA_MEASUREMENT_ID } from "./fixtures/trackers";

/**
 * Zgody na cookies — kategorie, wycofanie i wersja polityki w 4 językach (#349, Invariant #7).
 *
 * Build E2E ma testowe ID GA/Meta (playwright.config.ts), więc `Analytics` realnie renderuje
 * trackery po zgodzie. Każde żądanie do Google/Meta jest przechwytywane i kończone pustym
 * skryptem (`route.fulfill`) — liczymy je, nic nie wychodzi do dostawców. Dzięki pustej
 * odpowiedzi `fbq` zostaje kolejką (stub z inline skryptu Pixela), którą można odczytać.
 *
 * Baner jest w HTML z serwera, a skrypt w <head> (consent-boot.ts) ukrywa go przed
 * pierwszym malowaniem tylko przy ważnej zgodzie w bieżącej wersji polityki (#389).
 */

const messages = { pl, nl, fr, en } as const;

const CONSENT_COOKIE = "pracujbe_consent";
const POLICY_VERSION = process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "1.0";
const MAX_AGE_DAYS = 180;

const TRACKER_HOSTS =
  /^https:\/\/(www\.googletagmanager\.com|[a-z0-9.-]*google-analytics\.com|connect\.facebook\.net|www\.facebook\.com)\//;
const GTM_SCRIPT = 'script[src*="googletagmanager.com"]';
const META_SCRIPT = "script#meta-pixel";

// Skrypty `afterInteractive` wstrzykiwane są po hydratacji — „brak żądania" sprawdzamy w oknie.
const QUIET_WINDOW_MS = 3_000;

type Seen = { gtm: string[]; meta: string[] };

async function trackTrackerRequests(page: Page): Promise<Seen> {
  const seen: Seen = { gtm: [], meta: [] };
  await page.route(TRACKER_HOSTS, async (route) => {
    const url = route.request().url();
    if (
      url.includes("googletagmanager.com") ||
      url.includes("google-analytics.com")
    ) {
      seen.gtm.push(url);
    } else {
      seen.meta.push(url);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    });
  });
  return seen;
}

type ConsentCall = { categories: Record<string, boolean>; source: string };

/**
 * Wywołania Server Action `recordConsent` (serwerowy dowód zgody → RPC `record_consent`).
 * Next wysyła argumenty akcji jako tablicę JSON w ciele POST z nagłówkiem `next-action`.
 */
function trackConsentActions(page: Page): ConsentCall[] {
  const calls: ConsentCall[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return;
    let args: unknown;
    try {
      args = JSON.parse(request.postData() ?? "");
    } catch {
      return;
    }
    if (!Array.isArray(args) || typeof args[1] !== "string") return;
    const categories = args[0] as Record<string, boolean> | null;
    if (
      !categories ||
      typeof categories !== "object" ||
      !("necessary" in categories)
    )
      return;
    calls.push({ categories, source: args[1] });
  });
  return calls;
}

async function expectNoTrackers(page: Page, seen: Seen) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(seen.gtm, "żądania GA bez zgody na analitykę").toEqual([]);
  expect(seen.meta, "żądania Meta Pixel bez zgody na marketing").toEqual([]);
  await expect(page.locator(GTM_SCRIPT)).toHaveCount(0);
  await expect(page.locator(META_SCRIPT)).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { gtag?: unknown; fbq?: unknown };
      return { gtag: typeof w.gtag, fbq: typeof w.fbq };
    }),
  ).toEqual({ gtag: "undefined", fbq: "undefined" });
}

async function storeConsent(
  context: BrowserContext,
  baseURL: string,
  record: { v?: string; categories?: Record<string, boolean>; raw?: string },
) {
  const value =
    record.raw ??
    JSON.stringify({
      v: record.v ?? POLICY_VERSION,
      categories: record.categories,
      ts: new Date().toISOString(),
      id: "consent-categories-e2e",
    });
  await context.addCookies([
    {
      name: CONSENT_COOKIE,
      value: encodeURIComponent(value),
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
}

/** Widoczność banera w chwili DOMContentLoaded — przed hydratacją, po skrypcie z <head>. */
async function recordBannerAtDomReady(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.getElementById("cookie-banner");
      (
        window as unknown as { __bannerAtDomReady?: string }
      ).__bannerAtDomReady = banner
        ? getComputedStyle(banner).display
        : "missing";
    });
  });
}

const ALL = {
  necessary: true,
  preferences: true,
  analytics: true,
  marketing: true,
};
const NONE = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
};

for (const locale of routing.locales) {
  const m = messages[locale];
  const home = `/${locale}`;

  const banner = (page: Page) =>
    page.getByRole("region", { name: m.cookies.bannerTitle });
  const settings = (page: Page) =>
    page.getByRole("dialog", { name: m.cookies.settingsTitle });

  /** Z banera: „Dostosuj” → włączenie wskazanych kategorii → „Zapisz ustawienia”. */
  async function saveFromCustomize(
    page: Page,
    enable: Array<"analytics" | "marketing">,
  ) {
    await banner(page)
      .getByRole("button", { name: m.cookies.customize, exact: true })
      .click();
    const dialog = settings(page);
    await expect(dialog).toBeVisible();
    for (const key of ["preferences", "analytics", "marketing"] as const) {
      await expect(
        dialog.getByRole("switch", { name: m.cookies[`${key}Name`] }),
        "kategorie opcjonalne domyślnie wyłączone",
      ).toHaveAttribute("aria-checked", "false");
    }
    for (const key of enable) {
      const toggle = dialog.getByRole("switch", {
        name: m.cookies[`${key}Name`],
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
    }
    await dialog
      .getByRole("button", { name: m.cookies.save, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(banner(page)).toHaveCount(0);
  }

  test.describe(`zgody cookies (${locale})`, () => {
    test("przed zgodą i po „Tylko niezbędne” zero GA/Meta; zgoda zapisana na 180 dni i wysłana do serwera", async ({
      page,
      context,
    }) => {
      const seen = await trackTrackerRequests(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await expect(banner(page)).toBeVisible();
      await expectNoTrackers(page, seen);

      await banner(page)
        .getByRole("button", { name: m.cookies.rejectOptional, exact: true })
        .click();
      await expect(banner(page)).toHaveCount(0);
      await expectNoTrackers(page, seen);

      await expect
        .poll(() => calls.length, { message: "wywołanie recordConsent" })
        .toBe(1);
      expect(calls[0]).toEqual({ categories: NONE, source: "cookie_banner" });

      const cookie = (await context.cookies()).find(
        (c) => c.name === CONSENT_COOKIE,
      );
      expect(cookie, "cookie zgody").toBeDefined();
      const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(MAX_AGE_DAYS - 1);
      expect(days).toBeLessThanOrEqual(MAX_AGE_DAYS);
      expect(JSON.parse(decodeURIComponent(cookie!.value))).toMatchObject({
        v: POLICY_VERSION,
        categories: NONE,
      });

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(banner(page)).toBeHidden();
      await expectNoTrackers(page, seen);
    });

    test("centrum ustawień: tylko analityka → GA bez Meta Pixel (także po odświeżeniu)", async ({
      page,
    }) => {
      const seen = await trackTrackerRequests(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await saveFromCustomize(page, ["analytics"]);

      await expect
        .poll(() => seen.gtm.length, { message: "żądanie GA po zgodzie" })
        .toBeGreaterThan(0);
      expect(seen.gtm.some((url) => url.includes(E2E_GA_MEASUREMENT_ID))).toBe(
        true,
      );
      await page.waitForTimeout(QUIET_WINDOW_MS);
      expect(seen.meta, "Meta Pixel bez zgody na marketing").toEqual([]);
      await expect(page.locator(META_SCRIPT)).toHaveCount(0);

      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({
        categories: { ...NONE, analytics: true },
        source: "cookie_settings",
      });

      seen.gtm.length = 0;
      await page.reload();
      await expect
        .poll(() => seen.gtm.length, { message: "GA po powrocie" })
        .toBeGreaterThan(0);
      await page.waitForTimeout(QUIET_WINDOW_MS);
      expect(seen.meta).toEqual([]);
    });

    test("centrum ustawień: tylko marketing → Meta Pixel bez GA (także po odświeżeniu)", async ({
      page,
    }) => {
      const seen = await trackTrackerRequests(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await saveFromCustomize(page, ["marketing"]);

      await expect
        .poll(() => seen.meta.length, { message: "żądanie Meta po zgodzie" })
        .toBeGreaterThan(0);
      await page.waitForTimeout(QUIET_WINDOW_MS);
      expect(seen.gtm, "GA bez zgody na analitykę").toEqual([]);
      await expect(page.locator(GTM_SCRIPT)).toHaveCount(0);

      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({
        categories: { ...NONE, marketing: true },
        source: "cookie_settings",
      });

      seen.meta.length = 0;
      await page.reload();
      await expect
        .poll(() => seen.meta.length, { message: "Meta po powrocie" })
        .toBeGreaterThan(0);
      await page.waitForTimeout(QUIET_WINDOW_MS);
      expect(seen.gtm).toEqual([]);
    });

    test("wycofanie zgody ze stopki: trackery odwołane, cookies GA/Meta usunięte, po odświeżeniu zero żądań", async ({
      page,
      context,
    }) => {
      const seen = await trackTrackerRequests(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await banner(page)
        .getByRole("button", { name: m.cookies.acceptAll, exact: true })
        .click();
      await expect(banner(page)).toHaveCount(0);
      await expect.poll(() => seen.gtm.length).toBeGreaterThan(0);
      await expect.poll(() => seen.meta.length).toBeGreaterThan(0);

      // Cookies, które ustawiłyby prawdziwe skrypty GA/Meta (odpowiedzi dostawców są puste).
      await page.evaluate(() => {
        for (const name of ["_ga", "_ga_TEST000000", "_gid", "_fbp", "_fbc"]) {
          document.cookie = `${name}=1; Path=/`;
        }
      });

      await page
        .getByRole("contentinfo")
        .getByRole("button", { name: m.footer.cookieSettings, exact: true })
        .click();
      const dialog = settings(page);
      await expect(dialog).toBeVisible();
      for (const key of ["analytics", "marketing"] as const) {
        const toggle = dialog.getByRole("switch", {
          name: m.cookies[`${key}Name`],
        });
        await expect(toggle, "centrum pokazuje zapisaną zgodę").toHaveAttribute(
          "aria-checked",
          "true",
        );
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "false");
      }
      await dialog
        .getByRole("button", { name: m.cookies.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();

      await expect
        .poll(async () =>
          (await context.cookies())
            .map((c) => c.name)
            .filter((n) => /^_(ga|gid|fb)/.test(n)),
        )
        .toEqual([]);
      expect(
        await page.evaluate((gaId) => {
          const w = window as unknown as Record<string, unknown> & {
            fbq?: { queue?: unknown[][] };
          };
          return {
            gaDisabled: w[`ga-disable-${gaId}`],
            fbqRevoked: (w.fbq?.queue ?? []).some(
              (args) =>
                Array.from(args)[0] === "consent" &&
                Array.from(args)[1] === "revoke",
            ),
          };
        }, E2E_GA_MEASUREMENT_ID),
      ).toEqual({ gaDisabled: true, fbqRevoked: true });

      await expect.poll(() => calls.length).toBe(2);
      expect(calls).toEqual([
        { categories: ALL, source: "cookie_banner" },
        {
          categories: { ...ALL, analytics: false, marketing: false },
          source: "cookie_settings",
        },
      ]);

      seen.gtm.length = 0;
      seen.meta.length = 0;
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(banner(page)).toBeHidden();
      await expectNoTrackers(page, seen);
    });

    test("ważna zgoda w bieżącej wersji: baner ukryty przed hydratacją, trackery wg kategorii", async ({
      page,
      context,
      baseURL,
    }) => {
      await storeConsent(context, baseURL!, {
        categories: { ...NONE, analytics: true },
      });
      const seen = await trackTrackerRequests(page);
      await recordBannerAtDomReady(page);
      await page.goto(home);

      expect(
        await page.evaluate(
          () => (window as { __bannerAtDomReady?: string }).__bannerAtDomReady,
        ),
      ).toBe("none");
      await expect(banner(page)).toHaveCount(0);
      await expect.poll(() => seen.gtm.length).toBeGreaterThan(0);
      await page.waitForTimeout(QUIET_WINDOW_MS);
      expect(seen.meta).toEqual([]);
    });

    for (const [label, record] of [
      [
        "zgoda na wszystko w starej wersji polityki",
        { v: `${POLICY_VERSION}-stara`, categories: ALL },
      ],
      [
        "uszkodzone cookie zgody",
        { raw: '{"v":"' + POLICY_VERSION + '","categories":' },
      ],
      [
        "obcy JSON w cookie zgody",
        { raw: JSON.stringify({ analytics: true, marketing: true }) },
      ],
    ] as const) {
      test(`${label} → baner pyta ponownie, trackery się nie ładują`, async ({
        page,
        context,
        baseURL,
      }) => {
        await storeConsent(context, baseURL!, record);
        const seen = await trackTrackerRequests(page);
        const calls = trackConsentActions(page);
        await recordBannerAtDomReady(page);
        await page.goto(home);

        expect(
          await page.evaluate(
            () =>
              (window as { __bannerAtDomReady?: string }).__bannerAtDomReady,
          ),
          "baner z serwera nie jest ukrywany przed hydratacją",
        ).not.toBe("none");
        await expect(banner(page)).toBeVisible();
        expect(
          await page.evaluate(() =>
            document.documentElement.getAttribute("data-consent"),
          ),
        ).toBeNull();
        await expectNoTrackers(page, seen);

        // Nowa odpowiedź zastępuje nieaktualną zgodę bieżącą wersją polityki.
        await banner(page)
          .getByRole("button", { name: m.cookies.rejectOptional, exact: true })
          .click();
        await expect(banner(page)).toHaveCount(0);
        const cookie = (await context.cookies()).find(
          (c) => c.name === CONSENT_COOKIE,
        );
        expect(JSON.parse(decodeURIComponent(cookie!.value))).toMatchObject({
          v: POLICY_VERSION,
          categories: NONE,
        });
        await expect.poll(() => calls.length).toBe(1);
        await expectNoTrackers(page, seen);
      });
    }
  });
}
