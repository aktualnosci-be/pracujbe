#!/usr/bin/env node
/**
 * Matryca zgodności z prototypem „04 Ludzie i praca” (#7).
 *
 * Renderuje w Chromium każdy ekran prototypu (`docs/design/people-passport/prototype`,
 * motyw `people`) i odpowiadającą mu trasę aplikacji (tryb demo), przy 1280 i 390 px, oraz:
 *   1. nakłada zrzuty całej strony i liczy % pikseli różniących się w którymkolwiek kanale
 *      o więcej niż 40/255 (na wspólnym obszarze; różnica wysokości raportowana osobno);
 *   2. porównuje style kluczowych elementów (getBoundingClientRect + getComputedStyle):
 *      nagłówek strony, logo, H1, nadtytuł, główny przycisk, aktywną pozycję menu panelu,
 *      krój pisma — z tolerancją 1 px i 8/255 na kanał koloru (#777 → #767676 = zgodne);
 *   3. dla tras bez ekranu w prototypie (auth, admin, ustawienia…) — tylko punkt 2 względem
 *      ekranu referencyjnego, z którego prymitywów trasa jest złożona;
 *   4. e-maile: newsletter React Email vs `materials/newsletter.html` (nakładka + style),
 *      e-mail transakcyjny — style względem newslettera; favicon/PWA/OG — kolory znaku.
 *
 * Skrypt NIE jest częścią CI. Uruchomienie (aplikacja musi działać w trybie demo, bez env
 * Supabase — np. `npm run build && npm run start`):
 *
 *   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/design/compare-prototype.mjs [--base http://localhost:3000] \
 *       [--out test-results/prototype-compare] [--only home,jobs] [--widths 1280,390]
 *
 * Wynik: `<out>/results.json`, `<out>/matrix.md` (tabela do MATRIX.md) oraz zrzuty
 * `<out>/<id>-<width>-{proto,app,diff}.png` (diff: czerwone = różne piksele).
 */

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { launchChromium } from "../lib/launch-chromium.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const PROTOTYPE_DIR = join(ROOT, "docs/design/people-passport/prototype");
const FONT_FILE = join(ROOT, "src/app/fonts/DMSans-latin.woff2");

/** Próg różnicy piksela (maks. różnica kanału RGB) i progi statusu nakładki. */
export const PIXEL_THRESHOLD = 40;
export const STATUS_THRESHOLDS = { ok: 10, partial: 30 };
/** Tolerancje porównania stylów. */
const PX_TOLERANCE = 1;
const COLOR_TOLERANCE = 8;

// ---------------------------------------------------------------------------------------
// Ekrany: prototyp (widok `#people/<view>`) ↔ trasa aplikacji. `app` może być funkcją,
// która wyszukuje adres w wyrenderowanej aplikacji (np. slug pierwszej oferty demo).
// `pixel: false` = brak odpowiednika 1:1 (tylko style względem `proto`).
// ---------------------------------------------------------------------------------------

const firstLink = (listPath, pattern) => async (page, base) => {
  await page.goto(`${base}${listPath}`, { waitUntil: "load" });
  const href = await page.evaluate((source) => {
    const re = new RegExp(source);
    const link = [...document.querySelectorAll("a[href]")].find((a) =>
      re.test(new URL(a.href).pathname),
    );
    return link ? new URL(link.href).pathname : null;
  }, pattern);
  return href;
};

