// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ErrorCodes, toUserMessageKey } from '@/lib/errors';
import { effectiveRecruitmentEnabled } from '@/lib/ops/portal-mode';
import { CLASSIFIEDS_CANDIDATE_NAV, candidateNavKeys } from '@/lib/candidate-nav';
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
  { segment: 'candidate/onboarding', status: 'enforced', issue: 1142 },
  { segment: 'candidate/profil/import-cv', status: 'enforced', issue: 1138 },
  { segment: 'candidate/wiadomosci', status: 'enforced', issue: 1134 },
  { segment: 'employer/wiadomosci', status: 'enforced', issue: 1134 },
  { segment: 'admin/pytania', status: 'enforced', issue: 1137 },
  { segment: 'employer/szablony', status: 'enforced', issue: 1211 },
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

/**
 * Invarianty kolejnych PR-ów epiku #1128 — wszystkie zrealizowane, asercje żyją przy funkcjach
 * (#1249; dawne `it.todo` z tego pliku):
 * - applyToJob, aplikacja gościa, sendOffer, respondToOffer, zmiana statusu, wycofanie i odczyty
 *   historii zgłoszeń/propozycji → `tests/legal/classifieds-process-off.test.ts` (#1130/#1132/#1141/#1144);
 * - rozmowy/wiadomości i załączniki → `tests/unit/classifieds-messaging-cv-off.test.ts` (#1134/#1138);
 *   pytania screeningowe → `tests/unit/classifieds-screening-hidden.test.ts`, `save-job-draft-step.test.ts`,
 *   `job-wizard-screening-mode.test.tsx`, `screening-review.test.ts` (#1135/#1137);
 * - loadery pracodawcy (kandydaci, top dopasowani, szczegół kandydata) →
 *   `tests/unit/classifieds-matching-off.test.ts` (#1131/#1133/#1139), szczegół zgłoszenia =
 *   `GUARDED_ROUTES` wyżej (#1144) i bramki odczytu niżej; dostęp firmy do profili i CV zamyka baza
 *   (`company_can_view_candidate`, `supabase/tests/rls.sql` sekcja CL1128);
 * - zakazane obietnice w tekstach publicznych, 4 języki → `tests/unit/classifieds-copy.test.ts` (#1149/#1151);
 * - strona pozytywna (ścieżki aktywne nie zwracają RECRUITMENT_DISABLED) →
 *   `tests/legal/classifieds-active-paths.test.ts` (#1249).
 */

/**
 * Baza (#1140/#1143, migracja 0171): tryb portalu w bazie, strażniki zapisu i dwuklucz.
 * RPC procesu rekrutacyjnego, które sekcja CL1128 w `supabase/tests/rls.sql` musi wywołać
 * w trybie ogłoszeniowym (każde z oczekiwanym odrzuceniem albo pustym wynikiem).
 */
const RECRUITMENT_DB_RPCS = [
  'apply_to_job', 'submit_guest_application', 'confirm_guest_application', 'claim_guest_application',
  'send_offer', 'respond_to_offer', 'transition_application', 'withdraw_application',
  'get_or_create_conversation', 'send_message', 'stage_message_attachment', 'can_attach_in_conversation',
  'get_company_top_matches', 'get_job_match_profile', 'company_can_view_candidate',
  'bulk_transition_applications', 'get_conversation_template_context',
] as const;
/** Tabele procesu z triggerem BEFORE INSERT `trg_aa_recruitment_mode`. */
const RECRUITMENT_TABLES = [
  'applications', 'offers', 'matches', 'conversations', 'messages', 'message_attachments',
  'application_screening_answers', 'guest_application_requests',
] as const;

function cl1128Section(rls: string): string {
  const start = rls.indexOf("\\echo '--- CL1128");
  const end = rls.indexOf("\\echo '--- PLM", start);
  return start >= 0 && end > start ? rls.slice(start, end) : '';
}
const missingRpcs = (section: string) =>
  RECRUITMENT_DB_RPCS.filter((fn) => !new RegExp(`public\\.${fn}\\(`).test(section));

