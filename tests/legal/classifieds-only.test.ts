// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ErrorCodes, toUserMessageKey } from '@/lib/errors';
import {
  PORTAL_LEGAL_MODE_ENV,
  RECRUITMENT_FEATURES,
  isRecruitmentEnabled,
  portalLegalMode,
} from '@/lib/portal-mode';

/**
 * Strażnik CI trybu ogłoszeniowego (#1146, epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Zbiera w jednym miejscu invarianty trybu `CLASSIFIEDS_ONLY`. Wersja startowa egzekwuje to, co
 * istnieje dziś (moduł flagi fail-closed, jedno źródło trybu, konfiguracja środowisk, skaner tras
 * z listą chronionych segmentów). Invarianty zależne od kolejnych PR-ów są `it.todo` z numerem
 * issue — PR wyłączający daną funkcję zamienia swój `todo` na asercję z kontrolą ujemną
 * (np. dopisuje trasę do `GUARDED_ROUTES` ze statusem `enforced`).
 *
 * Uruchamiany w jobie `unit` (`npm run test`, projekt Vitest `legal`) — bez nowego joba CI.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('flaga trybu: fail-closed', () => {
  it('środowisko testów nie włącza rekrutacji domyślnie (brak zmiennej = CLASSIFIEDS_ONLY)', () => {
    // Czerwony, jeśli ktoś ustawi RECRUITMENT globalnie (setup, config, CI env joba unit).
    expect(process.env[PORTAL_LEGAL_MODE_ENV] ?? '').not.toMatch(/^\s*recruitment\s*$/i);
    expect(portalLegalMode()).toBe('CLASSIFIEDS_ONLY');
    expect(isRecruitmentEnabled()).toBe(false);
    for (const feature of RECRUITMENT_FEATURES) expect(isRecruitmentEnabled(feature)).toBe(false);
  });

  it('konfiguracja Vitest i setup nie ustawiają trybu globalnie', () => {
    for (const file of ['vitest.config.ts', 'tests/setup.ts']) {
      expect(read(file), file).not.toMatch(/PORTAL_LEGAL_MODE/);
    }
  });

  it('job `unit` w CI nie ustawia PORTAL_LEGAL_MODE', () => {
    const ci = read('.github/workflows/ci.yml');
    const unit = ci.split(/\n {2}(?=[a-z0-9-]+:\n)/).find((block) => block.startsWith('unit:')) ?? '';
    expect(unit.length).toBeGreaterThan(0);
    expect(unit).not.toMatch(/PORTAL_LEGAL_MODE/);
  });

  it('.env.example: zmienna pusta (pusta = tryb ogłoszeniowy)', () => {
    const line = read('.env.example').split('\n').find((l) => l.startsWith(`${PORTAL_LEGAL_MODE_ENV}=`));
    expect(line).toBeDefined();
    expect(line!.replace(`${PORTAL_LEGAL_MODE_ENV}=`, '').replace(/["']/g, '').trim()).toBe('');
  });

  it('kod RECRUITMENT_DISABLED ma komunikat w 4 językach', () => {
    expect(ErrorCodes.RECRUITMENT_DISABLED).toBe('RECRUITMENT_DISABLED');
    const key = toUserMessageKey('RECRUITMENT_DISABLED').replace(/^errors\./, '');
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(read(`src/messages/${locale}.json`)) as { errors: Record<string, unknown> };
      expect(typeof messages.errors[key], locale).toBe('string');
    }
  });

  it('lista funkcji rekrutacyjnych jest kompletna (strażnik pokrycia)', () => {
    expect([...RECRUITMENT_FEATURES].sort()).toEqual(
      ['applications', 'candidateSearch', 'cvAccess', 'cvImport', 'guestApply', 'matching', 'messaging', 'offers', 'screening'],
    );
  });
});

describe('jedno źródło trybu', () => {
  const sources = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))].filter((f) =>
    /\.(ts|tsx|mjs|js)$/.test(f),
  );

  /** Zwraca pliki, które czytają zmienną trybu inaczej niż przez `src/lib/portal-mode.ts`. */
  function directReaders(files: { path: string; source: string }[]): string[] {
    return files
      .filter((f) => f.path !== 'src/lib/portal-mode.ts')
      .filter((f) => /process\.env(\.PORTAL_LEGAL_MODE|\[\s*['"]PORTAL_LEGAL_MODE['"]\s*\])/.test(f.source))
      .map((f) => f.path);
  }

  it('tylko src/lib/portal-mode.ts czyta PORTAL_LEGAL_MODE z process.env', () => {
    const files = sources.map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, 'utf8') }));
    expect(directReaders(files)).toEqual([]);
  });

  it('kontrola ujemna: plik z bezpośrednim odczytem jest wykrywany', () => {
    const mutant = { path: 'src/lib/actions/x.ts', source: "if (process.env.PORTAL_LEGAL_MODE === 'RECRUITMENT') {}" };
    const mutant2 = { path: 'src/lib/y.ts', source: "process.env['PORTAL_LEGAL_MODE']" };
    expect(directReaders([mutant, mutant2])).toEqual(['src/lib/actions/x.ts', 'src/lib/y.ts']);
  });
});

