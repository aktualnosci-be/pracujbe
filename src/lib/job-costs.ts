/**
 * „Koszty i dodatki” oferty (migracja 0169) — jedno źródło dla kreatora (zapis), szczegółu
 * oferty (sekcja w stylu paszportu) i JobPosting JSON-LD (`jobBenefits`).
 *
 * Pola są deklaracją pracodawcy: portal niczego nie wylicza (brak netto, brak porównania
 * stawki z minimum komisji parytetowej). Flagi `accommodation`/`transport` (filtry listy)
 * wynikają ze szczegółów, gdy te są podane — tę samą zależność egzekwują CHECK-i w bazie.
 */
import type { JobStep8 } from '@/lib/validation/job';
import { findJointCommittee } from '@/lib/joint-committees';
import { normalizeBenefitCodes } from '@/lib/job-benefits';
import type { Locale } from '@/i18n/routing';

export const ACCOMMODATION_KINDS = ['provided', 'assistance', 'none'] as const;
export type AccommodationKind = (typeof ACCOMMODATION_KINDS)[number];

export const ACCOMMODATION_COST_PERIODS = ['week', 'month'] as const;
export type AccommodationCostPeriod = (typeof ACCOMMODATION_COST_PERIODS)[number];

export const ACCOMMODATION_AFTER_CONTRACT = [
  'ends_with_contract',
  'transition_period',
  'can_stay',
] as const;
export type AccommodationAfterContract = (typeof ACCOMMODATION_AFTER_CONTRACT)[number];

