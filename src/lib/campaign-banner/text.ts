import { UNITS_PER_EM, WIDTHS_400, WIDTHS_700 } from './metrics.generated';

/**
 * Pomiar i łamanie tekstu baneru (#175) bez przeglądarki: szerokości znaków osadzonego DM Sans
 * (`metrics.generated.ts`). Znak spoza fontu (przeglądarka weźmie wtedy font zastępczy) liczymy
 * ostrożnie jako 1,25 em, a do każdego znaku dodajemy 0,5 px (przeglądarka może zaokrąglać
 * pozycje glifów do pełnych pikseli) — tekst zmieści się albo zostanie skrócony, nigdy nie
 * wyjdzie poza pole.
 */

export type FontWeight = 400 | 700;

const FALLBACK_EM = 1.25;
const PER_GLYPH_PX = 0.5;
const ELLIPSIS = '…';

/** Znaki sterujące i formatujące (np. nadpisania kierunku) nie trafiają do grafiki. */
export function cleanBannerText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function measureText(text: string, size: number, weight: FontWeight, letterSpacingEm = 0): number {
  const table = weight === 700 ? WIDTHS_700 : WIDTHS_400;
  let units = 0;
  let count = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    units += table[cp] ?? FALLBACK_EM * UNITS_PER_EM;
    count += 1;
  }
  return (units / UNITS_PER_EM) * size + letterSpacingEm * size * count + PER_GLYPH_PX * count;
}

/** Tekst w jednej linii o szerokości ≤ `maxWidth`; za długi skrócony z „…”. */
export function truncateText(text: string, size: number, weight: FontWeight, maxWidth: number): string {
  if (measureText(text, size, weight) <= maxWidth) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (measureText(candidate, size, weight) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? '' : chars.slice(0, low).join('').trimEnd() + ELLIPSIS;
}

/**
 * Łamie tekst po wyrazach na najwyżej `maxLines` linii o szerokości ≤ `maxWidth`.
 * Zwraca `null`, gdy tekst się nie mieści (wywołujący próbuje mniejszego kroju).
 */
export function wrapText(
  text: string,
  size: number,
  weight: FontWeight,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, size, weight) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (!line || measureText(word, size, weight) > maxWidth) return null;
    lines.push(line);
    if (lines.length === maxLines) return null;
    line = word;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/**
 * Najmniejsza kolejna wielkość z `sizes`, przy której tekst mieści się w `maxLines`; gdy żadna,
 * najmniejszy krój z ostatnią linią skróconą „…”.
 */
export function fitText(
  text: string,
  sizes: readonly number[],
  weight: FontWeight,
  maxWidth: number,
  maxLines: number,
): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrapText(text, size, weight, maxWidth, maxLines);
    if (lines) return { size, lines };
  }
  const size = sizes[sizes.length - 1] ?? 16;
  const words = text.split(' ');
  const lines: string[] = [];
  let index = 0;
  while (lines.length < maxLines - 1 && index < words.length) {
    let line = '';
    while (index < words.length) {
      const candidate = line ? `${line} ${words[index]}` : (words[index] ?? '');
      if (measureText(candidate, size, weight) > maxWidth) break;
      line = candidate;
      index += 1;
    }
    // Wyraz dłuższy od linii trafia do ostatniej, skróconej linii.
    if (!line) break;
    lines.push(line);
  }
  const rest = words.slice(index).join(' ');
  if (rest) {
    const last = truncateText(rest, size, weight, maxWidth);
    if (last) lines.push(last);
  }
  return { size, lines };
}