export const SCREENS = [
  // Strony publiczne
  { id: "home", proto: "home", app: "/pl", group: "public" },
  { id: "jobs", proto: "jobs", app: "/pl/oferty-pracy", group: "public" },
  {
    id: "detail",
    proto: "detail",
    app: firstLink("/pl/oferty-pracy", "^/pl/oferty-pracy/[a-z0-9-]+$"),
    group: "public",
  },
  { id: "jobs-hub", proto: "jobs", app: "/pl/praca", group: "public", pixel: false },
  { id: "category", proto: "jobs", app: "/pl/praca/kategoria/logistics", group: "public", pixel: false },
  { id: "city", proto: "jobs", app: "/pl/praca/miasto/antwerpen", group: "public", pixel: false },
  { id: "employers", proto: "home", app: "/pl/dla-pracodawcow", group: "public", pixel: false },
  { id: "guides", proto: "jobs", app: "/pl/poradniki", group: "public", pixel: false },
  {
    id: "guide",
    proto: "jobs",
    app: firstLink("/pl/poradniki", "^/pl/poradniki/[a-z0-9-]+$"),
    group: "public",
    pixel: false,
  },
  { id: "about", proto: "jobs", app: "/pl/o-nas", group: "public", pixel: false },
  { id: "contact", proto: "jobs", app: "/pl/kontakt", group: "public", pixel: false },
  { id: "help", proto: "jobs", app: "/pl/pomoc", group: "public", pixel: false },
  { id: "terms", proto: "jobs", app: "/pl/regulamin", group: "public", pixel: false },
  { id: "privacy", proto: "jobs", app: "/pl/polityka-prywatnosci", group: "public", pixel: false },
  { id: "cookies-policy", proto: "jobs", app: "/pl/polityka-cookies", group: "public", pixel: false },
  { id: "report", proto: "jobs", app: "/pl/zglos-tresc", group: "public", pixel: false },
  { id: "not-found", proto: "jobs", app: "/pl/nie-ma-takiej-strony", group: "public", pixel: false },
  // Auth (bez ekranu w prototypie — formularz `.demo-form`)
  { id: "login", proto: "apply", app: "/pl/logowanie", group: "auth", pixel: false },
  { id: "register", proto: "apply", app: "/pl/rejestracja", group: "auth", pixel: false },
  { id: "register-employer", proto: "apply", app: "/pl/rejestracja-pracodawca", group: "auth", pixel: false },
  { id: "reset", proto: "apply", app: "/pl/reset-hasla", group: "auth", pixel: false },
  { id: "new-password", proto: "apply", app: "/pl/ustaw-nowe-haslo", group: "auth", pixel: false },
  { id: "confirm", proto: "apply", app: "/pl/potwierdzenie", group: "auth", pixel: false },
  { id: "unsubscribe", proto: "apply", app: "/pl/wypisz", group: "auth", pixel: false },
  // Kandydat
  { id: "candidate", proto: "candidate", app: "/pl/candidate", group: "candidate" },
  { id: "profile", proto: "profile", app: "/pl/candidate/profil", group: "candidate" },
  { id: "applications", proto: "applications", app: "/pl/candidate/aplikacje", group: "candidate" },
  { id: "proposals", proto: "proposals", app: "/pl/candidate/propozycje", group: "candidate" },
  { id: "messages", proto: "messages", app: "/pl/candidate/wiadomosci", group: "candidate" },
  { id: "saved", proto: "saved", app: "/pl/candidate/zapisane", group: "candidate" },
  { id: "recommended", proto: "saved", app: "/pl/candidate/oferty-polecane", group: "candidate", pixel: false },
  { id: "onboarding", proto: "profile", app: "/pl/candidate/onboarding", group: "candidate", pixel: false },
  { id: "saved-searches", proto: "saved", app: "/pl/candidate/wyszukiwania", group: "candidate", pixel: false },
  { id: "candidate-settings", proto: "profile", app: "/pl/candidate/ustawienia", group: "candidate", pixel: false },
  // Pracodawca
  { id: "employer", proto: "employer", app: "/pl/employer", group: "employer" },
  { id: "newjob", proto: "newjob", app: "/pl/employer/oferty/nowa", group: "employer" },
  { id: "talent", proto: "talent", app: "/pl/employer/kandydaci", group: "employer" },
  { id: "company", proto: "company", app: "/pl/employer/firma", group: "employer" },
  { id: "employer-jobs", proto: "talent", app: "/pl/employer/oferty", group: "employer", pixel: false },
  { id: "employer-applications", proto: "talent", app: "/pl/employer/aplikacje", group: "employer", pixel: false },
  {
    id: "employer-application",
    proto: "profile",
    app: firstLink("/pl/employer/aplikacje", "^/pl/employer/aplikacje/[^/]+$"),
    group: "employer",
    pixel: false,
  },
  { id: "employer-messages", proto: "messages", app: "/pl/employer/wiadomosci", group: "employer", pixel: false },
  { id: "employer-stats", proto: "talent", app: "/pl/employer/statystyki", group: "employer", pixel: false },
  { id: "employer-team", proto: "company", app: "/pl/employer/zespol", group: "employer", pixel: false },
  { id: "employer-settings", proto: "company", app: "/pl/employer/ustawienia", group: "employer", pixel: false },
  { id: "company-new", proto: "company", app: "/pl/employer/firma/nowa", group: "employer", pixel: false },
  // Administrator (bez ekranu w prototypie — prymitywy panelu pracodawcy)
  { id: "admin", proto: "employer", app: "/pl/admin", group: "admin", pixel: false },
  { id: "admin-companies", proto: "employer", app: "/pl/admin/firmy", group: "admin", pixel: false },
  { id: "admin-company", proto: "company", app: "/pl/admin/firmy/demo-c2", group: "admin", pixel: false },
  { id: "admin-reports", proto: "employer", app: "/pl/admin/zgloszenia", group: "admin", pixel: false },
  { id: "admin-users", proto: "employer", app: "/pl/admin/uzytkownicy", group: "admin", pixel: false },
  { id: "admin-mail", proto: "employer", app: "/pl/admin/poczta", group: "admin", pixel: false },
  { id: "admin-log", proto: "employer", app: "/pl/admin/dziennik", group: "admin", pixel: false },
  // Offline PWA
  { id: "offline", proto: "home", app: "/pl/offline", group: "brand", pixel: false },
];

