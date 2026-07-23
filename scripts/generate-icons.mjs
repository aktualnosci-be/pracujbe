// Generuje ikony PWA/favicon z marki „Pracuj.be" (granatowy kwadrat + biała „P" + pin),
// spójnej z src/components/brand/Logo.tsx. Rasteryzacja SVG -> PNG przez sharp.
// Uruchom: node scripts/generate-icons.mjs   (pliki lądują w public/).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const NAVY = '#0F2A47'; // --primary (marka)
const WHITE = '#FFFFFF';

// Znak (P + pin) w viewBox 0..32 — te same ścieżki co w Logo.tsx.
const markPaths = (fill) => `
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M11 8.5 h6.2 a5.3 5.3 0 0 1 0 10.6 H14 V23.5 H11 Z M14 11.3 h2.4 a2.6 2.6 0 0 1 0 5.2 H14 Z"
    fill="${fill}"/>
  <path d="M22.6 17.4 a2.5 2.5 0 0 1 2.5 2.5 c0 1.9 -2.5 4.1 -2.5 4.1 s-2.5 -2.2 -2.5 -4.1 a2.5 2.5 0 0 1 2.5 -2.5 Z"
    fill="${fill}" opacity="0.7"/>`;

// Ikona „any": zaokrąglony granatowy kwadrat + biały znak (pełna szerokość).
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="0" y="0" width="32" height="32" rx="8" fill="${NAVY}"/>
  ${markPaths(WHITE)}
</svg>`;

// Ikona „maskable": pełne granatowe tło (bez zaokrągleń), znak w strefie bezpiecznej (~62%).
const maskableSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="0" y="0" width="32" height="32" fill="${NAVY}"/>
  <g transform="translate(6 6) scale(0.625)">${markPaths(WHITE)}</g>
</svg>`;

const jobs = [
  ['icon-192.png', iconSvg(192), 192],
  ['icon-512.png', iconSvg(512), 512],
  ['icon-maskable-192.png', maskableSvg(192), 192],
  ['icon-maskable-512.png', maskableSvg(512), 512],
  ['apple-touch-icon.png', iconSvg(180), 180],
  ['icon-32.png', iconSvg(32), 32],
];

for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(PUBLIC, name));
  console.log('wrote', name);
}

// Obraz Open Graph / social (1200x630) — granatowa karta z logo, wordmarkiem i hasłem.
const ACCENT = '#2563EB';
const SOFT = '#CBD5E1';
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${NAVY}"/>
  <g transform="translate(96 210)">
    <rect x="0" y="0" width="140" height="140" rx="32" fill="${WHITE}"/>
    <g transform="translate(18 18) scale(3.25)">${markPaths(NAVY)}</g>
  </g>
  <text x="270" y="300" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="800" fill="${WHITE}">Pracuj<tspan fill="${ACCENT}">.be</tspan></text>
  <text x="272" y="372" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="500" fill="${SOFT}">Praca w Belgii — szybko i bez CV</text>
  <rect x="96" y="470" width="1008" height="4" rx="2" fill="${ACCENT}" opacity="0.5"/>
  <text x="96" y="536" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="${SOFT}">Werk in Belgie · Travail en Belgique · Work in Belgium</text>
</svg>`;
await sharp(Buffer.from(ogSvg)).png().toFile(join(PUBLIC, 'og.png'));
console.log('wrote og.png');

console.log('done');
