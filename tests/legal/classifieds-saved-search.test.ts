// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { withClassifiedsMode } from '../helpers/portal-mode';

/**
 * Tryb ogłoszeniowy (#1148; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Zapisane wyszukiwania i alerty (#100) zostają, bo wynikają WYŁĄCZNIE z filtrów ustawionych
 * przez użytkownika. Strażnik utrwala to na dwóch poziomach:
 *
 * 1. SQL — najnowsze definicje funkcji alertów z migracji (`*saved_search*`) nie odwołują się do
 *    profilu kandydata (`candidate_profiles`, `candidate_skills`, …) ani dopasowań (`matches`,
 *    `match_recompute_queue`, `get_job_match_profile`, …); filtry v1 = argumenty
 *    `get_public_jobs` i nic więcej; kolejność wyników = lista publiczna (`published_at`, `id`).
 *    Jedyny dopuszczony wyjątek `candidate_*`: blokada firmy ustawiona przez samego użytkownika
 *    (`candidate_company_blocks`, #97) — to też filtr użytkownika.
 * 2. Aplikacja — akcje, strony i trasy zapisanych wyszukiwań nie mają bramki trybu i działają
 *    w trybie ogłoszeniowym; `/api/maintenance` woła worker alertów także bez rekrutacji.
 *
 * Każda reguła ma kontrolę ujemną (wstrzyknięta definicja / klucz = czerwony).
 * Zachowanie bazy w trybie (konto bez onboardingu, worker, wyłączenie z linku): `rls.sql` SS1148.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

/** Najnowsze definicje funkcji `public.*` (ostatnia migracja wygrywa), bez komentarzy SQL. */
/**
 * `body` — małe litery (wyszukiwanie odwołań niezależne od wielkości liter), `raw` — oryginalna
 * wielkość liter (klucze filtrów JSON są camelCase).
 */
function latestFunctions(filter: (name: string) => boolean): Map<string, { file: string; body: string; raw: string }> {
  const out = new Map<string, { file: string; body: string; raw: string }>();
  const header = /create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(header)) {
      const name = match[1]!.toLowerCase();
      if (!filter(name)) continue;
      const start = match.index ?? 0;
      const open = sql.indexOf('$$', start);
      const close = sql.indexOf('$$', open + 2);
      if (open < 0 || close < 0) throw new Error(`${file}: brak ciała $$ dla ${name}`);
      const raw = normalize(sql.slice(start, close + 2));
      out.set(name, { file, body: raw.toLowerCase(), raw });
    }
  }
  return out;
}

