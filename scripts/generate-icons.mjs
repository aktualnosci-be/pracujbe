// Generuje favicon SVG, komplet ikon PWA i grafikę Open Graph ze znaku z prototypu
// „Ludzie i praca” (#7): czarne „pracuj” i biały „.be” na czerwonym kafelku, DM Sans 800.
//
// Geometria dosłownie z prototypu (people.css + extended.css, `.people .logo` i `.suffix`):
// światło słowa −1,5 px przy 29 px, odstęp kafelka .09em, dopełnienie .1/.17/.14em,
// promień .22em, line-height 1, światło sufiksu −.055em. Kontury glifów (bez fontu
// systemowego) pochodzą z assets/brand/logo-glyphs.json — patrz scripts/brand-glyphs.py.
//
// Uruchom: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const glyphs = JSON.parse(readFileSync(join(ROOT, "assets", "brand", "logo-glyphs.json"), "utf8"));

// Tokeny marki (globals.css: --pp-red, --pp-ink, --pp-white).
const RED = "#D92932";
const INK = "#151515";
const WHITE = "#FFFFFF";

// Kafelek sufiksu w em (extended.css `.people .logo .suffix`).
const PAD_TOP = 0.1;
const PAD_X = 0.17;
const PAD_BOTTOM = 0.14;
const RADIUS = 0.22;
const GAP = 0.09;
// line-height: 1 → pół-interlinia ujemna; linia bazowa od góry pola treści (Chromium: hhea).
const BASELINE = glyphs.ascent - (glyphs.ascent + glyphs.descent - 1) / 2;
const TILE_HEIGHT = PAD_TOP + 1 + PAD_BOTTOM;
const BASELINE_IN_TILE = PAD_TOP + BASELINE;

const WORD = glyphs.words.pracuj;
const SUFFIX = glyphs.words[".be"];
const TILE_WIDTH = PAD_X + SUFFIX.width + PAD_X;
/** Szerokość całego znaku w em (słowo + odstęp + kafelek). */
const LOGO_WIDTH = WORD.width + GAP + TILE_WIDTH;

const n = (value) => Number(value.toFixed(3));
const glyphPath = (word, x, baseline, size, fill) =>
  `<path transform="translate(${n(x)} ${n(baseline)}) scale(${n(size)})" fill="${fill}" d="${word.d}"/>`;

/**
 * Kwadratowa ikona: ten sam kafelek co sufiks logo, dociągnięty do kwadratu.
 * `fontRatio` = rozmiar fontu / bok; `rounded` = zaokrąglenie .22em (ikona „any”, favicon),
 * bez zaokrąglenia dla maskable i apple-touch (system nakłada własną maskę).
 */
function iconSvg(side, { fontRatio, rounded }) {
  const size = side * fontRatio;
  const x = (side - SUFFIX.width * size) / 2;
  const baseline = side / 2 - (TILE_HEIGHT * size) / 2 + BASELINE_IN_TILE * size;
  const radius = rounded ? n(RADIUS * size) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">` +
    `<rect width="${side}" height="${side}" rx="${radius}" fill="${RED}"/>` +
    glyphPath(SUFFIX, x, baseline, size, WHITE) +
    `</svg>`;
}

// Ikona „any” = kafelek o szerokości sufiksu z logo (bok = szerokość kafelka).
const ANY = { fontRatio: 1 / TILE_WIDTH, rounded: true };
// Maskable: treść w strefie bezpiecznej (koło 80% boku) — tekst ~57% szerokości.
const MASKABLE = { fontRatio: 0.42, rounded: false };
// iOS sam zaokrągla rogi; pełne tło bez przezroczystości.
const APPLE = { fontRatio: 1 / TILE_WIDTH, rounded: false };

/** Pełny znak „pracuj.be” wyśrodkowany na białym tle (Open Graph 1200×630). */
function ogSvg(width, height, size) {
  const x = (width - LOGO_WIDTH * size) / 2;
  const top = (height - TILE_HEIGHT * size) / 2;
  const baseline = top + BASELINE_IN_TILE * size;
  const tileX = x + (WORD.width + GAP) * size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${WHITE}"/>` +
    glyphPath(WORD, x, baseline, size, INK) +
    `<rect x="${n(tileX)}" y="${n(top)}" width="${n(TILE_WIDTH * size)}" height="${n(TILE_HEIGHT * size)}" rx="${n(RADIUS * size)}" fill="${RED}"/>` +
    glyphPath(SUFFIX, tileX + PAD_X * size, baseline, size, WHITE) +
    `</svg>`;
}

// Favicon wektorowy (64×64 jak dotąd) — kontury, bez zależności od fontu przeglądarki.
const favicon = iconSvg(64, ANY).replace(
  "<svg ",
  '<svg role="img" aria-label="Pracuj.be" ',
);
writeFileSync(join(PUBLIC, "icon.svg"), `${favicon}\n`);
console.log("wrote icon.svg");

const pngs = [
  ["icon-32.png", 32, ANY],
  ["icon-192.png", 192, ANY],
  ["icon-512.png", 512, ANY],
  ["icon-maskable-192.png", 192, MASKABLE],
  ["icon-maskable-512.png", 512, MASKABLE],
  ["apple-touch-icon.png", 180, APPLE],
];

for (const [name, side, options] of pngs) {
  await sharp(Buffer.from(iconSvg(side, options)), { density: 72 })
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, name));
  console.log("wrote", name);
}

// Obraz udostępniania: wspólny dla PL/NL/FR/EN, więc bez tekstu poza znakiem.
await sharp(Buffer.from(ogSvg(1200, 630, 140)))
  .flatten({ background: WHITE })
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, "og.png"));
console.log("wrote og.png");
