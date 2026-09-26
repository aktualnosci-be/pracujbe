import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { jsonArg, queryRows, rpc, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import {
  asRecord,
  buildMatchCandidate,
  buildMatchJob,
  LOCATION_ROWS_SQL,
  locationRows,
  rowCity,
} from '@/lib/matching/inputs';
import { locationLookupKeys } from '@/lib/matching/locations';
import { referenceDate } from '@/lib/matching/reference-date';
import { scoreMatch } from '@/lib/matching/score';

/**
 * Materializacja dopasowań `matches` (audyt P1-03, migracja 0190).
 *
 * Triggery zgłaszają podmiot (kandydat albo oferta) do `match_recompute_queue`; ten worker,
 * wołany z `/api/maintenance`, bierze partię (`match_recompute_claim`, SKIP LOCKED, dzierżawa),
 * pobiera wejścia (`match_recompute_inputs` — tylko pary, które baza kwalifikuje: profil
 * wyszukiwalny i ukończony #494, 18+ #492, bez blokady firmy #97, oferta aktywna firmy
 * `verified`), liczy wynik TYM SAMYM `scoreMatch` co szczegół oferty (wspólne mapowanie
 * `inputs.ts`, bez AI) i zapisuje go `match_recompute_apply` — baza sprawdza każdą parę
 * ponownie, usuwa wiersze niekwalifikujące się i zdejmuje podmiot z kolejki tylko przy
 * niezmienionej wersji. Każdy podmiot = osobne krótkie transakcje (odczyt, zapis).
 *
 * Zapisywane są tylko pary z wynikiem ≥ MATCH_MIN_STORED_SCORE — reszta (rozważona)
 * znika z tabeli. Błąd jednego podmiotu nie zatrzymuje partii: podmiot wraca do kolejki
 * po wygaśnięciu dzierżawy (najwyżej 5 prób, potem czeka na kolejne zgłoszenie).
 * Wynik i log: same liczniki — bez identyfikatorów i treści profilu.
 */

/** Próg zapisu: poniżej wynik „low” bez wartości dla list dopasowanych (summaryKey 40). */
export const MATCH_MIN_STORED_SCORE = 40;
/** Podmiotów w jednym zgłoszeniu claim i łącznie na jedno wywołanie maintenance. */
export const MATCH_CLAIM_LIMIT = 20;
export const MATCH_MAX_SUBJECTS = 100;
/** Stron przeciwnych na podmiot (limit bazy: 1000). */
export const MATCH_PAIR_LIMIT = 500;

export type MatchRecomputeRun = {
  subjects: number;
  failed: number;
  upserted: number;
  deleted: number;
  skipped: number;
};

type Claimed = { kind: 'candidate' | 'job'; subject_id: string; version: number | string };

function int(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
function id(value: unknown): string {
  const raw = asRecord(value);
  const v = raw['profile_id'] ?? raw['job_id'];
  return typeof v === 'string' ? v : '';
}

/** Wiersze do zapisu dla jednego podmiotu — czysta funkcja (test jednostkowy bez bazy). */
export function computeSubjectRows(
  kind: 'candidate' | 'job',
  inputs: unknown,
  locations: unknown,
  today: string,
): { considered: string[]; rows: Record<string, unknown>[] } {
  const data = asRecord(inputs);
  if (data['eligible'] !== true) return { considered: [], rows: [] };
  const candidates = Array.isArray(data['candidates']) ? data['candidates'] : [];
  const jobs = Array.isArray(data['jobs']) ? data['jobs'] : [];
  const locs = locationRows(locations);
  const others = kind === 'candidate' ? jobs : candidates;
  const [subject] = kind === 'candidate' ? candidates : jobs;
  if (!subject) return { considered: [], rows: [] };

  const considered: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const other of others) {
    const otherId = id(other);
    if (!otherId) continue;
    considered.push(otherId);
    const cand = kind === 'candidate' ? subject : other;
    const job = kind === 'candidate' ? other : subject;
    const c = asRecord(cand);
    const result = scoreMatch(
      buildMatchCandidate(
        c,
        { skills: c['skills'], languages: c['languages'], certificates: c['certificates'] },
        locs,
      ),
      buildMatchJob(job, locs),
      { today },
    );
    if (result.score < MATCH_MIN_STORED_SCORE) continue;
    rows.push({
      other_id: otherId,
      score: result.score,
      matched: result.matched,
      missing: result.missing,
      strengths: result.strengths,
      mandatory_met: result.mandatoryMet,
      mandatory_total: result.mandatoryTotal,
      summary_key: result.summaryKey,
    });
  }
  return { considered, rows };
}

/** Miasta podmiotu i stron przeciwnych → klucze aliasów (jedno zapytanie na podmiot). */
function cityKeys(inputs: unknown): string[] {
  const data = asRecord(inputs);
  const all = [
    ...(Array.isArray(data['candidates']) ? data['candidates'] : []),
    ...(Array.isArray(data['jobs']) ? data['jobs'] : []),
  ];
  return locationLookupKeys(...all.map(rowCity));
}

export async function runMatchRecompute(
  options: { maxSubjects?: number; claimLimit?: number; pairLimit?: number; now?: () => Date } = {},
): Promise<MatchRecomputeRun> {
  const maxSubjects = options.maxSubjects ?? MATCH_MAX_SUBJECTS;
  const claimLimit = options.claimLimit ?? MATCH_CLAIM_LIMIT;
  const pairLimit = options.pairLimit ?? MATCH_PAIR_LIMIT;
  const today = referenceDate(options.now?.() ?? new Date());
  const run: MatchRecomputeRun = { subjects: 0, failed: 0, upserted: 0, deleted: 0, skipped: 0 };

  while (run.subjects < maxSubjects) {
    const claimed = await withServiceRole((tx) =>
      rpcRows<Claimed>(tx, 'match_recompute_claim', {
        p_limit: Math.min(claimLimit, maxSubjects - run.subjects),
      }),
    );
    if (claimed.length === 0) break;
    for (const item of claimed) {
      run.subjects += 1;
      try {
        const { inputs, locations } = await withServiceRole(async (tx) => {
          const inputs = await rpc(tx, 'match_recompute_inputs', {
            p_kind: item.kind,
            p_subject: item.subject_id,
            p_limit: pairLimit,
          });
          const keys = cityKeys(inputs);
          const locations = keys.length === 0 ? [] : await queryRows(tx, 'matching.locations', LOCATION_ROWS_SQL, [keys]);
          return { inputs, locations };
        });
        const { considered, rows } = computeSubjectRows(item.kind, inputs, locations, today);
        const applied = asRecord(
          await withServiceRole((tx) =>
            rpc(tx, 'match_recompute_apply', {
              p_kind: item.kind,
              p_subject: item.subject_id,
              p_version: item.version,
              p_considered: jsonArg(considered),
              p_rows: jsonArg(rows),
            }),
          ),
        );
        run.upserted += int(applied['upserted']);
        run.deleted += int(applied['deleted']);
        run.skipped += int(applied['skipped']);
      } catch (error) {
        // Podmiot wraca do kolejki po dzierżawie; w logu tylko rodzaj (bez UUID).
        run.failed += 1;
        captureError(error, { area: 'matching.materialize', kind: item.kind });
      }
    }
    if (claimed.length < claimLimit) break;
  }
  return run;
}