/** Koszty i dodatki oferty publicznej (`get_public_job_costs`). Brak pola = nie podano. */
export interface JobCosts {
  accommodationKind?: AccommodationKind;
  accommodationCost?: number;
  accommodationCostPeriod?: AccommodationCostPeriod;
  accommodationDeducted?: boolean;
  accommodationRegistration?: boolean;
  accommodationAfterContract?: AccommodationAfterContract;
  transportShuttle: boolean;
  transportReimbursed: boolean;
  mealVoucherDaily?: number;
  jointCommittee?: string;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function asAmount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asOptionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Wiersz `get_public_job_costs` (numeric przychodzi z bazy jako tekst) → `JobCosts`. */
export function parseJobCostsRow(row: Record<string, unknown> | null | undefined): JobCosts | undefined {
  if (!row) return undefined;
  const kind = isOneOf(ACCOMMODATION_KINDS, row['accommodation_kind']) ? row['accommodation_kind'] : undefined;
  const provided = kind === 'provided';
  const cost = provided ? asAmount(row['accommodation_cost']) : undefined;
  const period = provided && isOneOf(ACCOMMODATION_COST_PERIODS, row['accommodation_cost_period'])
    ? row['accommodation_cost_period']
    : undefined;
  const after = provided && isOneOf(ACCOMMODATION_AFTER_CONTRACT, row['accommodation_after_contract'])
    ? row['accommodation_after_contract']
    : undefined;
  const committee = typeof row['joint_committee'] === 'string' && findJointCommittee(row['joint_committee'])
    ? row['joint_committee']
    : undefined;
  const meal = asAmount(row['meal_voucher_daily']);
  const deducted = provided ? asOptionalBool(row['accommodation_deducted']) : undefined;
  const registration = provided ? asOptionalBool(row['accommodation_registration']) : undefined;
  return {
    ...(kind ? { accommodationKind: kind } : {}),
    ...(cost !== undefined && period ? { accommodationCost: cost, accommodationCostPeriod: period } : {}),
    ...(deducted !== undefined ? { accommodationDeducted: deducted } : {}),
    ...(registration !== undefined ? { accommodationRegistration: registration } : {}),
    ...(after ? { accommodationAfterContract: after } : {}),
    transportShuttle: row['transport_shuttle'] === true,
    transportReimbursed: row['transport_reimbursed'] === true,
    ...(meal !== undefined && meal > 0 ? { mealVoucherDaily: meal } : {}),
    ...(committee ? { jointCommittee: committee } : {}),
  };
}

/**
 * Krok 8 → kolumny `jobs` (klucze `save_job_draft`/`update_published_job`). Zawsze komplet
 * kluczy kosztów (patch kroku zastępuje poprzednie wartości), szczegóły mieszkania tylko przy
 * rodzaju „zapewnione”, flagi filtrów zgodne ze szczegółami (CHECK-i 0169).
 */
export function jobCostsPatch(v: JobStep8): Record<string, unknown> {
  const kind = v.accommodationKind ?? null;
  const provided = kind === 'provided';
  const hasTransportDetails = v.transportShuttle !== undefined || v.transportReimbursed !== undefined;
  const shuttle = v.transportShuttle === true;
  const reimbursed = v.transportReimbursed === true;
  const cost = provided && v.accommodationCostPeriod ? v.accommodationCost ?? null : null;
  return {
    accommodation: kind ? kind === 'provided' || kind === 'assistance' : v.accommodation,
    transport: hasTransportDetails ? shuttle || reimbursed : v.transport,
    accommodation_kind: kind,
    accommodation_cost: cost,
    accommodation_cost_period: cost === null ? null : v.accommodationCostPeriod ?? null,
    accommodation_deducted: provided ? v.accommodationDeducted ?? null : null,
    accommodation_registration: provided ? v.accommodationRegistration ?? null : null,
    accommodation_after_contract: provided ? v.accommodationAfterContract ?? null : null,
    transport_shuttle: shuttle,
    transport_reimbursed: reimbursed,
    meal_voucher_daily: v.mealVoucherDaily ?? null,
    joint_committee: v.jointCommittee ?? null,
    // 0976 (#826): świadczenia z katalogu — ten sam patch kroku 8 (szkic i rewizja opublikowanej).
    benefit_codes: normalizeBenefitCodes(v.benefitCodes ?? []),
  };
}

/** Teksty sekcji w języku strony (z `src/messages`, namespace `job.costs`). */
export interface JobCostLabels {
  accommodation: string;
  transport: string;
  mealVouchers: string;
  jointCommittee: string;
  yes: string;
  no: string;
  kind: (kind: AccommodationKind) => string;
  cost: (amount: string, period: AccommodationCostPeriod) => string;
  free: string;
  deducted: (yes: boolean) => string;
  registration: (yes: boolean) => string;
  afterContract: (value: AccommodationAfterContract) => string;
  shuttle: string;
  reimbursed: string;
  mealPerDay: (amount: string) => string;
  committeeCode: (code: string) => string;
  money: (amount: number) => string;
}

export interface JobCostItem {
  key: 'accommodation' | 'transport' | 'mealVouchers' | 'jointCommittee';
  label: string;
  value: string;
  details: string[];
  /** Tylko komisja parytetowa: kod ze słownika (link do oficjalnych stawek robi strona). */
  committeeCode?: string;
}

interface CostsSource {
  accommodation: boolean;
  transport: boolean;
  costs?: JobCosts;
}

/**
 * Pozycje sekcji „Koszty i dodatki”. Zakwaterowanie i dojazd są zawsze (stare oferty bez
 * szczegółów pokazują jak dotąd tak/nie z flagi), bony i komisja tylko gdy podane.
 */
export function buildJobCostItems(job: CostsSource, labels: JobCostLabels, locale: Locale): JobCostItem[] {
  const c = job.costs;
  const items: JobCostItem[] = [];

  const accommodationDetails: string[] = [];
  let accommodationValue: string;
  if (c?.accommodationKind) {
    accommodationValue = labels.kind(c.accommodationKind);
    if (c.accommodationKind === 'provided') {
      if (c.accommodationCost !== undefined && c.accommodationCostPeriod) {
        accommodationDetails.push(
          c.accommodationCost === 0
            ? labels.free
            : labels.cost(labels.money(c.accommodationCost), c.accommodationCostPeriod),
        );
      }
      if (c.accommodationDeducted !== undefined) accommodationDetails.push(labels.deducted(c.accommodationDeducted));
      if (c.accommodationRegistration !== undefined) {
        accommodationDetails.push(labels.registration(c.accommodationRegistration));
      }
      if (c.accommodationAfterContract) accommodationDetails.push(labels.afterContract(c.accommodationAfterContract));
    }
  } else {
    accommodationValue = job.accommodation ? labels.yes : labels.no;
  }
  items.push({ key: 'accommodation', label: labels.accommodation, value: accommodationValue, details: accommodationDetails });

  const transportParts = [
    ...(c?.transportShuttle ? [labels.shuttle] : []),
    ...(c?.transportReimbursed ? [labels.reimbursed] : []),
  ];
  items.push({
    key: 'transport',
    label: labels.transport,
    value: transportParts.length > 0 ? transportParts.join(', ') : job.transport ? labels.yes : labels.no,
    details: [],
  });

  if (c?.mealVoucherDaily !== undefined) {
    items.push({
      key: 'mealVouchers',
      label: labels.mealVouchers,
      value: labels.mealPerDay(labels.money(c.mealVoucherDaily)),
      details: [],
    });
  }

  const committee = findJointCommittee(c?.jointCommittee);
  if (committee) {
    items.push({
      key: 'jointCommittee',
      label: labels.jointCommittee,
      value: `${labels.committeeCode(committee.code)} — ${committee.names[locale]}`,
      details: [],
      committeeCode: committee.code,
    });
  }
  return items;
}

/**
 * `jobBenefits` (schema.org JobPosting, tekst) — tylko świadczenia rzeczywiście podane:
 * zakwaterowanie zapewnione/pomoc, dowóz/zwrot, bony. Komisja parytetowa nie ma odpowiednika
 * w schema.org, a „brak”/„nie” nie jest świadczeniem.
 */
export function buildJobBenefitsText(job: CostsSource, labels: JobCostLabels, locale: Locale): string | undefined {
  const lines = buildJobCostItems(job, labels, locale)
    .filter((item) => {
      if (item.key === 'jointCommittee') return false;
      if (item.key === 'accommodation') {
        const kind = job.costs?.accommodationKind;
        return kind ? kind !== 'none' : job.accommodation;
      }
      if (item.key === 'transport') return item.value !== labels.no;
      return true;
    })
    .map((item) => {
      const value = item.value === labels.yes ? '' : `: ${item.value}`;
      const details = item.details.length > 0 ? ` (${item.details.join('; ')})` : '';
      return `${item.label}${value}${details}`;
    });
  return lines.length > 0 ? lines.join('. ') : undefined;
}

/** Kwota w EUR w języku strony — groszy tylko, gdy są (jak `formatSalaryRange`). */
export function formatEuro(amount: number, locale: string): string {
  const digits = Math.round(amount * 100) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Czy oferta podała jakikolwiek szczegół „Kosztów i dodatków” (poza samymi flagami). */
export function hasJobCostDetails(costs: JobCosts | undefined): boolean {
  if (!costs) return false;
  return Boolean(
    costs.accommodationKind ||
      costs.transportShuttle ||
      costs.transportReimbursed ||
      costs.mealVoucherDaily !== undefined ||
      costs.jointCommittee,
  );
}
