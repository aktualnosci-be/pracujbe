// Generuje komplet ikon PWA i grafikę Open Graph z zatwierdzonego kafelka `.be`.
// Uruchom: node scripts/generate-icons.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const RED = "#D92932";
const INK = "#151515";
const WHITE = "#FFFFFF";
const SOFT = "#F7F7F7";

const beText = (x, y, size) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" ` +
  `font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" fill="${WHITE}">.be</text>`;

const iconSvg = (size, maskable = false) => {
  const margin = maskable ? 0 : Math.round(size * 0.08);
  const side = size - margin * 2;
  const radius = maskable ? 0 : Math.round(size * 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${maskable ? RED : WHITE}"/>
    ${maskable ? "" : `<rect x="${margin}" y="${margin}" width="${side}" height="${side}" rx="${radius}" fill="${RED}"/>`}
    ${beText(size / 2, size / 2, Math.round(size * (maskable ? 0.34 : 0.31)))}
  </svg>`;
};

const jobs = [
  ["icon-32.png", iconSvg(32), 32],
  ["icon-192.png", iconSvg(192), 192],
  ["icon-512.png", iconSvg(512), 512],
  ["icon-maskable-192.png", iconSvg(192, true), 192],
  ["icon-maskable-512.png", iconSvg(512, true), 512],
  ["apple-touch-icon.png", iconSvg(180, true), 180],
];

for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(PUBLIC, name));
  console.log("wrote", name);
}

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${SOFT}"/>
  <rect x="70" y="70" width="1060" height="490" rx="44" fill="${WHITE}"/>
  <text x="645" y="330" text-anchor="end" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="122" font-weight="700" fill="${INK}">pracuj</text>
  <rect x="674" y="230" width="238" height="170" rx="34" fill="${RED}"/>
  ${beText(793, 315, 102)}
  <rect x="210" y="470" width="210" height="12" rx="6" fill="#D9D9D9"/>
  <rect x="455" y="470" width="290" height="12" rx="6" fill="${RED}"/>
  <rect x="780" y="470" width="210" height="12" rx="6" fill="#D9D9D9"/>
</svg>`;

await sharp(Buffer.from(ogSvg)).png().toFile(join(PUBLIC, "og.png"));
console.log("wrote og.png");