function normalize(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dane profilu kandydata i dopasowań — funkcje alertów nie mogą ich czytać. */
const PROFILE_OR_MATCHING = [
  /\bcandidate_(?!company_blocks\b|blocked_company\b|id\b)[a-z_]+/g,
  /\bmatches\b/g,
  /\bmatch_[a-z_]+/g,
  /\bget_job_match_profile\b/g,
  /\bget_company_top_matches\b/g,
  /\bprofile_completed\b/g,
  /\bfinish_onboarding\b/g,
];

function profileOrMatchingRefs(body: string): string[] {
  const hits = new Set<string>();
  for (const pattern of PROFILE_OR_MATCHING) for (const m of body.matchAll(pattern)) hits.add(m[0]);
  return [...hits].sort();
}

const ALERT_FUNCTIONS = latestFunctions((name) => name.includes('saved_search'));
const REQUIRED = [
  'save_saved_search', 'set_saved_search_alerts', 'rename_saved_search', 'delete_saved_search',
  'saved_search_canonical_filters', 'saved_search_matching_jobs', 'saved_search_keyset_page',
  'saved_search_jobs_after', 'process_saved_search_alerts', 'saved_search_alert_unsubscribe',
];

function definition(name: string): { body: string; raw: string } {
  const fn = ALERT_FUNCTIONS.get(name) ?? latestFunctions((n) => n === name).get(name);
  if (!fn) throw new Error(`Nie znaleziono definicji public.${name}`);
  return fn;
}

function body(name: string): string {
  return definition(name).body;
}

describe('#1148 SQL: alerty korzystają tylko z filtrów użytkownika', () => {
  it('strażnik widzi wszystkie funkcje zapisanych wyszukiwań', () => {
    for (const name of REQUIRED) expect(ALERT_FUNCTIONS.has(name), name).toBe(true);
  });

  it.each([...ALERT_FUNCTIONS.keys()])('%s: bez profilu kandydata i dopasowań', (name) => {
    expect(profileOrMatchingRefs(ALERT_FUNCTIONS.get(name)!.body)).toEqual([]);
  });

  it('kontrola ujemna: definicja z join candidate_profiles / matches = czerwony', () => {
    const original = body('process_saved_search_alerts');
    const joinProfile = original.replace(
      'join public.profiles p on p.id = s.profile_id',
      'join public.profiles p on p.id = s.profile_id join public.candidate_profiles cp on cp.profile_id = s.profile_id',
    );
    expect(joinProfile).not.toBe(original);
    expect(profileOrMatchingRefs(joinProfile)).toEqual(['candidate_profiles']);
    expect(profileOrMatchingRefs(`${original} and exists (select 1 from public.matches m where m.job_id = j.id)`))
      .toEqual(['matches']);
    expect(profileOrMatchingRefs(`${original} perform public.get_job_match_profile(j.id);`))
      .toContain('get_job_match_profile');
    expect(profileOrMatchingRefs('select 1 from public.candidate_skills s')).toEqual(['candidate_skills']);
    expect(profileOrMatchingRefs('where cp.profile_completed')).toEqual(['profile_completed']);
  });

  it('zapis wyszukiwania wymaga tylko roli kandydata (bez profilu i onboardingu)', () => {
    const save = body('save_saved_search');
    expect(save).toContain("p.role = 'candidate'");
    expect(profileOrMatchingRefs(save)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Filtry v1 = argumenty get_public_jobs
 * ---------------------------------------------------------------------------------------------- */

/** Klucze dozwolone przez kanonizację (`k not in (...)`). */
function canonicalKeys(canonical: string): string[] {
  const list = /where k not in \(([^)]*)\)/.exec(canonical)?.[1];
  if (!list) throw new Error('saved_search_canonical_filters: brak listy kluczy');
  return [...list.matchAll(/'([a-z]+)'/gi)].map((m) => m[1]!).sort();
}

/** Mapowanie klucz filtra → parametr `saved_search_jobs_after` w `saved_search_keyset_page`. */
function filterMapping(keyset: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of keyset.matchAll(/(p_[a-z_]+)\s*=>\s*(.*?)(?=,\s*p_[a-z_]+\s*=>|\)\s*k\b)/g)) {
    for (const key of m[2]!.matchAll(/p_filters\s*->>?\s*'([a-z]+)'/gi)) map.set(key[1]!, m[1]!);
  }
  return map;
}

/** Parametry funkcji z nagłówka `create or replace function public.x(...) returns`. */
function params(definition: string): string[] {
  const head = /function public\.[a-z_]+\s*\((.*?)\)\s*returns/.exec(definition)?.[1] ?? '';
  return [...head.matchAll(/(p_[a-z_]+)\s/g)].map((m) => m[1]!);
}

/** Klucze filtra, które nie trafiają do argumentu `get_public_jobs` (pusta lista = OK). */
function keysOutsidePublicJobs(keys: readonly string[], mapping: Map<string, string>, publicParams: readonly string[]): string[] {
  return keys.filter((key) => {
    const param = mapping.get(key);
    return !param || !publicParams.includes(param);
  });
}

/** Klucze interfejsu `SavedSearchFilters` w `src/lib/job-list-query.ts`. */
function tsFilterKeys(): string[] {
  const src = readFileSync(path.join(ROOT, 'src/lib/job-list-query.ts'), 'utf8');
  const block = /export interface SavedSearchFilters \{([\s\S]*?)\n\}/.exec(src)?.[1];
  if (!block) throw new Error('job-list-query.ts: brak interfejsu SavedSearchFilters');
  return [...block.matchAll(/^\s*([a-zA-Z]+)\?:/gm)].map((m) => m[1]!).sort();
}

describe('#1148 filtry v1 = argumenty get_public_jobs', () => {
  const keys = canonicalKeys(definition('saved_search_canonical_filters').raw);
  const mapping = filterMapping(definition('saved_search_keyset_page').raw);
  const publicParams = params(latestFunctions((n) => n === 'get_public_jobs').get('get_public_jobs')!.body);

  it('każdy klucz kanoniczny trafia do parametru get_public_jobs, i tylko one są czytane', () => {
    expect(keys.length).toBeGreaterThan(5);
    expect(keysOutsidePublicJobs(keys, mapping, publicParams)).toEqual([]);
    expect([...mapping.keys()].sort()).toEqual(keys);
  });

  it('parametry kopii filtrów (saved_search_jobs_after) = parametry get_public_jobs + kursor', () => {
    const cursor = ['p_after_published_at', 'p_after_id', 'p_limit'];
    expect(publicParams.length).toBeGreaterThan(10);
    expect(params(body('saved_search_jobs_after')).length).toBeGreaterThan(10);
    const extra = params(body('saved_search_jobs_after')).filter((p) => !cursor.includes(p) && !publicParams.includes(p));
    expect(extra).toEqual([]);
  });

  it('lustro TS (SavedSearchFilters) = klucze kanoniczne w bazie', async () => {
    expect(tsFilterKeys()).toEqual(keys);
    const { parseJobListQuery, savedSearchFiltersFromQuery } = await import('@/lib/job-list-query');
    const query = parseJobListQuery({
      keyword: 'magazynier', city: 'Gent', category: 'warehouse', location: 'flanders', contractType: 'permanent',
      salaryMin: '12', salaryMax: '20', salaryUnit: 'hour', accommodation: 'provided', immediate: '1', noLang: '1',
      direct: '1', date: '7', sort: 'salary', page: '3',
    }, 'pl');
    for (const key of Object.keys(savedSearchFiltersFromQuery(query))) expect(keys).toContain(key);
  });

  it('kontrola ujemna: klucz spoza argumentów get_public_jobs = czerwony', () => {
    expect(keysOutsidePublicJobs([...keys, 'candidateSkills'], mapping, publicParams)).toEqual(['candidateSkills']);
    const withProfileArg = new Map(mapping).set('matchScore', 'p_match_score');
    expect(keysOutsidePublicJobs([...keys, 'matchScore'], withProfileArg, publicParams)).toEqual(['matchScore']);
  });
});

describe('#1148 kolejność = lista publiczna', () => {
  /** Dozwolone sortowania: harmonogram, data publikacji (+ id) i wybór tłumaczenia tytułu. */
  const ALLOWED = /^order by (s\.next_run_at|[xjk]\.published_at (asc|desc)(, [jk]\.id (asc|desc))?|\(jt\.locale = )/;

  function orderClauses(sql: string): string[] {
    return [...sql.matchAll(/order by .{0,60}/g)].map((m) => m[0]);
  }

  it.each(['process_saved_search_alerts', 'saved_search_keyset_page', 'saved_search_jobs_after'])(
    '%s: tylko published_at/id (bez sortowania „pod użytkownika”)',
    (name) => {
      const clauses = orderClauses(body(name));
      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) expect(clause).toMatch(ALLOWED);
    },
  );

  it('digest i strony alertu: published_at malejąco, remis po id', () => {
    expect(body('process_saved_search_alerts')).toContain('order by x.published_at desc');
    expect(body('saved_search_keyset_page')).toContain('order by k.published_at desc, k.id desc');
  });

  it('kontrola ujemna: sortowanie po wyniku dopasowania = czerwony', () => {
    const clause = orderClauses('select 1 order by m.score desc, j.published_at desc')[0]!;
    expect(clause).not.toMatch(ALLOWED);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Aplikacja: bez bramki trybu, działa w trybie ogłoszeniowym
 * ---------------------------------------------------------------------------------------------- */

const SAVED_SEARCH_SOURCES = [
  'src/lib/actions/saved-searches.ts',
  'src/lib/data/saved-searches.ts',
  'src/app/[locale]/candidate/wyszukiwania/page.tsx',
  'src/app/[locale]/(auth)/wypisz-alert/page.tsx',
  'src/app/api/email/unsubscribe-alert/route.ts',
  'src/lib/email/saved-search-alert-off.ts',
];
const MODE_GATE = /\b(assertRecruitmentEnabled|notFoundUnlessRecruitment|isRecruitmentEnabled|portalLegalMode)\b/;

describe('#1148 aplikacja: zapisane wyszukiwania bez bramki trybu', () => {
  it.each(SAVED_SEARCH_SOURCES)('%s nie zależy od trybu rekrutacyjnego', (file) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).not.toMatch(MODE_GATE);
  });

  it('kontrola ujemna: wzorzec łapie bramkę trybu', () => {
    expect("assertRecruitmentEnabled('applications');").toMatch(MODE_GATE);
  });

  it('/api/maintenance: worker alertów poza gałęzią zadań rekrutacyjnych', () => {
    const src = readFileSync(path.join(ROOT, 'src/app/api/maintenance/route.ts'), 'utf8');
    const call = src.indexOf("'process_saved_search_alerts'");
    expect(call).toBeGreaterThan(0);
    // Gałąź rekrutacyjna kończy się przed wywołaniem workera alertów.
    const gate = src.indexOf('if (!recruitment)');
    const gateEnd = src.indexOf("await task('guestRequests'", gate);
    expect(gate).toBeGreaterThan(0);
    expect(gateEnd).toBeGreaterThan(gate);
    expect(call).toBeGreaterThan(gateEnd);
  });
});

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: vi.fn(() => true),
  fileBucketConfig: () => null,
}));

describe('#1148 akcje w trybie ogłoszeniowym (konto kandydata bez onboardingu)', () => {
  withClassifiedsMode();
  const USER = '11111111-1111-4111-8111-111111111111';
  const SEARCH = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'candidate' });
    fakeDb.rpc('save_saved_search', [{ saved_search_id: SEARCH, created: true }]);
    fakeDb.rpc('set_saved_search_alerts', true);
    fakeDb.rpc('rename_saved_search', 'Nowa nazwa');
    fakeDb.rpc('delete_saved_search', null);
  });

  it('zapis, alert, zmiana nazwy i usunięcie działają; jedynymi zapytaniami są RPC wyszukiwań', async () => {
    const actions = await import('@/lib/actions/saved-searches');
    await expect(actions.saveSearchAction({
      name: 'Magazyn', locale: 'nl', filters: { keyword: 'magazijnier' }, query: '?keyword=magazijnier',
    })).resolves.toEqual({ ok: true, id: SEARCH, created: true });
    await expect(actions.setSavedSearchAlertsAction(SEARCH, true, 'weekly')).resolves.toEqual({ ok: true });
    await expect(actions.renameSavedSearchAction(SEARCH, 'Nowa nazwa')).resolves.toEqual({ ok: true });
    await expect(actions.deleteSavedSearchAction(SEARCH)).resolves.toEqual({ ok: true });
    expect(fakeDb.calls.map((c) => c.name)).toEqual([
      'save_saved_search', 'set_saved_search_alerts', 'rename_saved_search', 'delete_saved_search',
    ]);
    for (const call of fakeDb.calls) expect(profileOrMatchingRefs(call.text.toLowerCase())).toEqual([]);
  });

  describe('/api/maintenance', () => {
    const RPCS = [
      'ai_budget_release_stale_reservations', 'expire_due_jobs', 'purge_guest_application_requests',
      'process_saved_search_alerts', 'process_email_campaigns', 'purge_job_funnel_data',
      'purge_stale_message_attachments', 'rate_limit_gc', 'processed_webhooks_gc',
    ];
    beforeEach(() => {
      resetFakeDb(null);
      for (const fn of RPCS) fakeDb.rpc(fn, 0);
      fakeDb.rpc('claim_storage_deletions', []);
      fakeDb.rpc('claim_company_vies_auto_checks', []);
      vi.stubEnv('MAINTENANCE_SECRET', 'maintenance-secret');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('tryb ogłoszeniowy: zadania rekrutacyjne pominięte, worker alertów wołany', async () => {
      const { POST } = await import('@/app/api/maintenance/route');
      const res = await POST(new Request('http://web.internal/api/maintenance', {
        method: 'POST', headers: { authorization: 'Bearer maintenance-secret' },
      }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ recruitmentTasks: { skipped: 'classifieds_only' } });
      expect(fakeDb.callsTo('process_saved_search_alerts')).toHaveLength(1);
    });
  });
});
