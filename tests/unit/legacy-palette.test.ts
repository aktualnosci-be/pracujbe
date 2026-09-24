import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * #7 — po wdrożeniu stylu „Ludzie i praca” (biel, czerwień #D92932, czerń, DM Sans) w kodzie
 * aplikacji nie może zostać historyczna paleta granatowa (#0F2A47 / #2563EB i jej pochodne
 * z dawnych makiet) ani font Inter. Skanujemy wszystko, co trafia do bundla lub jest
 * serwowane (src/, public/, konfiguracje Tailwind/Next). Dokumentacja historyczna
 * (docs/DESIGN_SCREENS.md, audyty) i sam prototyp są poza zakresem.
 */

const ROOT = process.cwd();
const SCANNED_DIRS = ['src', 'public'];
const SCANNED_FILES = ['tailwind.config.ts', 'next.config.mjs'];
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.html', '.svg', '.webmanifest', '.md', '.txt',
]);

/** Wzorce dawnej palety i fontu. Każdy ma nazwę do czytelnego raportu. */
const LEGACY_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'granat #0F2A47', pattern: /#0F2A47\b/i },
  { name: 'błękit #2563EB', pattern: /#2563EB\b/i },
  { name: 'jasny błękit #60A5FA', pattern: /#60A5FA\b/i },
  { name: 'dawny muted #566881', pattern: /#566881\b/i },
  { name: 'granat rgb(15,42,71)', pattern: /rgba?\(\s*15\s*,\s*42\s*,\s*71\b/ },
  { name: 'błękit rgb(37,99,235)', pattern: /rgba?\(\s*37\s*,\s*99\s*,\s*235\b/ },
  { name: 'granat HSL 211 65% 17%', pattern: /\b211(?:\.\d+)?\s+6[45](?:\.\d+)?%\s+1[78](?:\.\d+)?%/ },
  { name: 'błękit HSL 221 83% 53%', pattern: /\b221(?:\.\d+)?\s+8[23](?:\.\d+)?%\s+5[23](?:\.\d+)?%/ },
  { name: 'font Inter w font-family', pattern: /font-family\s*:[^;"'`}]*\bInter\b/i },
  { name: 'font Inter z next/font', pattern: /\bInter\s*\(\s*\{|from\s+['"]next\/font\/google['"][^\n]*\bInter\b/ },
  { name: 'plik fontu Inter', pattern: /\bInter[-_ ]?(?:latin|var|Variable)?\.(?:woff2?|ttf)\b/i },
];

function findLegacy(source: string): string[] {
  return LEGACY_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe('brak starej palety granatowej i fontu Inter (#7)', () => {
  const files = [
    ...SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
    ...SCANNED_FILES.map((file) => join(ROOT, file)),
  ];

  it('skanuje realny zbiór plików', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('żaden plik źródłowy ani publiczny nie zawiera dawnej palety ani Inter', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!TEXT_EXTENSIONS.has(extname(file))) continue;
      const hits = findLegacy(readFileSync(file, 'utf-8'));
      if (hits.length) offenders.push(`${relative(ROOT, file)}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('w repozytorium nie ma pliku fontu Inter', () => {
    const fonts = files.filter((file) => /\.(woff2?|ttf|otf)$/i.test(file));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((file) => /inter/i.test(file))).toEqual([]);
  });

  it('kontrola ujemna: każdy wzorzec wykrywa dawną wartość', () => {
    const samples = [
      "--primary: #0F2A47;",
      "className='text-[#2563eb]'",
      "--accent-on-dark: #60A5FA;",
      "color: #566881",
      "shadow-[0_-4px_12px_rgba(15,42,71,0.08)]",
      "background: rgb(37, 99, 235)",
      "--primary: 211 65% 17%;",
      "--accent: 221.2 83.2% 53.3%;",
      "body{font-family:Inter,system-ui}",
      "const inter = Inter({ subsets: ['latin'] })",
      "src: url('/fonts/Inter-latin.woff2')",
    ];
    for (const sample of samples) expect(findLegacy(sample), sample).not.toEqual([]);
    expect(new Set(samples.flatMap(findLegacy)).size).toBe(LEGACY_PATTERNS.length);
  });

  it('kontrola dodatnia: obecne tokeny marki i słowa zawierające „inter” nie są fałszywym alarmem', () => {
    expect(findLegacy('--primary: 357 69.8% 50.6%; color: #D92932; font-family: DM Sans')).toEqual([]);
    expect(findLegacy('pointer-events-none; interactive; International')).toEqual([]);
  });
});
