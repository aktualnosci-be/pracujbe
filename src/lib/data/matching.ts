import 'server-only';

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, queryRows, rpcRows } from '@/lib/db/sql';
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
import { scoreMatch, type MatchResult } from '@/lib/matching/score';
import { isRecruitmentEnabled } from '@/lib/portal-mode';

/**
 * Warstwa danych dla dopasowania kandydat↔oferta (Etap 5).
 *
 * Liczy dopasowanie NA ŻYWO z realnego profilu zalogowanego kandydata i znormalizowanych
 * wymagań oferty (RPC `get_job_match_profile`, 0024) — deterministycznym silnikiem
 * `scoreMatch` (bez AI, te same wejścia → ten sam wynik). Zwraca jawny wynik (#197):
 * `none`, gdy brak env (demo), brak sesji, brak profilu kandydata lub oferta niedostępna
 * publicznie; `error`, gdy którykolwiek odczyt (profil, umiejętności, języki, certyfikaty,
 * RPC oferty, słownik lokalizacji) się nie udał — wtedy NIE liczymy procentu z niepełnych danych.
 *
 * Języki przechodzą z poziomami po obu stronach (#195); współrzędne miejscowości pochodzą
 * ze słownika `locations` przez aliasy (#194, 0112) — tylko wiersze dla miasta kandydata
 * i oferty; miasto spoza słownika i listy w kodzie = odległość nieznana.
 *
 * Prywatność: profil kandydata czytany pod RLS (własny wiersz, transakcja sesji
 * `withPortalTransaction`, #25); oferta przez SECURITY DEFINER RPC ograniczone do ofert
 * active+verified i bezpiecznych kolumn.
 */

/**
 * Jawny wynik dopasowania — błąd odczytu nigdy nie udaje wyniku ani braku profilu/oferty.
 * `disabled` = tryb ogłoszeniowy (#1131, decyzja produktowa: portal ogłoszeniowy) — bez odczytu
 * profilu, bez `get_job_match_profile`, bez transakcji.
 */
export type JobMatchLoad =
  | { status: 'ok'; result: MatchResult }
  | { status: 'disabled' }
  | { status: 'none' }
  | { status: 'error' };

/** Błąd odczytu wejścia dopasowania; rejestrowany bez treści zapytania (Invariant #8). */
class MatchReadError extends Error {
  constructor(readonly source: string, readonly readError: unknown) {
    super(`Match input read failed: ${source}`);
    this.name = 'MatchReadError';
  }
}

/** Odczyt jednego wejścia: błąd bazy oznaczamy źródłem (pusta relacja po sukcesie ≠ błąd). */
async function read<T>(source: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new MatchReadError(source, error);
  }
}

/**
 * Dopasowanie zalogowanego kandydata do konkretnej oferty.
 * Bezpieczne do wołania także dla anonimów/pracodawców — wtedy zwraca `none`.
 */
export async function getMyJobMatch(jobId: string): Promise<JobMatchLoad> {
  // #1131: tryb ogłoszeniowy — portal nie liczy dopasowania (przed jakimkolwiek odczytem).
  if (!isRecruitmentEnabled('matching')) return { status: 'disabled' };
  if (!isPortalDataConfigured()) {
    // Izolowany serwer dev testów E2E (błąd odczytu). Ta gałąź nie działa w buildzie produkcyjnym.
    if (process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'error') {
      return { status: 'error' };
    }
    return { status: 'none' };
  }
  if (!jobId) return { status: 'none' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'none' };
    const inputs = await withPortalTransaction(me, async (tx) => {
      // Profil kandydata (własny wiersz pod RLS). Brak (po udanym odczycie) → nie kandydat.
      const cpData = await read('candidate_profiles', () => queryOne(tx, 'matching.candidate-profile',
        `SELECT id, occupations, categories, preferred_contract_types, city, region, radius_km,
                has_driving_license, has_car, experience_years, availability
           FROM public.candidate_profiles
          WHERE profile_id = $1`, [me.id]));
      if (!cpData) return null;
      const rawId = asRecord(cpData)['id'];
      const profileId = typeof rawId === 'string' ? rawId : '';
      if (!profileId) return null;
      // Każdy odczyt osobno (sekwencyjnie na jednej transakcji): pusta relacja po sukcesie
      // ≠ relacja nieodczytana (błąd przerywa całość z nazwą źródła).
      const skills = await read('candidate_skills', () => queryRows(tx, 'matching.candidate-skills',
        'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1', [profileId]));
      const languages = await read('candidate_languages', () => queryRows(tx, 'matching.candidate-languages',
        `SELECT cl.language_label, cl.level, lg.code AS language_code
           FROM public.candidate_languages cl
           LEFT JOIN public.languages lg ON lg.id = cl.language_id
          WHERE cl.candidate_profile_id = $1`, [profileId]));
      const certificates = await read('candidate_certificates', () => queryRows(tx, 'matching.candidate-certificates',
        'SELECT certificate_label, expires_at::text AS expires_at FROM public.candidate_certificates WHERE candidate_profile_id = $1',
        [profileId]));
      const jobRows = await read('get_job_match_profile', () =>
        rpcRows(tx, 'get_job_match_profile', { p_job_id: jobId }));
      // Tylko aliasy miasta kandydata i oferty (klucz `cityKey`), nie cały słownik.
      const lookup = locationLookupKeys(rowCity(cpData), rowCity(jobRows[0]));
      const locations = lookup.length === 0 ? [] : await read('locations', () =>
        queryRows(tx, 'matching.locations', LOCATION_ROWS_SQL, [lookup]));
      return { cpData, skills, languages, certificates, jobRows, locationRows: locations };
    });
    if (!inputs) return { status: 'none' };

    const jobRow = inputs.jobRows[0];
    // Udany odczyt bez wiersza: oferta niedostępna publicznie (nie active/verified) lub nie istnieje.
    if (!jobRow) return { status: 'none' };
    const locations = locationRows(inputs.locationRows);
    const candidate = buildMatchCandidate(inputs.cpData, inputs, locations);
    const job = buildMatchJob(jobRow, locations);

    return { status: 'ok', result: scoreMatch(candidate, job, { today: referenceDate() }) };
  } catch (error) {
    captureError(error instanceof MatchReadError ? error.readError : error, {
      area: 'matching.getMyJobMatch',
      ...(error instanceof MatchReadError ? { source: error.source } : {}),
    });
    return { status: 'error' };
  }
}
