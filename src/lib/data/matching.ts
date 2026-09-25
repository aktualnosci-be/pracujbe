import 'server-only';

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, queryRows, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/sentry';
import { locationLookupKeys, resolveCoordinates, type LocationAliasRow } from '@/lib/matching/locations';
import { referenceDate } from '@/lib/matching/reference-date';
import {
  scoreMatch,
  type CertificateEntry,
  type LanguageEntry,
  type MatchCandidate,
  type MatchJob,
  type MatchResult,
} from '@/lib/matching/score';

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
 * ze słownika `locations` przez aliasy (#194, 0109) — tylko wiersze dla miasta kandydata
 * i oferty; miasto spoza słownika i listy w kodzie = odległość nieznana.
 *
 * Prywatność: profil kandydata czytany pod RLS (własny wiersz, transakcja sesji
 * `withPortalTransaction`, #25); oferta przez SECURITY DEFINER RPC ograniczone do ofert
 * active+verified i bezpiecznych kolumn.
 */

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
/** Tablica stringów (odfiltrowane puste) — dla kolumn text[]/enum[] i wyników zapytań. */
function asStrArr(value: unknown): string[] {
  return asArr(value).map((v) => asStr(v)).filter((v) => v.length > 0);
}
/** Języki z poziomem: wiersze relacji {language_label, level} albo jsonb {label, level} z RPC. */
function languagesFrom(rows: unknown, labelField: string): LanguageEntry[] {
  return asArr(rows)
    .map((r) => {
      const rec = asRecord(r);
      return { label: asStr(rec[labelField]), level: asStr(rec['level']) || null };
    })
    .filter((entry) => entry.label.length > 0);
}
function locationRows(rows: unknown): LocationAliasRow[] {
  return asArr(rows).map((r) => {
    const rec = asRecord(r);
    // numeric może przyjść jako string (zależnie od serializacji) — konwersja jawna.
    const coord = (v: unknown): number | null => {
      const n = typeof v === 'string' ? Number(v) : v;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    };
    return {
      aliasKey: asStr(rec['alias_key']),
      latitude: coord(rec['latitude']),
      longitude: coord(rec['longitude']),
    };
  });
}
/** Etykiety z relacji (np. candidate_skills.skill_label) po podanym polu. */
function labelsFrom(rows: unknown, field: string): string[] {
  return asArr(rows)
    .map((r) => asStr(asRecord(r)[field]))
    .filter((v) => v.length > 0);
}

/** Certyfikaty kandydata z datą ważności (#96) — `expires_at` null = bezterminowy. */
function certificatesFrom(rows: unknown): CertificateEntry[] {
  return asArr(rows)
    .map((r) => {
      const rec = asRecord(r);
      return { label: asStr(rec['certificate_label']), expiresAt: asStr(rec['expires_at']) || null };
    })
    .filter((c) => c.label.length > 0);
}

/** Jawny wynik dopasowania — błąd odczytu nigdy nie udaje wyniku ani braku profilu/oferty. */
export type JobMatchLoad =
  | { status: 'ok'; result: MatchResult }
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
      const profileId = asStr(asRecord(cpData)['id']);
      if (!profileId) return null;
      // Każdy odczyt osobno (sekwencyjnie na jednej transakcji): pusta relacja po sukcesie
      // ≠ relacja nieodczytana (błąd przerywa całość z nazwą źródła).
      const skills = await read('candidate_skills', () => queryRows(tx, 'matching.candidate-skills',
        'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1', [profileId]));
      const languages = await read('candidate_languages', () => queryRows(tx, 'matching.candidate-languages',
        'SELECT language_label, level FROM public.candidate_languages WHERE candidate_profile_id = $1', [profileId]));
      const certificates = await read('candidate_certificates', () => queryRows(tx, 'matching.candidate-certificates',
        'SELECT certificate_label, expires_at FROM public.candidate_certificates WHERE candidate_profile_id = $1',
        [profileId]));
      const jobRows = await read('get_job_match_profile', () =>
        rpcRows(tx, 'get_job_match_profile', { p_job_id: jobId }));
      // Tylko aliasy miasta kandydata i oferty (klucz `cityKey`), nie cały słownik.
      const lookup = locationLookupKeys(asStr(asRecord(cpData)['city']), asStr(asRecord(jobRows[0])['city']));
      const locations = lookup.length === 0 ? [] : await read('locations', () => queryRows(tx, 'matching.locations',
        `SELECT a.alias_key, l.latitude, l.longitude
           FROM public.location_aliases a
           JOIN public.locations l ON l.id = a.location_id
          WHERE l.is_active = true AND a.alias_key = ANY($1::text[])`, [lookup]));
      return { cpData, skills, languages, certificates, jobRows, locationRows: locations };
    });
    if (!inputs) return { status: 'none' };
    const cp = asRecord(inputs.cpData);

    const jobRow = inputs.jobRows[0];
    // Udany odczyt bez wiersza: oferta niedostępna publicznie (nie active/verified) lub nie istnieje.
    if (!jobRow) return { status: 'none' };
    const jr = asRecord(jobRow);
    const locations = locationRows(inputs.locationRows);
    const candidateCity = asStr(cp['city']) || undefined;
    const jobCity = asStr(jr['city']) || undefined;
    // Poziomy wymagane przez ofertę (0074); starsze RPC bez kolumny → same etykiety (poziom dowolny).
    const jobLanguages: LanguageEntry[] = Array.isArray(jr['language_requirements'])
      ? languagesFrom(jr['language_requirements'], 'label')
      : asStrArr(jr['languages']);
    const candidate: MatchCandidate = {
      occupations: asStrArr(cp['occupations']),
      categories: asStrArr(cp['categories']),
      skills: labelsFrom(inputs.skills, 'skill_label'),
      city: candidateCity,
      region: asStr(cp['region']) || undefined,
      radiusKm: asNum(cp['radius_km']),
      coordinates: resolveCoordinates(candidateCity, locations),
      experienceYears: asNum(cp['experience_years']),
      availability: asStr(cp['availability']) || undefined,
      languages: languagesFrom(inputs.languages, 'language_label'),
      certificates: certificatesFrom(inputs.certificates),
      hasDrivingLicense: cp['has_driving_license'] === true,
      hasCar: cp['has_car'] === true,
      preferredContractTypes: asStrArr(cp['preferred_contract_types']),
    };

    const job: MatchJob = {
      occupation: asStr(jr['occupation']) || undefined,
      category: asStr(jr['category']) || undefined,
      skills: asStrArr(jr['skills']),
      mandatorySkills: asStrArr(jr['mandatory_skills']),
      city: jobCity,
      region: asStr(jr['region']) || undefined,
      coordinates: resolveCoordinates(jobCity, locations),
      minExperienceYears: asNum(jr['min_experience_years']),
      // Realne wymagania językowe/certyfikatowe oferty (relacje 0030, RPC get_job_match_profile).
      requiredLanguages: jobLanguages,
      requiredCertificates: asStrArr(jr['certificates']),
      requiresDrivingLicense: jr['requires_driving_license'] === true,
      contractType: asStr(jr['contract_type']) || undefined,
      startImmediately: jr['start_immediately'] === true,
      remote: jr['remote'] === true,
    };

    return { status: 'ok', result: scoreMatch(candidate, job, { today: referenceDate() }) };
  } catch (error) {
    captureError(error instanceof MatchReadError ? error.readError : error, {
      area: 'matching.getMyJobMatch',
      ...(error instanceof MatchReadError ? { source: error.source } : {}),
    });
    return { status: 'error' };
  }
}
