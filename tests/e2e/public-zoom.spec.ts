import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type Page } from "@playwright/test";

const locales = ["pl", "nl", "fr", "en"] as const;

type Locale = (typeof locales)[number];

type Messages = {
  home: {
    heroTitle: string;
    searchButton: string;
  };
  jobs: {
    pageTitle: string;
  };
  filters: {
    title: string;
    immediate: string;
    showResults: string;
  };
  cookies: {
    rejectOptional: string;
  };
};

function messages(locale: Locale): Messages {
  const file = resolve(process.cwd(), "src", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as Messages;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wzorzec etykiety „Pokaż N ofert” — obsługuje odmianę ICU (`{count, plural, …}`, #226). */
function resultsPattern(template: string): RegExp {
  const branches = [...template.matchAll(/\{([^{}]*#[^{}]*)\}/g)].map(
    (match) => match[1],
  );
  const variants = branches.length > 0 ? branches : [template];
  const alternatives = variants.map((variant) =>
    escapeRegExp(variant)
      .replace("\\{count\\}", "\\d+")
      .replace("#", "\\d+"),
  );
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > viewportWidth + 1;
      })
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: element.className,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }));

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      offenders,
    };
  });

  expect(
    overflow.documentWidth,
    JSON.stringify(overflow, null, 2),
  ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
}

for (const locale of locales) {
  test(`strony publiczne zachowują używalność przy 200% powiększeniu: ${locale}`, async ({
    page,
  }) => {
    const t = messages(locale);

    // 640 CSS px odpowiada obszarowi strony 1280 px po powiększeniu przeglądarki do 200%.
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: t.cookies.rejectOptional }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: t.home.heroTitle }),
    ).toBeVisible();
    const search = page.getByRole("search");
    await expect(search).toBeVisible();
    await expect(
      search.getByRole("button", { name: t.home.searchButton }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Podstawowa akcja na home musi nadal prowadzić do listy ofert po reflow.
    await search.getByRole("button", { name: t.home.searchButton }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/oferty-pracy(?:\\?|$)`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: t.jobs.pageTitle }),
    ).toBeVisible();
    await expect(
      page.locator('a[href*="/oferty-pracy/"]').first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const filterTrigger = page.getByRole("button", {
      name: t.filters.title,
      exact: true,
    });
    await expect(filterTrigger).toBeVisible();
    await filterTrigger.click();

    const dialog = page.getByRole("dialog", { name: t.filters.title });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const immediate = dialog.getByRole("checkbox", {
      name: t.filters.immediate,
    });
    await immediate.click();
    await expect(immediate).toBeChecked();

    const showResults = dialog.getByRole("button", {
      name: resultsPattern(t.filters.showResults),
    });
    await expect(showResults).toBeVisible();
    await showResults.click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/(?:\?|&)immediate=1(?:&|$)/);
    await expectNoHorizontalOverflow(page);
  });
}
