/**
 * #792 (migracja 0228 — numer tymczasowy): tryb pracy oferty i kraje kandydata przy pracy
 * w 100% zdalnej. Jedno źródło dla kreatora, walidacji, zapisu (`save_job_draft`,
 * `update_published_job`), odczytu (`get_public_job`) i JobPosting (`jobLocationType`).
 *
 * - `onsite` — praca na miejscu, `hybrid` — część czasu na miejscu, `remote` — 100% zdalnie.
 * - Brak trybu (`null` w bazie) = oferta sprzed 0228: dawny boolean `jobs.remote` nie mówi, czy
 *   praca jest w pełni zdalna, więc nie zgadujemy (JSON-LD bez TELECOMMUTE).
 * - `jobs.remote` zostaje (filtr promienia, matching) i przy ustawionym trybie
 *   jest z niego liczony w bazie: `remote = (work_mode = 'remote')` — praca hybrydowa nie omija
 *   filtra promienia.
 *
 * Lista krajów = lustro `public.job_applicant_country_allowed` (0228); test porównuje 1:1.
 */

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** Kraje UE, EOG, Szwajcaria i Wielka Brytania (ISO 3166-1 alfa-2). */
export const APPLICANT_COUNTRIES = [
  'BE', 'NL', 'LU', 'FR', 'DE', 'PL',
  'AT', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'MT',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'CH', 'GB',
] as const;
export type ApplicantCountry = (typeof APPLICANT_COUNTRIES)[number];

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === 'string' && (WORK_MODES as readonly string[]).includes(value);
}

export function isApplicantCountry(value: unknown): value is ApplicantCountry {
  return typeof value === 'string' && (APPLICANT_COUNTRIES as readonly string[]).includes(value);
}

/** Lista krajów z bazy/formularza → tylko znane kody, bez duplikatów, w kolejności listy. */
export function normalizeApplicantCountries(values: readonly unknown[] | null | undefined): ApplicantCountry[] {
  const wanted = new Set(
    (values ?? []).filter((v): v is string => typeof v === 'string').map((v) => v.trim().toUpperCase()),
  );
  return APPLICANT_COUNTRIES.filter((code) => wanted.has(code));
}

/**
 * Kolumny `jobs` z kroku 3 kreatora. Tryb nieznany (stara oferta bez wyboru) zachowuje dawny
 * boolean `remote` bez zmian; przy wybranym trybie `remote` wynika z trybu (baza liczy to samo).
 */
export function workModePatch(v: {
  remote: boolean;
  workMode?: WorkMode;
  remoteApplicantCountries?: readonly string[];
}): { remote: boolean; work_mode: WorkMode | null; remote_applicant_countries: ApplicantCountry[] } {
  if (!v.workMode) return { remote: v.remote, work_mode: null, remote_applicant_countries: [] };
  const remote = v.workMode === 'remote';
  return {
    remote,
    work_mode: v.workMode,
    remote_applicant_countries: remote ? normalizeApplicantCountries(v.remoteApplicantCountries) : [],
  };
}
