// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ErrorCodes, toUserMessageKey } from '@/lib/errors';
import { effectiveRecruitmentEnabled } from '@/lib/ops/portal-mode';
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
  { segment: 'employer/kandydaci', status: 'pending', issue: 1129 },
  { segment: 'employer/aplikacje', status: 'pending', issue: 1129 },
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
  it.todo('applyToJob, aplikacja gościa, sendOffer, respondToOffer, zmiana statusu, screening, rozmowy/wiadomości → RECRUITMENT_DISABLED przed bazą (fake-db: zero zapytań) (#1129/#1130)');
  it.todo('loadery pracodawcy (kandydaci, top dopasowani, szczegół kandydata/aplikacji, /api/files/cv/*) nie zwracają danych (#1129)');
  it.todo('getMyJobMatch/scoreMatch nie są wołane w ścieżkach stron (#1129)');
  it.todo('słownik zakazanych etykiet UI na trasach aktywnych w trybie ogłoszeniowym, 4 języki (#1128, teksty)');
  it.todo('jedyne CTA aplikacyjne na szczególe oferty = zewnętrzny kanał ogłoszeniodawcy (#1129/#1130)');
  it.todo('pozytywnie: lista ofert, szczegół, kreator/publikacja, zapisane oferty/wyszukiwania, konto nie zwracają RECRUITMENT_DISABLED (#1128)');
});

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
    /if \(recruitment\) \{\s*try \{\s*matches = await runMatchRecompute\(\)/.test(src)
    && (src.match(/runMatchRecompute\(\)/g) ?? []).length === 1
    && /recruitmentTasks: \{ skipped: 'classifieds_only'/.test(src);

  it('/api/maintenance nie woła zadań rekrutacyjnych w trybie ogłoszeniowym (skipped: classifieds_only)', () => {
    expect(guardedMatches(read('src/app/api/maintenance/route.ts'))).toBe(true);
  });

  it('kontrola ujemna: wywołanie runMatchRecompute() poza strażnikiem jest wykrywane', () => {
    const src = read('src/app/api/maintenance/route.ts');
    expect(guardedMatches(src.replace('if (recruitment) {', 'if (true) {'))).toBe(false);
    expect(guardedMatches(`${src}\nawait runMatchRecompute();`)).toBe(false);
  });
});
