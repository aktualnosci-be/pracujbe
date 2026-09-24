import { cleanBannerText, fitText, measureText, truncateText, type FontWeight } from './text';

/**
 * Baner kampanii z prawdziwej oferty (#175). Geometria wzorów z
 * `docs/design/people-passport/prototype/materials/banner-*.svg`, znak jak `Logo.tsx`, kolory =
 * tokeny `--pp-*` z `src/app/globals.css` (strażnik: tests/unit/campaign-banner.test.ts).
 *
 * Wejście to wyłącznie pola oferty z `get_managed_campaign_job` (0099) i etykiety z
 * `src/messages` — bez danych osobowych. Każdy tekst przechodzi przez `cleanBannerText` i
 * `escapeXml`; SVG nie ma skryptów, obrazów ani odnośników poza adresem oferty w pracuj.be.
 */

export const SITE_ORIGIN = 'https://pracuj.be';
const FONT_FAMILY = 'PracujDMSans';

/** Tokeny `--pp-*` użyte w banerze (nazwa tokenu → wartość z globals.css). */
export const BANNER_PALETTE = {
  '--pp-white': '#ffffff',
  '--pp-ink': '#151515',
  '--pp-red': '#d92932',
  '--pp-photo-bg': '#f5f5f5',
  '--pp-line-card': '#dedede',
  '--pp-text-hero': '#666666',
} as const;

const C = {
  bg: BANNER_PALETTE['--pp-white'],
  ink: BANNER_PALETTE['--pp-ink'],
  red: BANNER_PALETTE['--pp-red'],
  onRed: BANNER_PALETTE['--pp-white'],
  card: BANNER_PALETTE['--pp-photo-bg'],
  line: BANNER_PALETTE['--pp-line-card'],
  muted: BANNER_PALETTE['--pp-text-hero'],
};

export const BANNER_FORMATS = ['1200x300', '300x250', '300x600'] as const;
export type BannerFormat = (typeof BANNER_FORMATS)[number];

export function isBannerFormat(value: unknown): value is BannerFormat {
  return typeof value === 'string' && (BANNER_FORMATS as readonly string[]).includes(value);
}

export function bannerSize(format: BannerFormat): { width: number; height: number } {
  const [width, height] = format.split('x').map(Number) as [number, number];
  return { width, height };
}

/** Pola oferty potrzebne grafice (kontrakt kolumn 0099). */
export interface BannerJob {
  slug: string;
  title: string;
  companyName: string;
  city: string;
}

/** Teksty z `src/messages` w języku baneru oraz sformatowane wartości oferty. */
export interface BannerTexts {
  eyebrow: string;
  cta: string;
  /** Sformatowana stawka albo `null` (bez kwoty = brak pola). */
  salary: string | null;
  /** Rodzaj umowy / zakwaterowanie — np. „Umowa na stałe · Z zakwaterowaniem”. */
  conditions: string | null;
  /** Nazwa dostępna (title SVG), np. „Pracuj.be — oferta pracy: …”. */
  accessibleName: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE = /^(?:pl|nl|fr|en)$/;

export class BannerInputError extends Error {
  constructor(field: string) {
    super(`campaign-banner: nieprawidłowe pole ${field}`);
    this.name = 'BannerInputError';
  }
}

export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  );
}

export function bannerJobUrl(slug: string, locale: string): string {
  if (!SLUG.test(slug) || slug.length > 200) throw new BannerInputError('slug');
  if (!LOCALE.test(locale)) throw new BannerInputError('locale');
  return `${SITE_ORIGIN}/${locale}/oferty-pracy/${slug}`;
}

interface TextOptions {
  x: number;
  y: number;
  size: number;
  weight: FontWeight;
  fill: string;
  letterSpacingEm?: number;
}