describe('baza: tryb ogłoszeniowy i dwuklucz (#1140, #1143)', () => {
  const migration = readdirSync(join(ROOT, 'supabase/migrations'))
    .map((f) => read(`supabase/migrations/${f}`))
    .find((sql) => sql.includes('function public.enforce_recruitment_insert()')) ?? '';

  it('migracja trybu: singleton domyślnie CLASSIFIEDS_ONLY i strażnik na każdej tabeli procesu', () => {
    expect(migration).toMatch(/insert into public\.portal_legal_mode \(id, mode, reason\)\s+values \(true, 'CLASSIFIEDS_ONLY'/);
    const list = /foreach t in array array\[([^\]]+)\]/.exec(migration)?.[1] ?? '';
    for (const table of RECRUITMENT_TABLES) expect(list, table).toContain(`'${table}'`);
  });

  it('sekcja CL1128 w rls.sql wywołuje każde RPC procesu rekrutacyjnego', () => {
    const section = cl1128Section(read('supabase/tests/rls.sql'));
    expect(section.length).toBeGreaterThan(0);
    expect(missingRpcs(section)).toEqual([]);
  });

  it('kontrola ujemna: sekcja bez send_offer jest wykrywana', () => {
    const section = cl1128Section(read('supabase/tests/rls.sql')).replaceAll('public.send_offer(', 'public.x(');
    expect(missingRpcs(section)).toEqual(['send_offer']);
  });

  it('tryb efektywny = env × baza: tylko RECRUITMENT × RECRUITMENT włącza', () => {
    expect([[false, false], [false, true], [true, false], [true, true]].map(([e, d]) => effectiveRecruitmentEnabled(e!, d!)))
      .toEqual([false, false, false, true]);
  });

  /** /api/maintenance: materializacja dopasowań tylko za trybem efektywnym (#1143). */
  const guardedMatches = (src: string) =>
    /if \(!recruitment\) \{\s*matches = 'disabled';\s*\} else \{\s*try \{\s*matches = await runMatchRecompute\(\)/.test(src)
    && (src.match(/runMatchRecompute\(\)/g) ?? []).length === 1
    && /recruitmentTasks: \{ skipped: 'classifieds_only'/.test(src);

  it('/api/maintenance nie woła zadań rekrutacyjnych w trybie ogłoszeniowym (skipped: classifieds_only)', () => {
    expect(guardedMatches(read('src/app/api/maintenance/route.ts'))).toBe(true);
  });

  it('kontrola ujemna: wywołanie runMatchRecompute() poza strażnikiem jest wykrywane', () => {
    const src = read('src/app/api/maintenance/route.ts');
    expect(guardedMatches(src.replace('if (!recruitment) {', 'if (false) {'))).toBe(false);
    expect(guardedMatches(`${src}\nawait runMatchRecompute();`)).toBe(false);
  });
});

/**
 * #1130: na szczególe oferty jedynym CTA aplikacyjnym w trybie ogłoszeniowym jest kanał
 * ogłoszeniodawcy (`EmployerApplyChannel`: https / mailto / tel). `ApplyModal` i „Wyślij
 * wiadomość” zostają wyłącznie w gałęzi `recruitment` (tryb `RECRUITMENT`).
 */
const JOB_DETAIL_PAGE = 'src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx';

/** Usuwa gałęzie JSX renderowane tylko w trybie rekrutacji (`recruitment ? ( … )`, `!recruitment ? null : ( … )`). */
function stripRecruitmentBranches(src: string): string {
  const OPENERS = [/\brecruitment \? \(/g, /!recruitment \? null : \(/g];
  let out = src;
  for (const re of OPENERS) {
    for (;;) {
      re.lastIndex = 0;
      const m = re.exec(out);
      if (!m) break;
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < out.length && depth > 0) {
        if (out[i] === '(') depth += 1;
        else if (out[i] === ')') depth -= 1;
        i += 1;
      }
      out = out.slice(0, m.index) + out.slice(i);
    }
  }
  return out;
}

const classifiedsView = (src: string) => stripRecruitmentBranches(src);
const unguardedRecruitmentCtas = (src: string) =>
  (classifiedsView(src).match(/<ApplyModal\b|t\('sendMessage'\)/g) ?? []).length;

describe('szczegół oferty: CTA aplikacyjne = kanał ogłoszeniodawcy (#1130)', () => {
  const page = read(JOB_DETAIL_PAGE);

  it('tryb czytany z portal-mode, ApplyModal i „Wyślij wiadomość” tylko w gałęzi recruitment', () => {
    expect(page).toMatch(/const recruitment = isRecruitmentEnabled\('applications'\)/);
    expect(page).toMatch(/<ApplyModal\b/);
    expect(unguardedRecruitmentCtas(page)).toBe(0);
  });

  it('widok ogłoszeniowy renderuje EmployerApplyChannel w ramce i w pasku mobilnym', () => {
    const view = classifiedsView(page);
    expect(view.match(/<EmployerApplyChannel\b/g) ?? []).toHaveLength(2);
    expect(view).toMatch(/variant="box"/);
    expect(view).toMatch(/variant="bar"/);
    expect(view).toMatch(/channel=\{job\.applyChannel\}/);
    // Kliknięcia kanału liczy wyspa lejka (bramka zgody), tylko w trybie ogłoszeniowym.
    expect(page).toMatch(/<JobFunnelBeacon event="detail_view" jobIds=\{\[job\.id\]\} applyClicks=\{!recruitment\} \/>/);
  });

  it('kontrola ujemna: ApplyModal albo „Wyślij wiadomość” poza gałęzią recruitment są wykrywane', () => {
    expect(unguardedRecruitmentCtas(`${page}\n<ApplyModal jobId="x" />`)).toBe(1);
    expect(unguardedRecruitmentCtas(page.replace('job.isDemo || !recruitment ? null : (', 'job.isDemo ? null : ('))).toBe(1);
    expect(unguardedRecruitmentCtas(page.replaceAll('recruitment ? (', 'true ? ('))).toBeGreaterThan(0);
  });

  it('komponent kanału: jedyne cele linków to https / mailto / tel (bez innych schematów)', () => {
    const src = read('src/components/public/EmployerApplyChannel.tsx');
    // Linki powstają wyłącznie z buildApplyLinks (href z kanału), bez stałych adresów i Link portalu.
    expect(src).toMatch(/buildApplyLinks\(channel/);
    expect(src).not.toMatch(/href=["'{]/);
    expect(src).not.toMatch(/from '@\/i18n\/navigation'|from '@\/components\/public\/ApplyModal'|applyToJob\(/);
    const links = read('src/lib/job-apply-links.ts');
    expect(links).toMatch(/export const APPLY_LINK_REL = 'noopener noreferrer nofollow'/);
  });
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
    // #1143: maintenance — tryb efektywny (env `matching` ORAZ baza), jeden kształt odpowiedzi.
    const maintenance = read('src/app/api/maintenance/route.ts');
    expect(maintenance).toMatch(/if \(!isRecruitmentEnabled\('matching'\)\) return false;/);
    expect(maintenance).toMatch(/if \(!recruitment\) \{\s*matches = 'disabled';/);
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

/**
 * Konto kandydata nie tworzy profilu zawodowego (#1142, migracja 0175). Zachowanie (akcja bez
 * zapytań, render pulpitu, nawigacja) sprawdza `tests/unit/classifieds-candidate-account.test.tsx`,
 * baza — `supabase/tests/rls.sql` sekcja CA1142 (kontrola ujemna: bez strażnika krok 3 zapisuje).
 */
describe('konto kandydata nie tworzy profilu zawodowego (#1142)', () => {
  const account = readdirSync(join(ROOT, 'supabase/migrations'))
    .map((f) => read(`supabase/migrations/${f}`))
    .filter((sql) => sql.includes('create or replace function public.ensure_candidate_profile()'))
    .at(-1) ?? '';
  /** Najnowsza definicja `ensure_candidate_profile` zaczyna się od strażnika trybu. */
  const ensureGuarded = (sql: string) => {
    const fn = sql.slice(sql.lastIndexOf('create or replace function public.ensure_candidate_profile()'));
    const guard = fn.indexOf('recruitment_write_allowed()');
    return guard > 0 && guard < fn.indexOf('insert into public.candidate_profiles');
  };

  it('ensure_candidate_profile (wołane przez każde RPC profilu) ma strażnik trybu', () => {
    expect(ensureGuarded(account)).toBe(true);
    for (const t of ['candidate_profiles', 'candidate_skills', 'candidate_languages', 'candidate_certificates']) {
      expect(account, t).toContain(`'${t}'`);
    }
  });

  it('kontrola ujemna: definicja bez strażnika jest wykrywana', () => {
    expect(ensureGuarded(account.replace(/if not public\.recruitment_write_allowed\(\) then[\s\S]*?end if;/, ''))).toBe(false);
  });

  it('saveOnboardingStep i strona profilu mają bramkę trybu', () => {
    const action = read('src/lib/actions/onboarding.ts');
    const body = action.slice(action.indexOf('export async function saveOnboardingStep('));
    expect(body.indexOf("isRecruitmentEnabled()")).toBeGreaterThan(0);
    expect(body.indexOf("isRecruitmentEnabled()")).toBeLessThan(body.indexOf('validateStep('));
    expect(read('src/app/[locale]/candidate/profil/page.tsx')).toMatch(/notFoundUnlessRecruitment\(\)/);
  });

  it('nawigacja w trybie ogłoszeniowym = pulpit, zapisane oferty, zapisane wyszukiwania, ustawienia', () => {
    expect([...candidateNavKeys(false)]).toEqual(['summary', 'saved', 'searches', 'settings']);
    expect(candidateNavKeys(false)).toBe(CLASSIFIEDS_CANDIDATE_NAV);
  });
});

describe('powiadomienia i e-maile bez zdarzeń rekrutacyjnych (#1145)', () => {
  const sql = readdirSync(join(ROOT, 'supabase/migrations'))
    .map((f) => read(`supabase/migrations/${f}`))
    .filter((s) => s.includes('function public.skip_recruitment_notification()'))
    .at(-1) ?? '';

  it('trigger BEFORE INSERT na notifications pomija typy procesu w trybie ogłoszeniowym', () => {
    expect(sql).toMatch(/create trigger trg_aa_recruitment_mode before insert on public\.notifications/);
    for (const t of ['application_received', 'application_status_changed', 'offer_received',
      'offer_status_changed', 'message_received', 'job_terms']) {
      expect(sql, t).toContain(`'${t}'`);
    }
    expect(sql).toMatch(/p_type = 'job_match' and p_entity_type is distinct from 'saved_search'/);
  });
  // Lista szablonów SQL ↔ TS, cele linków, preferencje, teksty: tests/unit/classifieds-notifications.test.ts.
});

/**
 * Wiadomości i CV (#1134, #1138). Zachowanie (zero zapytań, bez bucketu, bez modelu) sprawdza
 * `tests/unit/classifieds-messaging-cv-off.test.ts`; baza — `rls.sql` sekcje CL1128/CL174.
 */
describe('wiadomości i CV wyłączone w trybie ogłoszeniowym (#1134/#1138)', () => {
  /** Każda eksportowana akcja pliku zaczyna się od bramki trybu (pierwsza instrukcja ciała). */
  function ungatedActions(src: string, feature: string, names: readonly string[]): string[] {
    return names.filter((name) => {
      const start = src.indexOf(`export async function ${name}(`);
      if (start < 0) return true;
      const body = src.slice(src.indexOf('{\n', src.indexOf(')', start)) + 2).trimStart();
      return !(body.startsWith(`if (messagingOff())`)
        || body.startsWith(`if (!isRecruitmentEnabled('${feature}'))`)
        || body.startsWith('// #1138') && body.includes(`if (!isRecruitmentEnabled('${feature}'))`));
    });
  }

  it('rozmowa kandydat–pracodawca nie może zostać rozpoczęta: akcje wiadomości i załączników mają bramkę na starcie', () => {
    expect(ungatedActions(read('src/lib/actions/messages.ts'), 'messaging',
      ['openConversation', 'sendMessage', 'markConversationRead', 'loadOlderMessages'])).toEqual([]);
    expect(ungatedActions(read('src/lib/actions/message-attachments.ts'), 'messaging',
      ['uploadMessageAttachment', 'discardMessageAttachment', 'prepareMessageAttachmentDownload'])).toEqual([]);
  });

  it('kontrola ujemna: akcja bez bramki na starcie jest wykrywana', () => {
    const src = read('src/lib/actions/messages.ts').replace(
      /(export async function sendMessage\([\s\S]*?\{\n)\s*if \(messagingOff\(\)\) return DISABLED;\n/, '$1');
    expect(ungatedActions(src, 'messaging', ['sendMessage'])).toEqual(['sendMessage']);
  });

  it('/api/files/message/<id>: 404 przed sesją i bucketem', () => {
    expect(read('src/app/api/files/message/[id]/route.ts'))
      .toMatch(/\): Promise<Response> \{\s*if \(!isRecruitmentEnabled\('messaging'\)\) return emptyAttachmentResponse\(404\);/);
  });

  it('nawigacja paneli bez „Wiadomości” poza trybem rekrutacyjnym; szczegół oferty bez kontaktu przez platformę', () => {
    // Panel kandydata: lista pozycji z jednego źródła `candidateNavKeys` (#1142) — „messages” tylko w pełnym panelu.
    expect(read('src/components/candidate/CandidateShell.tsx')).toMatch(/candidateNavKeys\(recruitmentEnabled\)/);
    expect([...candidateNavKeys(false)]).not.toContain('messages');
    expect([...candidateNavKeys(true)]).toContain('messages');
    expect(read('src/components/employer/EmployerShell.tsx'))
      .toMatch(/\.\.\.\(recruitmentEnabled \? \[\{ href: HREF\.messages,/);
    const page = read('src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx');
    expect(page).toMatch(/\{messagingOn \? t\('contactViaPlatform'\) : t\('employerApply\.contact'\)\}/);
    expect(page).toMatch(/\{!messagingOn \|\| job\.isDemo \|\| !recruitment \? null : \(/);
  });

  it('CV nie może zostać przesłane: akcja i serwis mają bramkę; pobranie/usunięcie bez bramki', () => {
    const action = read('src/lib/actions/files.ts');
    expect(ungatedActions(action, 'cvAccess', ['uploadCandidateCv'])).toEqual([]);
    expect(ungatedActions(action, 'cvAccess', ['prepareCvDownload', 'deleteCandidateFile']))
      .toEqual(['prepareCvDownload', 'deleteCandidateFile']);
    expect(read('src/lib/files/candidate-cv.ts'))
      .toMatch(/storeCandidateCv\([\s\S]*?\): Promise<CvUploadResult> \{\s*\/\/ #1138[^\n]*\n\s*if \(!isRecruitmentEnabled\('cvAccess'\)\)/);
  });

  it('AI CV import niedostępny: konfiguracja i każda akcja sprawdzają tryb przed flagą AI', () => {
    expect(read('src/lib/cv-import/config.ts'))
      .toMatch(/cvImportProvider\(\): CvImportProvider \| null \{\s*if \(!isRecruitmentEnabled\('cvImport'\)\) return null;/);
    expect(ungatedActions(read('src/lib/actions/cv-import.ts'), 'cvImport',
      ['prepareCvImportAction', 'proposeFromCvAction', 'applyCvProposals'])).toEqual([]);
  });

  it('baza (0174): strażnik plików CV i nakładka apply_candidate_cv_proposals, list newMessage wygaszany', () => {
    const migration = readdirSync(join(ROOT, 'supabase/migrations'))
      .map((f) => read(`supabase/migrations/${f}`))
      .find((sql) => sql.includes('function public.enforce_recruitment_cv_file()')) ?? '';
    expect(migration).toMatch(/create trigger trg_aa_recruitment_mode_cv before insert or update on public\.files/);
    expect(migration).toMatch(/perform public\.assert_recruitment_enabled\(\);\s*return public\.apply_candidate_cv_proposals_impl\(/);
    expect(migration).toMatch(/when p_template = 'newMessage' and not public\.recruitment_enabled\(\)\s*then 'suppressed_recruitment_disabled'/);
    const rls = read('supabase/tests/rls.sql');
    for (const id of ['CL174-1c', 'CL174-2', 'CL174-2b', 'CL174-3b', 'CL174-4', 'CL174-N1', 'CL174-N2']) {
      expect(rls, id).toContain(`'${id} `);
    }
  });
});

/**
 * #1135 (brak wyszukiwalnej bazy profili) i #1137 (bez pytań screeningowych), migracja 0173 na 0171.
 * Sekcje CLVIS/CLSCR w `supabase/tests/rls.sql` wywołują każde RPC poniżej w trybie ogłoszeniowym.
 */
const VIS_SCREENING_RPCS = [
  'set_candidate_searchable', 'company_can_see_match_candidate', 'candidate_profile_is_searchable',
  'set_job_screening_questions', 'save_job_draft', 'get_public_job_screening_questions',
  'admin_decide_screening_review', 'publish_job', 'duplicate_job_as_draft',
] as const;

function clVisScreeningSection(rls: string): string {
  const start = rls.indexOf("\\echo '--- CLVIS");
  const end = rls.indexOf("\\echo '=================== ALL RLS TESTS PASSED", start);
  return start >= 0 && end > start ? rls.slice(start, end) : '';
}
const missingVisScreeningRpcs = (section: string) =>
  VIS_SCREENING_RPCS.filter((fn) => !new RegExp(`public\\.${fn}\\(`).test(section));

describe('profile firm i pytania screeningowe w trybie ogłoszeniowym (#1135, #1137)', () => {
  const migration = readdirSync(join(ROOT, 'supabase/migrations'))
    .map((f) => read(`supabase/migrations/${f}`))
    .find((sql) => sql.includes('function public.enforce_recruitment_searchable()')) ?? '';
  const rls = read('supabase/tests/rls.sql');

  it('migracja: strażnik is_searchable, pomijanie pytań, blokada decyzji przeglądu', () => {
    expect(migration).toMatch(/create trigger trg_aa_recruitment_mode_searchable\s+before insert or update of is_searchable on public\.candidate_profiles/);
    expect(migration).toMatch(/create trigger trg_aa_recruitment_mode\s+before insert on public\.job_screening_questions/);
    expect(migration).toMatch(/create trigger trg_aa_recruitment_mode_update\s+before update on public\.screening_question_reviews/);
    // Każda przedefiniowana funkcja ma warunek trybu.
    for (const fn of ['set_candidate_searchable', 'company_can_see_match_candidate', 'set_job_screening_questions',
      'get_public_job_screening_questions', 'enforce_screening_review']) {
      const body = migration.split(`create or replace function public.${fn}(`)[1]?.split('$$;')[0] ?? '';
      expect(body, fn).toMatch(/public\.recruitment_(enabled|write_allowed)\(\)/);
    }
  });

  it('pracodawca nie może otworzyć profilu dowolnego kandydata (rls.sql CLVIS-1)', () => {
    const section = clVisScreeningSection(rls);
    expect(section).toMatch(/'CLVIS-1 rekruter nie otwiera profilu dowolnego kandydata/);
    expect(section).toMatch(/\(select count\(\*\) from public\.candidate_profiles\) = 0/);
  });

  it('sekcje CLVIS/CLSCR wywołują każde RPC widoczności profilu i pytań', () => {
    const section = clVisScreeningSection(rls);
    expect(section.length).toBeGreaterThan(0);
    expect(missingVisScreeningRpcs(section)).toEqual([]);
  });

  it('kontrola ujemna: sekcja bez set_job_screening_questions jest wykrywana', () => {
    const section = clVisScreeningSection(rls).replaceAll('public.set_job_screening_questions(', 'public.x(');
    expect(missingVisScreeningRpcs(section)).toEqual(['set_job_screening_questions']);
  });

  /** Sekcja widoczności w /candidate/ustawienia: odczyt i render tylko w trybie rekrutacyjnym. */
  const visibilityGated = (src: string) =>
    /const visibilityEnabled = isRecruitmentEnabled\('candidateSearch'\)/.test(src)
    && /visibilityEnabled \? loadProfileVisibility\(\) : Promise\.resolve\(null\)/.test(src)
    && (src.match(/loadProfileVisibility\(\)/g) ?? []).length === 1
    && /visibility === null \? null :/.test(src);

  it('/candidate/ustawienia: bez sekcji widoczności profilu w trybie ogłoszeniowym', () => {
    expect(visibilityGated(read('src/app/[locale]/candidate/ustawienia/page.tsx'))).toBe(true);
  });

  it('kontrola ujemna: odczyt widoczności poza strażnikiem jest wykrywany', () => {
    const src = read('src/app/[locale]/candidate/ustawienia/page.tsx');
    expect(visibilityGated(src.replace('visibilityEnabled ? loadProfileVisibility() : Promise.resolve(null)', 'loadProfileVisibility()'))).toBe(false);
  });

  /** Każde miejsce renderowania kreatora oferty podaje tryb pytań z serwera. */
  function wizardCallersGated(files: { path: string; source: string }[]): string[] {
    return files
      .filter((f) => /<(New)?JobWizard\b/.test(f.source))
      .filter((f) => {
        const tags = f.source.match(/<(New)?JobWizard\b[^>]*>/gs) ?? [];
        return !tags.every((tag) => tag.includes("screeningEnabled={isRecruitmentEnabled('screening')}"));
      })
      .map((f) => f.path);
  }

  it('strony kreatora oferty podają screeningEnabled z isRecruitmentEnabled(\'screening\')', () => {
    const pages = walk(LOCALE_APP)
      .filter((f) => /\/page\.tsx$/.test(f))
      .map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, 'utf8') }));
    expect(pages.filter((p) => /<(New)?JobWizard\b/.test(p.source)).length).toBeGreaterThanOrEqual(2);
    expect(wizardCallersGated(pages)).toEqual([]);
  });

  it('kontrola ujemna: kreator bez propu trybu jest wykrywany', () => {
    const mutant = { path: 'src/app/x/page.tsx', source: '<JobWizard initialJobId={id} assistEnabled />' };
    expect(wizardCallersGated([mutant])).toEqual(['src/app/x/page.tsx']);
  });

  it('nawigacja admina: „Pytania screeningowe” tylko z trybu serwera', () => {
    expect(read('src/components/admin/AdminShell.tsx')).toMatch(/\.\.\.\(screeningEnabled \? \[\{ href: HREF\.screening/);
    expect(read('src/app/[locale]/admin/layout.tsx')).toMatch(/screeningEnabled=\{isRecruitmentEnabled\('screening'\)\}/);
  });
});

/**
 * Stare pytania screeningowe i ich przeglądy (sprzed trybu) są ukryte wszędzie w warstwie
 * aplikacji (decyzja produktowa: portal ogłoszeniowy). Każdy odczyt takich danych musi mieć
 * bramkę `isRecruitmentEnabled('screening')` w tej samej funkcji, PRZED zapytaniem (albo tuż
 * przy nim, gdy zapytanie jest dynamiczne). Dowód zachowania: `classifieds-screening-hidden`
 * (unit) i `portal-screening-banner` (PG16).
 */
describe('ukryte stare pytania screeningowe (odczyty w warstwie aplikacji)', () => {
  const GATE = "isRecruitmentEnabled('screening')";
  const READERS: { file: string; fn: string; query: string; near?: boolean }[] = [
    { file: 'src/lib/data/employer.ts', fn: 'getJobDraft', query: 'employer.job-draft-screening', near: true },
    { file: 'src/lib/data/employer.ts', fn: 'getEmployerApplicationDetail', query: 'employer.application-detail-answers', near: true },
    { file: 'src/lib/data/candidate.ts', fn: 'getMyApplicationScreeningAnswers', query: 'candidate.application-screening-answers' },
    { file: 'src/lib/data/candidate.ts', fn: 'getMyApplicationDetail', query: 'candidate.application-detail-answers', near: true },
    { file: 'src/lib/data/candidate.ts', fn: 'getMyApplicationsPage', query: 'candidate.applications-page', near: true },
    { file: 'src/lib/data/admin.ts', fn: 'listScreeningReviews', query: 'admin.screening-reviews' },
    { file: 'src/lib/actions/jobs.ts', fn: 'loadScreeningReviewNotices', query: 'jobs.screening-questions-review' },
    { file: 'src/lib/jobs.ts', fn: 'getJobBySlugFromDb', query: 'getPublicJobScreeningQuestions(pool', near: true },
  ];

  /**
   * Bramka w funkcji przed zapytaniem (`near`: w promieniu 300 znaków od zapytania — dla
   * długich funkcji, w których ta sama bramka występuje też przy innych odczytach).
   */
  function gatedReader(source: string, fn: string, query: string, near = false): boolean {
    const start = source.search(new RegExp(`function ${fn}\\b`));
    if (start < 0) return false;
    const at = source.indexOf(query, start);
    if (at < 0) return false;
    return near
      ? source.slice(Math.max(start, at - 300), at + 300).includes(GATE)
      : source.slice(start, at + 700).includes(GATE);
  }

  it.each(READERS)('$fn ($query) sprawdza tryb przed odczytem', ({ file, fn, query, near }) => {
    const source = read(file);
    expect(source.includes(query), `${file}: brak ${query}`).toBe(true);
    expect(gatedReader(source, fn, query, near)).toBe(true);
  });

  it('kontrola ujemna: odczyt bez bramki jest wykrywany', () => {
    for (const { file, fn, query, near } of READERS) {
      const mutant = read(file).replaceAll(GATE, 'true');
      expect(gatedReader(mutant, fn, query, near), `${file} ${fn}`).toBe(false);
    }
  });

  it('powiadomienia o przeglądzie pytań są filtrowane w liście, pełnej liście i liczniku', () => {
    const source = read('src/lib/data/notifications.ts');
    expect(source).toContain("function screeningVisible(): boolean {\n  return isRecruitmentEnabled('screening');");
    expect(source.match(/IS DISTINCT FROM 'screening_review'/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('dziennik audytu nie zależy od trybu (ślad audytowy, nie UI funkcji)', () => {
    const data = read('src/lib/data/admin.ts');
    expect(data).not.toContain('hideScreening');
    expect(read('src/lib/admin/list-params.ts')).not.toContain('includeScreening');
  });
});
