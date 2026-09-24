import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatSalaryRange } from "../src/lib/salary.ts";
import { launchChromium } from "./lib/launch-chromium.mjs";
import { captureStableScreenshot } from "./lib/stable-screenshot.mjs";
import {
  LOCALES,
  SITE_ORIGIN,
  fetchExportableJob,
  isTrustedJob,
} from "./lib/job-post-source.mjs";

/**
 * Post 1080 × 1080 z prawdziwej, aktywnej oferty (#181). Dane pochodzą wyłącznie z
 * `get_public_job` (patrz `lib/job-post-source.mjs`); etykiety z `src/messages`, zapis stawki
 * z `src/lib/salary.ts`. Brak stawki = brak pola (miejsce zajmuje lokalizacja). Za długi tytuł
 * lub stawka = błąd przed zapisem plików; firma, miasto, region i warunki są skracane z „…”.
 * Skrypt niczego nie publikuje.
 */

export const SIZE = 1080;
const FONT = "Arial, sans-serif";
const MESSAGES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/messages",
);

const messages = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(resolve(MESSAGES_DIR, `${locale}.json`), "utf8")),
  ]),
);

export function labelsFor(locale) {
  const m = messages[locale];
  if (!m) throw new Error(`locale: obsługiwane języki to ${LOCALES.join(", ")}.`);
  const passport = m.jobs.passport;
  return {
    location: passport.location,
    salary: passport.salary,
    viewOffer: passport.viewOffer,
    accommodation: m.jobs.accommodation,
    contractTypes: m.contractTypes,
    salaryLabels: {
      from: (value) => passport.salaryFrom.replace("{value}", value),
      to: (value) => passport.salaryTo.replace("{value}", value),
      period: (period) => passport.salaryPeriods[period],
    },
  };
}

