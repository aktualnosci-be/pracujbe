import { resolveCoordinates, type LocationAliasRow } from '@/lib/matching/locations';
import type { CertificateEntry, LanguageEntry, MatchCandidate, MatchJob } from '@/lib/matching/score';

/**
 * Wejścia `scoreMatch` z wierszy bazy — JEDNO mapowanie dla odczytu live
 * (`src/lib/data/matching.ts`, profil pod RLS) i materializacji `matches`
 * (`src/lib/matching/materialize.ts`, P1-03). Dzięki temu wiersz `matches` i procent na
 * szczególe oferty liczy ten sam kod z tych samych pól.
 *
 * Kandydat: kolumny `candidate_profiles` + relacje `skills` ({skill_label}), `languages`
 * ({language_label, level}), `certificates` ({certificate_label, expires_at}).
 * Oferta: wiersz `get_job_match_profile` (0074).
 */

/** Zapytanie o współrzędne aliasów (#194, 0112) — tylko podane klucze `cityKey`. */
export const LOCATION_ROWS_SQL = `SELECT a.alias_key, l.latitude, l.longitude
           FROM public.location_aliases a
           JOIN public.locations l ON l.id = a.location_id
          WHERE l.is_active = true AND a.alias_key = ANY($1::text[])`;

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
/** Tablica stringów (odfiltrowane puste) — dla kolumn text[]/enum[] i wyników zapytań. */
function asStrArr(value: unknown): string[] {
  return asArr(value).map((v) => asStr(v)).filter((v) => v.length > 0);
}
/** Data 'YYYY-MM-DD' z tekstu albo z `Date` sterownika pg (kolumna `date` bez rzutowania). */
function asIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return asStr(value).slice(0, 10);
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
      return { label: asStr(rec['certificate_label']), expiresAt: asIsoDate(rec['expires_at']) || null };
    })
    .filter((c) => c.label.length > 0);
}

export function locationRows(rows: unknown): LocationAliasRow[] {
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

/** Miasto z wiersza kandydata albo oferty (do zapytania o aliasy). */
export function rowCity(row: unknown): string {
  return asStr(asRecord(row)['city']);
}

export type CandidateRelations = { skills: unknown; languages: unknown; certificates: unknown };

export function buildMatchCandidate(
  profile: unknown,
  relations: CandidateRelations,
  locations: readonly LocationAliasRow[],
): MatchCandidate {
  const cp = asRecord(profile);
  const city = asStr(cp['city']) || undefined;
  return {
    occupations: asStrArr(cp['occupations']),
    categories: asStrArr(cp['categories']),
    skills: labelsFrom(relations.skills, 'skill_label'),
    city,
    region: asStr(cp['region']) || undefined,
    radiusKm: asNum(cp['radius_km']),
    coordinates: resolveCoordinates(city, locations),
    experienceYears: asNum(cp['experience_years']),
    availability: asStr(cp['availability']) || undefined,
    languages: languagesFrom(relations.languages, 'language_label'),
    certificates: certificatesFrom(relations.certificates),
    hasDrivingLicense: cp['has_driving_license'] === true,
    hasCar: cp['has_car'] === true,
    preferredContractTypes: asStrArr(cp['preferred_contract_types']),
  };
}

export function buildMatchJob(row: unknown, locations: readonly LocationAliasRow[]): MatchJob {
  const jr = asRecord(row);
  const city = asStr(jr['city']) || undefined;
  // Poziomy wymagane przez ofertę (0074); starsze RPC bez kolumny → same etykiety (poziom dowolny).
  const requiredLanguages: LanguageEntry[] = Array.isArray(jr['language_requirements'])
    ? languagesFrom(jr['language_requirements'], 'label')
    : asStrArr(jr['languages']);
  return {
    occupation: asStr(jr['occupation']) || undefined,
    category: asStr(jr['category']) || undefined,
    skills: asStrArr(jr['skills']),
    mandatorySkills: asStrArr(jr['mandatory_skills']),
    city,
    region: asStr(jr['region']) || undefined,
    coordinates: resolveCoordinates(city, locations),
    minExperienceYears: asNum(jr['min_experience_years']),
    // Realne wymagania językowe/certyfikatowe oferty (relacje 0030, RPC get_job_match_profile).
    requiredLanguages,
    requiredCertificates: asStrArr(jr['certificates']),
    requiresDrivingLicense: jr['requires_driving_license'] === true,
    contractType: asStr(jr['contract_type']) || undefined,
    startImmediately: jr['start_immediately'] === true,
    remote: jr['remote'] === true,
  };
}
