/**
 * Strukturalne świadczenia oferty (#826, migracja 0976 — numer tymczasowy). Moduł czysty, bez
 * Zoda (importują go klienckie panele filtrów i kreator, #390). Lustro bazy:
 *   * `JOB_BENEFIT_CODES` = `job_benefit_catalog()` (ta sama kolejność — porządek wyświetlania),
 *   * `effectiveBenefitCodes` = `job_effective_benefits(codes, transport_reimbursed, meal_voucher_daily)`:
 *     zaznaczone kody + bony żywieniowe z kwoty i zwrot kosztów dojazdu z „Kosztów i dodatków” (0169).
 * Zgodność pilnuje `tests/unit/job-benefits.test.ts`. Etykiety: `jobBenefits.<kod>` w src/messages.
 * Brak kodu = „nie podano”, nie „nie oferuje” — nie zgadujemy kategorii z tekstu.
 */

export const JOB_BENEFIT_CODES = [
  'meal_vouchers',
  'eco_vouchers',
  'commute_allowance',
  'bike_allowance',
  'company_car',
  'mobility_budget',
  'hospital_insurance',
  'group_insurance',
  'year_end_bonus',
  'extra_leave',
  'training',
  'phone_laptop',
] as const;

export type JobBenefitCode = (typeof JOB_BENEFIT_CODES)[number];

export function isJobBenefitCode(value: unknown): value is JobBenefitCode {
  return typeof value === 'string' && (JOB_BENEFIT_CODES as readonly string[]).includes(value);
}

/** Znane kody bez powtórzeń, w porządku katalogu (jak `job_benefit_codes_from_jsonb`). */
export function normalizeBenefitCodes(values: readonly unknown[] | null | undefined): JobBenefitCode[] {
  if (!values) return [];
  const set = new Set(values.filter(isJobBenefitCode));
  return JOB_BENEFIT_CODES.filter((code) => set.has(code));
}

/** Lustro `job_effective_benefits` (0976). */
export function effectiveBenefitCodes(input: {
  codes?: readonly JobBenefitCode[] | null;
  transportReimbursed?: boolean | null;
  mealVoucherDaily?: number | null;
}): JobBenefitCode[] {
  const set = new Set<JobBenefitCode>(input.codes ?? []);
  if (input.mealVoucherDaily !== undefined && input.mealVoucherDaily !== null) set.add('meal_vouchers');
  if (input.transportReimbursed) set.add('commute_allowance');
  return JOB_BENEFIT_CODES.filter((code) => set.has(code));
}

/** Oferta ma KAŻDE wybrane świadczenie — lustro `@> p_benefits` (pusta lista = bez filtra). */
export function benefitsMatch(offer: readonly JobBenefitCode[], wanted: readonly JobBenefitCode[]): boolean {
  return wanted.every((code) => offer.includes(code));
}

/** Sekcja „Świadczenia” szczegółu oferty (`get_public_job_benefits`). */
export interface JobBenefits {
  codes: JobBenefitCode[];
  /** Tekstowe „inne świadczenia / szczegóły” z tłumaczenia (`job_translations.benefits`). */
  other: string[];
}

/** Parser wiersza RPC — nieznane kody i puste teksty pomijane; brak wiersza = brak sekcji. */
export function parseJobBenefitsRow(row: Record<string, unknown> | null | undefined): JobBenefits | undefined {
  if (!row) return undefined;
  const codes = Array.isArray(row['codes']) ? normalizeBenefitCodes(row['codes']) : [];
  const other = Array.isArray(row['other'])
    ? row['other'].filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
    : [];
  return { codes, other };
}