// ---------------------------------------------------------------------------------------
// Kluczowe elementy: wyszukiwane w przeglądarce. Każdy wpis ma selektory prototypu i
// aplikacji (pierwszy widoczny element) albo funkcję heurystyczną.
// ---------------------------------------------------------------------------------------

const KEY_ELEMENTS = {
  header: { proto: "#screen header.nav", app: "body header" },
  // Kafelek „.be” logo (prototyp `.logo .suffix`, aplikacja `Logo` → span z tłem marki).
  logo: { proto: "#screen .logo .suffix", app: "[role='img'][aria-label='Pracuj.be'] span span" },
  h1: { proto: "#screen h1", app: "main h1" },
  eyebrow: { proto: "#screen .eyebrow, #screen .p-eyebrow", app: "@eyebrow" },
  primary: { proto: "@primary", app: "@primary" },
  sideActive: { proto: "#screen .side-item.active", app: "aside [aria-current='page'], nav [aria-current='page']" },
  body: { proto: "#screen", app: "body" },
};

const STYLE_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "borderTopLeftRadius",
];
/** Dla `body`/`#screen` porównujemy tylko krój i kolor tekstu (tło i wysokość to kontener). */
const BODY_PROPS = new Set(["fontFamily", "color"]);
const RECT_PROPS = ["height"];

/** Kod wykonywany w stronie: zwraca opis kluczowych elementów. */
function collectKeyElements({ keys, side, styleProps, rectProps, bodyProps }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const heuristics = {
    // Pierwszy widoczny element z czerwonym tłem marki (przycisk główny).
    primary: () =>
      [...document.querySelectorAll(side === "proto" ? "#screen a, #screen button" : "main a, main button")]
        .filter(visible)
        .find((el) => getComputedStyle(el).backgroundColor.replace(/\s/g, "") === "rgb(217,41,50)"),
    // Nadtytuł: wersaliki ≤ 12 px w obszarze treści, przed pierwszym H1.
    eyebrow: () => {
      const h1 = document.querySelector("main h1");
      return [...document.querySelectorAll("main span, main p, main div")]
        .filter(visible)
        .find((el) => {
          const s = getComputedStyle(el);
          const precedes = h1 ? el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING : true;
          return (
            s.textTransform === "uppercase" &&
            parseFloat(s.fontSize) <= 12 &&
            el.children.length === 0 &&
            el.textContent.trim().length > 2 &&
            precedes
          );
        });
    },
  };
  const out = {};
  for (const [name, def] of Object.entries(keys)) {
    const selector = def[side];
    let el = null;
    if (selector.startsWith("@")) el = heuristics[selector.slice(1)]?.() ?? null;
    else el = [...document.querySelectorAll(selector)].find(visible) ?? null;
    if (!el) {
      out[name] = null;
      continue;
    }
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const style = {};
    const props = name === "body" ? styleProps.filter((p) => bodyProps.includes(p)) : styleProps;
    for (const p of props) style[p] = s[p];
    style.fontFamily = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    // `normal` = metryki fontu; DM Sans: (ascent + descent) / em ≈ 1,302.
    if (style.lineHeight === "normal") style.lineHeight = `${(parseFloat(s.fontSize) * 1.302).toFixed(1)}px`;
    if (name !== "body") for (const p of rectProps) style[p] = `${Math.round(r[p])}px`;
    out[name] = { tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 40), style };
  }
  return out;
}

