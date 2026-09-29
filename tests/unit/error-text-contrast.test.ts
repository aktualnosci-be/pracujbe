import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * #1053 (A11Y-03) — tekst błędu na jasnym, zabarwionym tle (`bg-error/10`, `bg-error/5`, `bg-soft`)
 * miał kontrast ≈ 4,1–4,45:1 (< 4,5:1, WCAG 2.2 AA 1.4.3), bo używał tokenu tła `--error`.
 * Do tekstu służy `--error-text`. Test liczy kontrast z prawdziwych tokenów `globals.css`
 * i pilnuje, że w `src/` nie zostało gołe `text-error` (kontrola ujemna: stary token nie przechodzi).
 */

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

function hslToken(name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(css);
  if (!m) throw new Error(`Brak tokenu --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

type Rgb = [number, number, number];

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i]! * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = hslToRgb(hslToken('background'));
const SOFT = hslToRgb(hslToken('soft'));
const MUTED = hslToRgb(hslToken('muted'));
const ERROR = hslToRgb(hslToken('error'));
const ERROR_TEXT = hslToRgb(hslToken('error-text'));

const BACKGROUNDS: readonly { name: string; rgb: Rgb }[] = [
  { name: 'białe', rgb: WHITE },
  { name: '--soft', rgb: SOFT },
  { name: '--muted', rgb: MUTED },
  { name: 'error/10 na białym', rgb: over(ERROR, 0.1, WHITE) },
  { name: 'error/10 na --soft', rgb: over(ERROR, 0.1, SOFT) },
  { name: 'error/5 na białym', rgb: over(ERROR, 0.05, WHITE) },
];

describe('kontrast tekstu błędu (#1053)', () => {
  it.each(BACKGROUNDS)('--error-text ma ≥ 4,5:1 na tle: $name', ({ rgb }) => {
    expect(contrast(ERROR_TEXT, rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it('kontrola ujemna: token tła --error na error/10 nie spełnia AA', () => {
    expect(contrast(ERROR, over(ERROR, 0.1, WHITE))).toBeLessThan(4.5);
    expect(contrast(ERROR, over(ERROR, 0.1, SOFT))).toBeLessThan(4.5);
  });
});

/** Goły `text-error` (także z wariantem `hover:`), ale nie `text-error-text`. */
const BARE_TEXT_ERROR = /(?<![\w-])(?:[\w-]+:)*text-error(?![-\w])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

describe('strażnik klasy tekstu błędu (#1053)', () => {
  it('w src/ nie ma gołego text-error (do tekstu służy text-error-text)', () => {
    const offenders = walk(join(ROOT, 'src'))
      .filter((f) => BARE_TEXT_ERROR.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('kontrola ujemna: wzorzec łapie text-error i hover:text-error, nie text-error-text', () => {
    expect(BARE_TEXT_ERROR.test('bg-error/10 p-3 text-sm text-error')).toBe(true);
    expect(BARE_TEXT_ERROR.test('hover:bg-background hover:text-error disabled')).toBe(true);
    expect(BARE_TEXT_ERROR.test('text-error"')).toBe(true);
    expect(BARE_TEXT_ERROR.test('bg-error/10 text-error-text')).toBe(false);
  });
});