/**
 * Trasy rekrutacyjne: strona (albo layout segmentu) musi wołać `notFoundUnlessRecruitment()`.
 * `pending` = wyłączenie należy do innego PR-a (numer issue) — dziś tylko sprawdzamy, że trasa
 * istnieje (lista nie gnije). PR wyłączający trasę zmienia status na `enforced`.
 */
type GuardedRoute = { segment: string; status: 'enforced' | 'pending'; issue: number };
const GUARDED_ROUTES: GuardedRoute[] = [
  { segment: 'employer/kandydaci', status: 'enforced', issue: 1133 },
  { segment: 'candidate/oferty-polecane', status: 'enforced', issue: 1139 },
  { segment: 'employer/aplikacje', status: 'enforced', issue: 1144 },
  { segment: 'candidate/aplikacje', status: 'enforced', issue: 1144 },
  { segment: 'candidate/propozycje', status: 'enforced', issue: 1141 },
  { segment: '(auth)/aplikacja', status: 'enforced', issue: 1132 },
  { segment: 'candidate/profil/import-cv', status: 'pending', issue: 1129 },
];

const LOCALE_APP = join(ROOT, 'src/app/[locale]');

/** Czy segment (jego layout albo KAŻDA strona w poddrzewie) woła strażnika. */
function segmentGuarded(dir: string, readFile: (p: string) => string = (p) => readFileSync(p, 'utf8')): boolean {
  const CALL = /notFoundUnlessRecruitment\s*\(/;
  const layout = join(dir, 'layout.tsx');
  if (existsSync(layout) && CALL.test(readFile(layout))) return true;
  const pages = walk(dir).filter((f) => /\/page\.tsx$/.test(f));
  return pages.length > 0 && pages.every((p) => CALL.test(readFile(p)));
}

describe('trasy rekrutacyjne za notFoundUnlessRecruitment()', () => {
  it.each(GUARDED_ROUTES)('segment $segment istnieje', ({ segment }) => {
    expect(existsSync(join(LOCALE_APP, segment)), segment).toBe(true);
  });

  const enforced = GUARDED_ROUTES.filter((r) => r.status === 'enforced');
  if (enforced.length > 0) {
    it.each(enforced)('segment $segment woła strażnika', ({ segment }) => {
      expect(segmentGuarded(join(LOCALE_APP, segment))).toBe(true);
    });
  }
  for (const r of GUARDED_ROUTES.filter((x) => x.status === 'pending')) {
    it.todo(`segment ${r.segment} woła notFoundUnlessRecruitment() (#${r.issue})`);
  }

  it('kontrola ujemna skanera: strona bez strażnika = niechroniona', () => {
    const dir = join(LOCALE_APP, 'employer/kandydaci');
    expect(segmentGuarded(dir, () => 'export default function Page() { return null; }')).toBe(false);
    expect(segmentGuarded(dir, () => 'notFoundUnlessRecruitment();')).toBe(true);
  });
});

describe('invarianty włączane przez kolejne PR-y epiku #1128', () => {
  // applyToJob, aplikacja gościa, sendOffer, respondToOffer, zmiana statusu, wycofanie i odczyty
  // historii zgłoszeń/propozycji: `tests/legal/classifieds-process-off.test.ts` (#1130/#1132/#1141/#1144).
  it.todo('screening, rozmowy/wiadomości → RECRUITMENT_DISABLED przed bazą (fake-db: zero zapytań) (#1129)');
  it.todo('loadery pracodawcy (kandydaci, top dopasowani, szczegół kandydata/aplikacji, /api/files/cv/*) nie zwracają danych (#1129)');
  it.todo('/api/maintenance nie woła zadań rekrutacyjnych, odpowiedź skipped: classifieds_only (#1143)');
  it.todo('słownik zakazanych etykiet UI na trasach aktywnych w trybie ogłoszeniowym, 4 języki (#1128, teksty)');
  it.todo('jedyne CTA aplikacyjne na szczególe oferty = zewnętrzny kanał ogłoszeniodawcy (#1129/#1130)');
  it.todo('pozytywnie: lista ofert, szczegół, kreator/publikacja, zapisane oferty/wyszukiwania, konto nie zwracają RECRUITMENT_DISABLED (#1128)');
  it.todo('sekcja CL1128 w supabase/tests/rls.sql obejmuje każde RPC z listy w src/lib/portal-mode.ts (#1140)');
  it.todo('tryb efektywny = env × baza, tylko RECRUITMENT × true włącza (#1143)');
});

/**
 * Matching i rekomendacje (#1131, #1133, #1139). Statyczne invarianty kodu; zachowanie w trybie
 * ogłoszeniowym (zero zapytań, `disabled`) sprawdza `tests/unit/classifieds-matching-off.test.ts`.
 */
describe('matching wyłączony w trybie ogłoszeniowym (#1131/#1133/#1139)', () => {
  const guardedDirs = GUARDED_ROUTES.filter((r) => r.status === 'enforced').map((r) => join(LOCALE_APP, r.segment));
  const inGuarded = (file: string) => guardedDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
  const panelFiles = [join(LOCALE_APP, 'employer'), join(LOCALE_APP, 'candidate')]
    .flatMap((dir) => walk(dir))
    .filter((f) => /\.tsx?$/.test(f));

  /** Pliki tras paneli spoza chronionych segmentów importujące komponenty wyniku dopasowania/propozycji. */
  function unguardedMatchImports(files: { path: string; source: string }[]): string[] {
    const IMPORT = /from\s+['"]@\/components\/(ui\/match-bar|employer\/SendOfferButton)['"]/;
    return files.filter((f) => !inGuarded(f.path) && IMPORT.test(f.source)).map((f) => relative(ROOT, f.path));
  }

  it('trasy paneli poza chronionymi segmentami nie importują MatchBar ani SendOfferButton', () => {
    const files = panelFiles.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    expect(unguardedMatchImports(files)).toEqual([]);
  });

  it('kontrola ujemna: pulpit z importem MatchBar jest wykrywany', () => {
    const path = join(LOCALE_APP, 'candidate/page.tsx');
    expect(unguardedMatchImports([{ path, source: "import { MatchBar } from '@/components/ui/match-bar';" }])).toEqual([
      'src/app/[locale]/candidate/page.tsx',
    ]);
    const guarded = join(LOCALE_APP, 'employer/kandydaci/page.tsx');
    expect(unguardedMatchImports([{ path: guarded, source: "import { SendOfferButton } from '@/components/employer/SendOfferButton';" }])).toEqual([]);
  });

  /**
   * Każde zapytanie do `public.matches` w loaderach paneli leży w funkcji, która PRZED nim
   * sprawdza tryb (`isRecruitmentEnabled(` albo lokalne `matchingEnabled(`).
   */
  function ungatedMatchReads(source: string): number[] {
    const offenders: number[] = [];
    for (const m of source.matchAll(/public\.matches\b/g)) {
      const before = source.slice(0, m.index);
      const fnStart = Math.max(before.lastIndexOf('\nexport async function'), before.lastIndexOf('\nasync function'), before.lastIndexOf('\nexport const '), before.lastIndexOf('\nconst '));
      const scope = before.slice(fnStart);
      if (!/(isRecruitmentEnabled|matchingEnabled)\(/.test(scope)) offenders.push(before.split('\n').length);
    }
    return offenders;
  }

  it.each(['src/lib/data/candidate.ts', 'src/lib/data/employer.ts'])('%s: odczyt public.matches tylko za bramką trybu', (file) => {
    const source = read(file);
    // Stała SQL (np. MATCHED_CANDIDATES_SQL) nie jest odczytem — liczą się miejsca użycia w funkcjach.
    const withoutSqlConstants = source.replace(/\nconst [A-Z_]+_SQL = `[\s\S]*?`;/g, '\n');
    expect(ungatedMatchReads(withoutSqlConstants)).toEqual([]);
  });

  it('kontrola ujemna: nowe zapytanie do matches bez bramki jest wykrywane', () => {
    const gated = "\nexport async function a() {\n  if (!isRecruitmentEnabled('matching')) return [];\n  q('SELECT 1 FROM public.matches');\n}";
    const ungated = "\nexport async function b() {\n  q('SELECT 1 FROM public.matches');\n}";
    expect(ungatedMatchReads(gated)).toEqual([]);
    expect(ungatedMatchReads(gated + ungated)).toHaveLength(1);
  });

  it('szczegół oferty renderuje JobMatchCard tylko za isRecruitmentEnabled', () => {
    const page = read('src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx');
    expect(page).toMatch(/isRecruitmentEnabled\('matching'\)\s*\?\s*\(\s*<div data-testid="job-match-slot">\s*<JobMatchCard/);
  });

  it('akcja, loader i materializacja dopasowania mają bramkę trybu', () => {
    expect(read('src/lib/actions/matching.ts')).toMatch(/isRecruitmentEnabled\('matching'\)/);
    expect(read('src/lib/data/matching.ts')).toMatch(/if \(!isRecruitmentEnabled\('matching'\)\) return \{ status: 'disabled' \}/);
    expect(read('src/lib/matching/materialize.ts')).toMatch(/if \(!isRecruitmentEnabled\('matching'\)\) return run;/);
    expect(read('src/app/api/maintenance/route.ts')).toMatch(/if \(!isRecruitmentEnabled\('matching'\)\) \{\s*matches = 'disabled';/);
  });

  it('powiadomienia i e-maile nie powstają z tabeli matches (jobMatch = zapisane wyszukiwania)', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
    // Wstawienie powiadomienia/e-maila w tym samym bloku co odczyt z `matches`.
    const notifiesFromMatches = (sql: string) =>
      /from\s+public\.matches[\s\S]{0,400}(insert\s+into\s+public\.notifications|enqueue_email)/i.test(sql);
    expect(migrations.filter((f) => notifiesFromMatches(read(`supabase/migrations/${f}`)))).toEqual([]);
    // Kontrola ujemna: taki wzorzec jest wykrywany.
    expect(notifiesFromMatches("select m.job_id from public.matches m; perform public.enqueue_email('jobMatch')")).toBe(true);
  });
});