function parseColor(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function sameValue(prop, a, b) {
  if (a === b) return true;
  if (prop === "color" || prop === "backgroundColor") {
    const ca = parseColor(a);
    const cb = parseColor(b);
    if (!ca || !cb) return false;
    if (ca.a === 0 && cb.a === 0) return true;
    return (
      Math.abs(ca.r - cb.r) <= COLOR_TOLERANCE &&
      Math.abs(ca.g - cb.g) <= COLOR_TOLERANCE &&
      Math.abs(ca.b - cb.b) <= COLOR_TOLERANCE &&
      Math.abs(ca.a - cb.a) <= 0.05
    );
  }
  // next/font nadaje rodzinie własną nazwę (`dmSans`, `__dmSans_…`) — liczy się krój.
  if (prop === "fontFamily") {
    const norm = (v) => v.toLowerCase().replace(/[\s_-]/g, "");
    return norm(a).includes("dmsans") && norm(b).includes("dmsans");
  }
  if (prop === "fontWeight") return Math.abs(Number(a) - Number(b)) <= 50;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= (prop === "lineHeight" ? PX_TOLERANCE + 0.5 : PX_TOLERANCE);
  }
  // `normal` vs 0px letter-spacing
  if (prop === "letterSpacing") return (a === "normal" ? 0 : na) === (b === "normal" ? 0 : nb);
  return false;
}

/** Porównanie kluczowych elementów: lista rozbieżności i odsetek zgodnych właściwości. */
export function compareKeyElements(proto, app) {
  const mismatches = [];
  let total = 0;
  let matched = 0;
  for (const name of Object.keys(KEY_ELEMENTS)) {
    const p = proto[name];
    const a = app[name];
    if (!p) continue; // element nie występuje w ekranie prototypu
    if (!a) {
      mismatches.push(`${name}: brak w aplikacji`);
      total += 1;
      continue;
    }
    for (const prop of Object.keys(p.style)) {
      total += 1;
      if (sameValue(prop, p.style[prop], a.style[prop])) matched += 1;
      else mismatches.push(`${name}.${prop}: ${p.style[prop]} → ${a.style[prop]}`);
    }
  }
  return { matchedRatio: total ? matched / total : 1, mismatches };
}

// ---------------------------------------------------------------------------------------
// Nakładka zrzutów
// ---------------------------------------------------------------------------------------

export async function diffImages(bufferA, bufferB, diffPath, threshold = PIXEL_THRESHOLD) {
  const a = sharp(bufferA);
  const b = sharp(bufferB);
  const [ma, mb] = await Promise.all([a.metadata(), b.metadata()]);
  const width = Math.min(ma.width, mb.width);
  const height = Math.min(ma.height, mb.height);
  const extract = { left: 0, top: 0, width, height };
  const [ra, rb] = await Promise.all([
    sharp(bufferA).extract(extract).removeAlpha().raw().toBuffer(),
    sharp(bufferB).extract(extract).removeAlpha().raw().toBuffer(),
  ]);
  const out = Buffer.alloc(width * height * 3);
  let different = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 3;
    const d = Math.max(
      Math.abs(ra[o] - rb[o]),
      Math.abs(ra[o + 1] - rb[o + 1]),
      Math.abs(ra[o + 2] - rb[o + 2]),
    );
    if (d > threshold) {
      different += 1;
      out[o] = 230;
      out[o + 1] = 30;
      out[o + 2] = 40;
    } else {
      // Wyblakły podgląd aplikacji jako tło diffu.
      const g = Math.round(255 - (255 - rb[o + 1]) * 0.25);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
    }
  }
  if (diffPath) {
    await sharp(out, { raw: { width, height, channels: 3 } }).png().toFile(diffPath);
  }
  return {
    percent: (different / (width * height)) * 100,
    comparedHeight: height,
    heights: [ma.height, mb.height],
  };
}

export function statusFor(percent, matchedRatio) {
  if (percent === null) {
    if (matchedRatio >= 0.9) return "✓";
    if (matchedRatio >= 0.7) return "~";
    return "✗";
  }
  if (percent <= STATUS_THRESHOLDS.ok && matchedRatio >= 0.85) return "✓";
  if (percent <= STATUS_THRESHOLDS.partial && matchedRatio >= 0.6) return "~";
  return "✗";
}