function text(value: string, o: TextOptions): string {
  if (!value) return '';
  const spacing = o.letterSpacingEm ? ` letter-spacing="${round(o.letterSpacingEm * o.size)}"` : '';
  return `<text x="${round(o.x)}" y="${round(o.y)}" font-size="${round(o.size)}" font-weight="${o.weight}" fill="${o.fill}"${spacing}>${escapeXml(value)}</text>`;
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Znak Pracuj.be jak `Logo.tsx`: „pracuj” + biały „.be” na czerwonym kafelku (wszystko w em). */
function logo(x: number, y: number, size: number): string {
  const word = 'pracuj';
  const suffix = '.be';
  // Kafelek liczony od szerokości bez zapasu na zaokrąglenia (jak w przeglądarce).
  const wordWidth = measureText(word, size, 700, -0.052) - 0.5 * word.length;
  const suffixWidth = measureText(suffix, size, 700, -0.055) - 0.5 * suffix.length;
  const tileX = wordWidth + 0.09 * size;
  const tileWidth = suffixWidth + 0.34 * size;
  const baseline = 0.89 * size;
  return [
    `<g transform="translate(${round(x)} ${round(y)})" aria-hidden="true">`,
    text(word, { x: 0, y: baseline, size, weight: 700, fill: C.ink, letterSpacingEm: -0.052 }),
    `<rect x="${round(tileX)}" y="0" width="${round(tileWidth)}" height="${round(1.19 * size)}" rx="${round(0.22 * size)}" fill="${C.red}"/>`,
    text(suffix, { x: tileX + 0.17 * size, y: baseline, size, weight: 700, fill: C.onRed, letterSpacingEm: -0.055 }),
    '</g>',
  ].join('');
}

interface Block {
  x: number;
  top: number;
  bottom: number;
  maxWidth: number;
  maxLines: number;
  sizes: readonly number[];
  /** `center` = blok wyśrodkowany w pionie w [top, bottom]; `top` = od górnej krawędzi. */
  align: 'center' | 'top';
}

const LINE_HEIGHT = 1.17;
const ASCENT = 0.78;

function titleBlock(value: string, b: Block): string {
  const { size, lines } = fitText(value, b.sizes, 700, b.maxWidth, b.maxLines);
  const height = size + (lines.length - 1) * LINE_HEIGHT * size;
  const top = b.align === 'center' ? b.top + (b.bottom - b.top - height) / 2 : b.top;
  return lines
    .map((line, index) =>
      text(line, { x: b.x, y: top + ASCENT * size + index * LINE_HEIGHT * size, size, weight: 700, fill: C.ink }),
    )
    .join('');
}

function line(value: string | null, o: TextOptions & { maxWidth: number }): string {
  if (!value) return '';
  return text(truncateText(value, o.size, o.weight, o.maxWidth), o);
}

function button(href: string, cta: string, b: { x: number; y: number; width: number }): string {
  const size = 16;
  const label = truncateText(`${cta} →`, size, 700, b.width - 34);
  return [
    `<a href="${escapeXml(href)}" target="_blank" rel="noopener">`,
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="48" rx="12" fill="${C.red}"/>`,
    text(label, { x: b.x + 17, y: b.y + 30, size, weight: 700, fill: C.onRed }),
    '</a>',
  ].join('');
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = ' · '): string | null {
  const kept = parts.map((p) => cleanBannerText(p)).filter(Boolean);
  return kept.length > 0 ? kept.join(separator) : null;
}

function body(format: BannerFormat, job: BannerJob, t: BannerTexts, href: string): string {
  const title = cleanBannerText(job.title);
  const company = cleanBannerText(job.companyName);
  const city = cleanBannerText(job.city);
  const salary = cleanBannerText(t.salary) || null;
  const conditions = cleanBannerText(t.conditions) || null;
  const eyebrow = cleanBannerText(t.eyebrow).toLocaleUpperCase();
  const cta = cleanBannerText(t.cta);

  if (format === '1200x300') {
    return [
      logo(42, 28, 36),
      titleBlock(title, { x: 42, top: 88, bottom: 196, maxWidth: 690, maxLines: 2, sizes: [46, 40, 34], align: 'center' }),
      line(joinNonEmpty([company, city]), { x: 42, y: 240, size: 21, weight: 400, fill: C.muted, maxWidth: 690 }),
      `<rect x="768" y="24" width="406" height="252" rx="25" fill="${C.card}"/>`,
      line(eyebrow, { x: 797, y: 66, size: 13, weight: 400, fill: C.muted, maxWidth: 348 }),
      `<line x1="795" y1="99" x2="1145" y2="99" stroke="${C.line}"/>`,
      salary
        ? line(salary, { x: 797, y: 137, size: 27, weight: 700, fill: C.red, maxWidth: 348 })
        : line(city, { x: 797, y: 137, size: 27, weight: 700, fill: C.ink, maxWidth: 348 }),
      line(salary ? joinNonEmpty([city, conditions]) : conditions, {
        x: 797, y: 171, size: 18, weight: 400, fill: C.muted, maxWidth: 348,
      }),
      button(href, cta, { x: 797, y: 199, width: 250 }),
    ].join('');
  }

  if (format === '300x250') {
    return [
      logo(22, 19, 25.2),
      titleBlock(title, { x: 22, top: 68, bottom: 146, maxWidth: 256, maxLines: 2, sizes: [30, 26, 22], align: 'center' }),
      line(salary ?? joinNonEmpty([company, city]), {
        x: 22, y: 170, size: 14, weight: salary ? 700 : 400, fill: salary ? C.red : C.muted, maxWidth: 256,
      }),
      button(href, cta, { x: 22, y: 184, width: 220 }),
    ].join('');
  }

  return [
    logo(24, 28, 30.6),
    titleBlock(title, { x: 24, top: 100, bottom: 240, maxWidth: 252, maxLines: 3, sizes: [34, 30, 26], align: 'top' }),
    `<rect x="24" y="260" width="252" height="187" rx="19" fill="${C.card}"/>`,
    line(eyebrow, { x: 43, y: 293, size: 11, weight: 400, fill: C.muted, maxWidth: 214 }),
    line(company, { x: 43, y: 333, size: 20, weight: 700, fill: C.ink, maxWidth: 214 }),
    line(city, { x: 43, y: 364, size: 17, weight: 700, fill: C.ink, maxWidth: 214 }),
    line(salary, { x: 43, y: 395, size: 19, weight: 700, fill: C.red, maxWidth: 214 }),
    line(conditions, { x: 24, y: 487, size: 15, weight: 400, fill: C.muted, maxWidth: 252 }),
    button(href, cta, { x: 24, y: 515, width: 252 }),
  ].join('');
}

export interface RenderBannerInput {
  format: BannerFormat;
  locale: string;
  job: BannerJob;
  texts: BannerTexts;
  /** Font DM Sans (woff2) osadzany w SVG — bez niego przeglądarka użyje Arial. */
  fontWoff2Base64?: string;
}

export function renderCampaignBanner({ format, locale, job, texts, fontWoff2Base64 }: RenderBannerInput): string {
  if (!isBannerFormat(format)) throw new BannerInputError('format');
  if (!cleanBannerText(job.title)) throw new BannerInputError('title');
  if (!cleanBannerText(job.companyName)) throw new BannerInputError('companyName');
  if (!cleanBannerText(texts.cta)) throw new BannerInputError('cta');
  const href = bannerJobUrl(job.slug, locale);
  const { width, height } = bannerSize(format);
  const font =
    fontWoff2Base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(fontWoff2Base64)
      ? `<style>@font-face{font-family:'${FONT_FAMILY}';src:url(data:font/woff2;base64,${fontWoff2Base64}) format('woff2');font-weight:400 800;}</style>`
      : '';
  const name = escapeXml(cleanBannerText(texts.accessibleName));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${name}" lang="${locale}">`,
    `<title>${name}</title>`,
    font,
    `<rect width="${width}" height="${height}" fill="${C.bg}"/>`,
    `<g font-family="${FONT_FAMILY}, Arial, sans-serif" style="font-optical-sizing:none;font-variation-settings:'opsz' 9">`,
    body(format, job, texts, href),
    '</g></svg>',
  ].join('');
}