export function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}: oferta nie ma tej wartości — eksport przerwany.`);
  }
  return cleanOptional(value, name);
}

function cleanOptional(value, name) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(`${name}: tekst oferty zawiera znaki sterujące.`);
  }
  return value.trim().replace(/\s+/g, " ");
}

function validateJobUrl(rawUrl, locale) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    url = null;
  }
  if (
    !url ||
    url.origin !== SITE_ORIGIN ||
    url.href !== rawUrl ||
    url.search ||
    url.hash ||
    !new RegExp(`^/${locale}/oferty-pracy/[a-z0-9]+(?:-[a-z0-9]+)*$`).test(
      url.pathname,
    )
  ) {
    throw new Error("url: nieprawidłowy odnośnik do oferty w pracuj.be.");
  }
  return url.href;
}

/**
 * Treść posta z zaufanej oferty. Obiekt spoza `loadExportableJob` (np. JSON z dysku z
 * `isDemo: false`) jest odrzucany.
 */
export function buildPostContent(job) {
  if (!isTrustedJob(job)) {
    throw new Error(
      "Dane oferty muszą pochodzić z publicznego odczytu portalu (get_public_job), nie z pliku ani ręcznie podanego obiektu.",
    );
  }
  const labels = labelsFor(job.locale);
  const salaryInput = {
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
  };
  const salaryAmount = formatSalaryRange(
    salaryInput,
    job.locale,
    labels.salaryLabels,
  );
  const period = ["hour", "month", "year"].includes(job.salaryPeriod)
    ? labels.salaryLabels.period(job.salaryPeriod)
    : null;
  const city = requiredText(job.city, "city");
  const region = cleanOptional(job.region, "region");
  const conditions = [
    labels.contractTypes[job.contractType] ?? null,
    job.accommodation ? labels.accommodation : null,
  ].filter(Boolean);
  const url = validateJobUrl(job.url, job.locale);
  return {
    locale: job.locale,
    title: requiredText(job.title, "title"),
    companyName: requiredText(job.companyName, "company"),
    city,
    region: region && region.toLowerCase() !== city.toLowerCase() ? region : null,
    salary: salaryAmount ? { amount: salaryAmount, period } : null,
    conditions: conditions.join(" · ") || null,
    url,
    displayUrl: url.replace(/^https:\/\//, ""),
    labels: {
      location: labels.location.toLocaleUpperCase(job.locale),
      salary: labels.salary.toLocaleUpperCase(job.locale),
      cta: `${labels.viewOffer} →`,
    },
  };
}

const font = (size, bold = false) =>
  `${bold ? "700" : "400"} ${size}px Arial`;

async function fits(measure, text, fontSpec, maxWidth) {
  return (await measure(text, fontSpec)) <= maxWidth;
}

/** Skraca tekst do szerokości z „…” (na granicy znaku). */
export async function truncate(measure, text, fontSpec, maxWidth) {
  if (await fits(measure, text, fontSpec, maxWidth)) return text;
  const characters = Array.from(text);
  while (characters.length > 1) {
    characters.pop();
    const candidate = `${characters.join("").trimEnd()}…`;
    if (await fits(measure, candidate, fontSpec, maxWidth)) return candidate;
  }
  throw new Error("Tekst nie mieści się w grafice.");
}

async function wrap(measure, text, fontSpec, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!(await fits(measure, word, fontSpec, maxWidth))) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (await fits(measure, candidate, fontSpec, maxWidth)) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return null;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Tytuł: 2 linie po 77 px (jak wzór), inaczej 3 linie po 60 px; więcej = błąd.
const TITLE_STEPS = [
  { size: 77, lines: 2, firstBaseline: 324, lineHeight: 85 },
  { size: 60, lines: 3, firstBaseline: 290, lineHeight: 70 },
];
const SALARY_SIZES = [61, 50, 40];

/**
 * Układ posta. `measure(text, font)` zwraca szerokość w px (w eksporcie: canvas Chromium).
 * Rzuca błąd, gdy tytuł lub stawka się nie mieści — przed zapisaniem plików.
 */
export async function layoutPost(content, measure) {
  let title = null;
  for (const step of TITLE_STEPS) {
    const lines = await wrap(
      measure,
      content.title,
      font(step.size, true),
      950,
      step.lines,
    );
    if (lines) {
      title = { ...step, lines };
      break;
    }
  }
  if (!title) {
    throw new Error(
      "title: tytuł oferty nie mieści się w trzech liniach posta — eksport przerwany.",
    );
  }

  const withSalary = content.salary !== null;
  const locationWidth = withSalary ? 400 : 880;
  const cityFont = font(withSalary ? 46 : 61, true);
  let salary = null;
  if (withSalary) {
    for (const size of SALARY_SIZES) {
      if (await fits(measure, content.salary.amount, font(size, true), 420)) {
        salary = {
          size,
          amount: content.salary.amount,
          period: content.salary.period
            ? await truncate(measure, content.salary.period, font(28), 420)
            : null,
        };
        break;
      }
    }
    if (!salary) {
      throw new Error(
        "salary: stawka nie mieści się w polu wynagrodzenia — eksport przerwany.",
      );
    }
  }

  return {
    title,
    company: await truncate(measure, content.companyName, font(23, true), 950),
    city: await truncate(measure, content.city, cityFont, locationWidth),
    cityFont: withSalary ? 46 : 61,
    region: content.region
      ? await truncate(measure, content.region, font(28), locationWidth)
      : null,
    salary,
    conditions: content.conditions
      ? await truncate(measure, content.conditions, font(29), 950)
      : null,
    cta: await truncate(measure, content.labels.cta, font(35, true), 880),
    displayUrl: await truncate(measure, content.displayUrl, font(17), 950),
  };
}

const text = (x, y, size, fill, value, bold = false, extra = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}"${extra}>${escapeXml(value)}</text>`;