// ---------------------------------------------------------------------------------------
// Serwer prototypu (statyczny) z podmianą Google Fonts na lokalny plik DM Sans.
// ---------------------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function startPrototypeServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path === "/__font.woff2" ? FONT_FILE : join(PROTOTYPE_DIR, path);
    if (!file.startsWith(PROTOTYPE_DIR) && file !== FONT_FILE) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/** Prototyp bez chrome'u „studio”: witryna (#site) na pełną szerokość okna. */
const PROTOTYPE_ISOLATION_CSS = `
  .studio, .direction-info, .viewbar { display: none !important; }
  body { margin: 0 !important; background: #fff !important; }
  .canvas { padding: 0 !important; margin: 0 !important; }
  #site { max-width: none !important; margin: 0 !important; border: 0 !important;
          border-radius: 0 !important; box-shadow: none !important; }
  * { font-optical-sizing: none; }
  .demo-note { display: none !important; }
`;

const GOOGLE_FONTS_CSS = (origin) =>
  [400, 500, 600, 700, 800]
    .map(
      (w) =>
        `@font-face{font-family:'DM Sans';font-style:normal;font-weight:${w};font-display:block;src:url(${origin}/__font.woff2) format('woff2');}`,
    )
    .join("\n");

async function renderPrototype(context, origin, view, width) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.request().url().includes("googleapis")
      ? route.fulfill({ contentType: "text/css", body: GOOGLE_FONTS_CSS(origin) })
      : route.abort(),
  );
  await page.goto(`${origin}/index.html#people/home`, { waitUntil: "networkidle" });
  await page.evaluate((v) => {
    // `theme`, `view` i `render` to globalne wiązania skryptów prototypu.
    // eslint-disable-next-line no-undef
    theme = "people";
    // eslint-disable-next-line no-undef
    view = v === "detail" ? "detail" : v;
    // eslint-disable-next-line no-undef
    render();
  }, view);
  await page.addStyleTag({ content: PROTOTYPE_ISOLATION_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}

async function renderApp(context, base, path, width) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.addStyleTag({
    content: "*{transition:none!important;animation:none!important;caret-color:transparent!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}

async function collect(page, side) {
  return page.evaluate(collectKeyElements, {
    keys: KEY_ELEMENTS,
    side,
    styleProps: STYLE_PROPS,
    rectProps: RECT_PROPS,
    bodyProps: [...BODY_PROPS],
  });
}

// ---------------------------------------------------------------------------------------
// E-maile i zasoby marki
// ---------------------------------------------------------------------------------------

async function renderEmails() {
  const { build } = await import("esbuild");
  // Pakiet w repozytorium (node_modules/.cache), żeby zewnętrzne importy (react, @react-email)
  // rozwiązywały się z node_modules projektu niezależnie od katalogu wyników.
  const outDir = join(ROOT, "node_modules/.cache/compare-prototype");
  await mkdir(outDir, { recursive: true });
  const entry = join(outDir, "email-entry.tsx");
  await writeFile(
    entry,
    `export { renderNewsletterEmail } from "@/emails/newsletter";\nexport { renderEmail } from "@/emails/templates";\n`,
  );
  const bundle = join(outDir, "email-bundle.mjs");
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    // Pakiety npm zostają zewnętrzne; alias `@/` (tsconfig) jest wkompilowany.
    plugins: [
      {
        name: "external-packages",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^[^./]/ }, async (args) => {
            if (!args.path.startsWith("@/")) return { path: args.path, external: true };
            return pluginBuild.resolve(`./${args.path.slice(2)}`, {
              kind: args.kind,
              resolveDir: join(ROOT, "src"),
            });
          });
        },
      },
    ],
    absWorkingDir: ROOT,
    logLevel: "error",
  });
  const mod = await import(pathToFileURL(bundle).href);
  const jobs = [
    { locale: "pl", slug: "operator-wozka-widlowego", title: "Operator wózka widłowego", city: "Antwerpia", salary: "17–20 € brutto / godz.", isDemo: false },
    { locale: "pl", slug: "elektryk-przemyslowy", title: "Elektryk przemysłowy", city: "Gandawa", salary: "21–25 € brutto / godz.", isDemo: false },
  ];
  const newsletter = (await mod.renderNewsletterEmail("pl", jobs)).html;
  const transactional = (
    await mod.renderEmail(
      "newApplication",
      "pl",
      {
        recipientName: "Anna",
        candidateName: "Michał Kowalski",
        jobTitle: "Operator wózka widłowego",
        companyName: "Northline Logistics",
        applicationUrl: "https://pracuj.be/pl/employer/aplikacje/1",
      },
      { unsubscribeUrl: "https://pracuj.be/pl/wypisz?t=x" },
    )
  ).html;
  return { newsletter, transactional };
}

