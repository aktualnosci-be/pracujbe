import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const WIDTH = 1200;
const HEIGHT = 300;
const PLACEHOLDER =
  /(?:demo|test|testing|sample|example|placeholder|lorem|ipsum|przykład|przykładow|próbny|fikcyjn)/i;

function escapeXml(value) {
  return value.replace(
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

function cleanText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}: podaj niepusty tekst.`);
  }
  if (/[\p{Cc}\p{Cf}]/u.test(value) || PLACEHOLDER.test(value)) {
    throw new Error(`${name}: usuń znaki sterujące lub tekst demonstracyjny.`);
  }
  return value.trim().replace(/\s+/g, " ");
}

function validateDestination(rawUrl) {
  if (
    typeof rawUrl !== "string" ||
    !rawUrl.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(rawUrl)
  ) {
    throw new Error("url: podaj pełny adres HTTPS w domenie pracuj.be.");
  }
  const value = rawUrl.trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("url: podaj pełny adres HTTPS w domenie pracuj.be.");
  }
  if (
    url.protocol !== "https:" ||
    !["pracuj.be", "www.pracuj.be"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !/^\/(?:pl|nl|fr|en)(?:\/|$)/.test(url.pathname)
  ) {
    throw new Error(
      "url: wymagany adres HTTPS w pracuj.be z prefiksem języka, bez danych logowania, portu i fragmentu.",
    );
  }
  return url.href;
}

export function validateCampaign(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Dane kampanii muszą być obiektem JSON.");
  }
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "campaign,cta,title,url") {
    throw new Error("Wymagane dokładnie pola: title, cta, url, campaign.");
  }
  return {
    title: cleanText(input.title, "title"),
    cta: cleanText(input.cta, "cta"),
    campaign: cleanText(input.campaign, "campaign"),
    url: validateDestination(input.url),
  };
}

async function measureAndWrap(page, { title, cta, campaign }) {
  const layout = await page.evaluate(
    ({ title, cta, campaign }) => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Nie można zmierzyć tekstu.");
      const width = (text, font) => {
        context.font = font;
        return context.measureText(text).width;
      };
      const lines = [];
      let line = "";
      for (const word of title.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (width(candidate, "700 46px Arial") <= 675) {
          line = candidate;
        } else {
          if (!line || lines.length === 1)
            return {
              error: "title: tekst nie mieści się w dwóch liniach baneru.",
            };
          lines.push(line);
          line = word;
          if (width(line, "700 46px Arial") > 675)
            return { error: "title: wyraz jest zbyt długi." };
        }
      }
      if (line) lines.push(line);
      if (width(cta, "700 17px Arial") > 312)
        return { error: "cta: tekst nie mieści się na przycisku." };
      if (width(campaign, "700 14px Arial") > 338)
        return { error: "campaign: oznaczenie nie mieści się na karcie." };
      return { lines };
    },
    { title, cta, campaign },
  );
  if (layout.error) throw new Error(layout.error);
  return layout.lines;
}

export function renderSvg({ title, cta, campaign, url }, lines) {
  const titleNodes = lines
    .map(
      (line, index) =>
        `<text x="42" y="${lines.length === 1 ? 170 : 145 + index * 59}" font-size="46" font-weight="700" letter-spacing="-1.5" fill="${index === 0 ? "#151515" : "#D92932"}">${escapeXml(line)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="banner-title"><title id="banner-title">${escapeXml(title)} — Pracuj.be</title><rect width="1200" height="300" fill="#FFFFFF"/><g font-family="Arial, sans-serif"><g transform="translate(42 28)"><text y="32" font-size="36" font-weight="700" fill="#151515" letter-spacing="-1.6">pracuj</text><rect x="104" width="64" height="43" rx="9" fill="#D92932"/><text x="109" y="32" font-size="36" font-weight="700" fill="#FFFFFF" letter-spacing="-1.6">.be</text></g>${titleNodes}<rect x="768" y="24" width="406" height="252" rx="25" fill="#F6F6F6"/><text x="797" y="69" font-size="14" font-weight="700" fill="#151515">${escapeXml(campaign)}</text><path d="M797 91H1145" stroke="#DDDDDD"/><path d="M797 131H1117M797 150H1080M797 169H1135" stroke="#DDDDDD" stroke-width="2" stroke-linecap="round"/><a href="${escapeXml(url)}" xlink:href="${escapeXml(url)}"><rect x="797" y="199" width="348" height="48" rx="12" fill="#D92932"/><text x="813" y="229" font-size="17" font-weight="700" fill="#FFFFFF">${escapeXml(cta)}</text></a></g></svg>\n`;
}

async function main() {
  if (process.argv.length !== 4) {
    throw new Error(
      "Użycie: node scripts/export-campaign-banner.mjs dane.json ścieżka/bez/rozszerzenia",
    );
  }
  const inputPath = resolve(process.argv[2]);
  const outputPrefix = resolve(process.argv[3]);
  const campaign = validateCampaign(
    JSON.parse((await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "")),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const lines = await measureAndWrap(page, campaign);
    const svg = renderSvg(campaign, lines);
    await page.setContent(
      `<style>html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}svg{display:block}</style>${svg}`,
    );
    const png = await page.screenshot({ animations: "disabled", type: "png" });
    await mkdir(dirname(outputPrefix), { recursive: true });
    await writeFile(`${outputPrefix}.svg`, svg);
    await writeFile(`${outputPrefix}.png`, png);
    process.stdout.write(
      `Zapisano ${outputPrefix}.svg i ${outputPrefix}.png\n`,
    );
  } finally {
    await browser.close();
  }
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