export function renderSvg(content, layout) {
  const titleNodes = layout.title.lines
    .map((line, index) =>
      text(
        65,
        layout.title.firstBaseline + index * layout.title.lineHeight,
        layout.title.size,
        "#151515",
        line,
        true,
        ' letter-spacing="-1.5"',
      ),
    )
    .join("");
  const locationX = 100;
  const cityY = layout.salary ? 603 : 615;
  const regionY = layout.salary ? 659 : 669;
  const location =
    text(locationX, 539, 20, "#595959", content.labels.location, true) +
    text(locationX, cityY, layout.cityFont, "#151515", layout.city, true) +
    (layout.region ? text(locationX, regionY, 28, "#595959", layout.region) : "");
  const salary = layout.salary
    ? `<line x1="520" y1="517" x2="520" y2="725" stroke="#DDDDDD"/>` +
      text(558, 539, 20, "#595959", content.labels.salary, true) +
      text(558, 609, layout.salary.size, "#D92932", layout.salary.amount, true) +
      (layout.salary.period
        ? text(558, 659, 28, "#595959", layout.salary.period)
        : "")
    : "";
  const url = escapeXml(content.url);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-labelledby="post-title" lang="${content.locale}">` +
    `<title id="post-title">${escapeXml(`${content.title} — ${content.companyName}, ${content.city} — Pracuj.be`)}</title>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="#FFFFFF"/><g font-family="${FONT}">` +
    `<g transform="translate(65 61) scale(1.8)"><text y="32" font-size="36" font-weight="700" fill="#151515" letter-spacing="-1.6">pracuj</text><rect x="104" width="64" height="43" rx="9" fill="#D92932"/><text x="109" y="32" font-size="36" font-weight="700" fill="#FFFFFF" letter-spacing="-1.6">.be</text></g>` +
    text(65, 226, 23, "#595959", layout.company, true) +
    titleNodes +
    `<rect x="65" y="475" width="950" height="296" rx="28" fill="#F6F6F6"/>` +
    location +
    salary +
    (layout.conditions ? text(65, 834, 29, "#555555", layout.conditions) : "") +
    `<a href="${url}" xlink:href="${url}"><rect x="65" y="890" width="950" height="103" rx="22" fill="#D92932"/>` +
    text(101, 954, 35, "#FFFFFF", layout.cta, true) +
    `</a>` +
    text(65, 1041, 17, "#595959", layout.displayUrl) +
    `</g></svg>\n`
  );
}

/** Pomiar tekstu canvasem strony Chromium (Arial, jak w SVG). */
export function chromiumMeasure(page) {
  return (value, fontSpec) =>
    page.evaluate(
      ([value, fontSpec]) => {
        const context = document.createElement("canvas").getContext("2d");
        if (!context) throw new Error("Nie można zmierzyć tekstu.");
        context.font = fontSpec;
        return context.measureText(value).width;
      },
      [value, fontSpec],
    );
}

/** SVG + PNG 1080 × 1080. Pliki powstają dopiero po udanym układzie i zrzucie. */
export async function exportJobPost({ job, outputPrefix, browser }) {
  const content = buildPostContent(job);
  const ownBrowser = !browser;
  const activeBrowser = browser ?? (await launchChromium());
  try {
    const page = await activeBrowser.newPage({
      viewport: { width: SIZE, height: SIZE },
      deviceScaleFactor: 1,
    });
    try {
      const layout = await layoutPost(content, chromiumMeasure(page));
      const svg = renderSvg(content, layout);
      await page.setContent(
        `<style>html,body{margin:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden}svg{display:block}</style>${svg}`,
      );
      const png = await captureStableScreenshot(page, {
        animations: "disabled",
        type: "png",
      });
      await mkdir(dirname(outputPrefix), { recursive: true });
      await writeFile(`${outputPrefix}.svg`, svg);
      await writeFile(`${outputPrefix}.png`, png);
      return { svg: `${outputPrefix}.svg`, png: `${outputPrefix}.png` };
    } finally {
      await page.close();
    }
  } finally {
    if (ownBrowser) await activeBrowser.close();
  }
}

async function main() {
  if (process.argv.length !== 5) {
    throw new Error(
      "Użycie: DATABASE_APP_URL=… node scripts/export-job-post.mjs slug-oferty pl|nl|fr|en ścieżka/bez/rozszerzenia",
    );
  }
  const [slug, locale, output] = process.argv.slice(2);
  const job = await fetchExportableJob({
    slug,
    locale,
    connectionString: process.env.DATABASE_APP_URL,
  });
  const paths = await exportJobPost({ job, outputPrefix: resolve(output) });
  process.stdout.write(`Zapisano ${paths.svg} i ${paths.png}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