async function brandColours(base) {
  const assets = ["/og.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/icon.svg"];
  const out = [];
  for (const asset of assets) {
    const res = await fetch(`${base}${asset}`);
    if (!res.ok) {
      out.push({ asset, status: res.status });
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const counts = new Map();
      for (let i = 0; i < data.length; i += 3) {
        const key = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
      out.push({
        asset,
        status: 200,
        size: `${info.width}×${info.height}`,
        dominant: top.map(([c, n]) => `${c} ${((n / (info.width * info.height)) * 100).toFixed(1)}%`),
      });
    } catch {
      out.push({ asset, status: 200, note: "format nieobsługiwany przez sharp (ico)" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { base: "http://localhost:3000", out: "test-results/prototype-compare", only: null, widths: [1280, 390] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--base":
        args.base = value;
        break;
      case "--out":
        args.out = value;
        break;
      case "--only":
        args.only = new Set(value.split(","));
        break;
      case "--widths":
        args.widths = value.split(",").map(Number);
        break;
      default:
        continue;
    }
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(ROOT, args.out);
  await mkdir(outDir, { recursive: true });
  if (!existsSync(FONT_FILE)) throw new Error(`Brak fontu ${FONT_FILE}`);

  const health = await fetch(args.base).catch(() => null);
  if (!health) throw new Error(`Aplikacja nie odpowiada pod ${args.base} (uruchom npm run start).`);

  const { server, url: origin } = await startPrototypeServer();
  const browser = await launchChromium();
  const context = await browser.newContext({ deviceScaleFactor: 1, locale: "pl-PL" });
  // Zgoda „tylko niezbędne” zapisana z góry — baner nie zasłania zrzutów aplikacji.
  const consent = {
    v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
    categories: { necessary: true, preferences: false, analytics: false },
    ts: new Date().toISOString(),
    id: "00000000-0000-4000-8000-000000000000",
  };
  await context.addCookies([
    { name: "pracujbe_consent", value: encodeURIComponent(JSON.stringify(consent)), url: args.base },
  ]);

  const results = [];
  try {
    for (const screen of SCREENS) {
      if (args.only && !args.only.has(screen.id)) continue;
      let appPath = screen.app;
      if (typeof appPath === "function") {
        const finder = await context.newPage();
        appPath = await appPath(finder, args.base);
        await finder.close();
      }
      const row = { id: screen.id, proto: screen.proto, app: appPath, group: screen.group, widths: {} };
      if (!appPath) {
        row.error = "nie znaleziono adresu w aplikacji";
        results.push(row);
        continue;
      }
      for (const width of args.widths) {
        const protoPage = await renderPrototype(context, origin, screen.proto, width);
        const appPage = await renderApp(context, args.base, appPath, width);
        const [protoKeys, appKeys] = await Promise.all([collect(protoPage, "proto"), collect(appPage, "app")]);
        const styles = compareKeyElements(protoKeys, appKeys);
        let diff = null;
        if (screen.pixel !== false) {
          const protoShot = await protoPage.locator("#site").screenshot();
          const appShot = await appPage.screenshot({ fullPage: true });
          await writeFile(join(outDir, `${screen.id}-${width}-proto.png`), protoShot);
          await writeFile(join(outDir, `${screen.id}-${width}-app.png`), appShot);
          diff = await diffImages(protoShot, appShot, join(outDir, `${screen.id}-${width}-diff.png`));
        }
        row.widths[width] = {
          percent: diff ? Number(diff.percent.toFixed(1)) : null,
          heights: diff?.heights ?? null,
          styleMatch: Number((styles.matchedRatio * 100).toFixed(0)),
          mismatches: styles.mismatches,
          status: statusFor(diff ? diff.percent : null, styles.matchedRatio),
        };
        await protoPage.close();
        await appPage.close();
        process.stdout.write(
          `${screen.id} @${width}: ${diff ? `${diff.percent.toFixed(1)}%` : "—"} · style ${row.widths[width].styleMatch}% · ${row.widths[width].status}\n`,
        );
      }
      results.push(row);
    }

    // E-maile: newsletter React Email vs materials/newsletter.html
    if (!args.only || args.only.has("emails")) {
      const emails = await renderEmails();
      for (const [id, html] of Object.entries(emails)) {
        const row = { id: `email-${id}`, proto: "materials/newsletter.html", app: `React Email (${id})`, group: "email", widths: {} };
        for (const width of args.widths) {
          const protoPage = await context.newPage();
          await protoPage.setViewportSize({ width, height: 900 });
          await protoPage.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
          await protoPage.goto(`${origin}/materials/newsletter.html`, { waitUntil: "networkidle" });
          const appPage = await context.newPage();
          await appPage.setViewportSize({ width, height: 900 });
          await appPage.setContent(html, { waitUntil: "networkidle" });
          const [ps, as] = await Promise.all([
            protoPage.screenshot({ fullPage: true }),
            appPage.screenshot({ fullPage: true }),
          ]);
          await writeFile(join(outDir, `${row.id}-${width}-proto.png`), ps);
          await writeFile(join(outDir, `${row.id}-${width}-app.png`), as);
          const diff = id === "newsletter" ? await diffImages(ps, as, join(outDir, `${row.id}-${width}-diff.png`)) : null;
          row.widths[width] = {
            percent: diff ? Number(diff.percent.toFixed(1)) : null,
            heights: diff?.heights ?? null,
            styleMatch: null,
            mismatches: [],
            status: diff ? statusFor(diff.percent, 1) : "—",
          };
          await protoPage.close();
          await appPage.close();
          process.stdout.write(`${row.id} @${width}: ${diff ? `${diff.percent.toFixed(1)}%` : "—"}\n`);
        }
        results.push(row);
      }
    }

    const brand = !args.only || args.only.has("brand-assets") ? await brandColours(args.base) : [];
    await writeFile(join(outDir, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results, brand }, null, 2));
    await writeFile(join(outDir, "matrix.md"), toMarkdown(results, brand, args.widths));
    process.stdout.write(`\nZapisano ${join(outDir, "matrix.md")}\n`);
  } finally {
    await browser.close();
    server.close();
  }
}

function toMarkdown(results, brand, widths) {
  const head = `| Grupa | Ekran prototypu | Trasa aplikacji | ${widths.map((w) => `% różnicy ${w}`).join(" | ")} | ${widths.map((w) => `style ${w}`).join(" | ")} | Status | Rozbieżności stylu (${widths[0]} px) |`;
  const sep = `|${"---|".repeat(5 + widths.length * 2)}`;
  const rows = results.map((r) => {
    if (r.error) return `| ${r.group} | ${r.proto} | — | ${widths.map(() => "—").join(" | ")} | ${widths.map(() => "—").join(" | ")} | ✗ | ${r.error} |`;
    const cells = widths.map((w) => (r.widths[w]?.percent ?? null) === null ? "—" : `${r.widths[w].percent}%`);
    const styles = widths.map((w) => (r.widths[w]?.styleMatch ?? null) === null ? "—" : `${r.widths[w].styleMatch}%`);
    const statuses = widths.map((w) => r.widths[w]?.status ?? "—");
    const worst = statuses.includes("✗") ? "✗" : statuses.includes("~") ? "~" : statuses.includes("✓") ? "✓" : "—";
    const mism = (r.widths[widths[0]]?.mismatches ?? []).slice(0, 4).join("; ").replace(/\|/g, "\\|") || "—";
    return `| ${r.group} | ${r.proto} | \`${r.app}\` | ${cells.join(" | ")} | ${styles.join(" | ")} | ${worst} | ${mism} |`;
  });
  const brandRows = brand.map((b) => `| \`${b.asset}\` | ${b.status} | ${b.size ?? "—"} | ${(b.dominant ?? [b.note ?? "—"]).join(", ")} |`);
  return [
    head,
    sep,
    ...rows,
    "",
    "| Zasób marki | HTTP | Rozmiar | Dominujące kolory |",
    "|---|---|---|---|",
    ...brandRows,
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
