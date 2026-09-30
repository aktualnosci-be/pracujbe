import { z } from 'zod/v3';
import {
  categoryKeySchema,
  contractTypeSchema,
  candidateLanguageSchema,
} from '@/lib/validation/candidate';
import { localeSchema } from '@/lib/validation/auth';
import { refineScreeningPrimaryLocale, screeningQuestionsSchema } from '@/lib/validation/screening';
import { JOINT_COMMITTEE_CODES } from '@/lib/joint-committees';
import {
  APPLY_EMAIL_MAX_LENGTH,
  APPLY_URL_MAX_LENGTH,
  hasApplyChannel,
  isApplyEmail,
  isApplyPhone,
  isApplyUrl,
  normalizeApplyPhone,
} from '@/lib/job-apply-channel';
import {
  ACCOMMODATION_AFTER_CONTRACT,
  ACCOMMODATION_COST_PERIODS,
  ACCOMMODATION_KINDS,
} from '@/lib/job-costs';
import { WORK_TIME_VALUES } from '@/lib/job-filter-options';

/**
 * Walidacja kreatora oferty pracy — dziewięć kroków + pełny jobSchema.
 *
 * Kroki bazowe są zwykłymi obiektami (ZodObject), by dało się je łączyć (.merge) w jobSchema.
 * Reguły międzypolowe (np. salaryMax >= salaryMin) dokładane są przez .refine na wersjach
 * eksportowanych kroków oraz na finalnym jobSchema.
 *
 * Komunikaty błędów to klucze i18n.
 */

export const SALARY_PERIODS = ['hour', 'month', 'year'] as const;
export const salaryPeriodSchema = z.enum(SALARY_PERIODS);

/**
 * Limity długości pojedynczej pozycji list kreatora (#364). Wymagania, umiejętności i certyfikaty
 * odpowiadają `left(btrim(...), N)` w RPC relacji oferty (0047/0051) — walidacja odrzuca za długą
 * pozycję, zanim baza by ją po cichu obcięła. Obowiązki/warunki/benefity nie mają limitu w DB;
 * dostają ten sam sufit co wymaganie, by lista w UI zachowywała się spójnie.
 */
export const JOB_ITEM_LIMITS = {
  requirement: 500,
  line: 500,
  skill: 120,
  certificate: 160,
} as const;

const itemLine = (max: number) =>
  z.string().trim().min(1).max(max, 'job.error.itemTooLong');
const requirementLine = itemLine(JOB_ITEM_LIMITS.requirement);
const textLine = itemLine(JOB_ITEM_LIMITS.line);
const skillLine = itemLine(JOB_ITEM_LIMITS.skill);
const certificateLine = itemLine(JOB_ITEM_LIMITS.certificate);

/** Krok 1 — podstawy: tytuł, kategoria, zawód. */
const step1Base = z.object({
  title: z
    .string({ required_error: 'job.error.titleRequired' })
    .trim()
    // Pusty string (formularz wysyła '') → „wymagane", a „za krótkie" dopiero dla 1–4 znaków (#367).
    .min(1, 'job.error.titleRequired')
    .min(5, 'job.error.titleTooShort')
    .max(120, 'job.error.titleTooLong'),
  category: categoryKeySchema,
  // #1048 (I18N-01): jawny język ogłoszenia (`jobs.default_locale` szkicu). Opcjonalny —
  // brak = język bez zmian (edycja opublikowanej oferty i starsi wołający nie wysyłają pola).
  contentLocale: localeSchema.optional(),
  occupation: z
    .string({ required_error: 'job.error.occupationRequired' })
    .trim()
    .min(2, 'job.error.occupationRequired')
    .max(80, 'job.error.occupationTooLong'),
});
export const step1Schema = step1Base;

/** Krok 2 — umowa i grafik. */
const step2Base = z.object({
  contractType: contractTypeSchema,
  workingHours: z
    .string({ required_error: 'job.error.workingHoursRequired' })
    .trim()
    .min(2, 'job.error.workingHoursRequired')
    .max(80, 'job.error.workingHoursTooLong'),
  shifts: z.string().trim().max(120, 'job.error.shiftsTooLong').optional(),
  /** #811 (0194): wymiar pracy (filtr listy); brak = pracodawca nie podaje. */
  workTime: z.enum(WORK_TIME_VALUES).optional(),
  startImmediately: z.boolean().default(false),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'job.error.startDateInvalid')
    .optional(),
});
export const step2Schema = step2Base;

/** Krok 3 — lokalizacja. */
const step3Base = z.object({
  city: z
    .string({ required_error: 'job.error.cityRequired' })
    .trim()
    .min(2, 'job.error.cityRequired')
    .max(80, 'job.error.cityTooLong'),
  region: z
    .string({ required_error: 'job.error.regionRequired' })
    .trim()
    .min(2, 'job.error.regionRequired')
    .max(80, 'job.error.regionTooLong'),
  address: z.string().trim().max(160, 'job.error.addressTooLong').optional(),
  remote: z.boolean().default(false),
});
export const step3Schema = step3Base;

/** Krok 4 — wynagrodzenie (salaryMax >= salaryMin). */
const step4Base = z.object({
  salaryMin: z
    .number({ invalid_type_error: 'job.error.salaryInvalid' })
    .int('job.error.salaryInvalid')
    .min(0, 'job.error.salaryInvalid')
    .max(1000000, 'job.error.salaryInvalid')
    .optional(),
  salaryMax: z
    .number({ invalid_type_error: 'job.error.salaryInvalid' })
    .int('job.error.salaryInvalid')
    .min(0, 'job.error.salaryInvalid')
    .max(1000000, 'job.error.salaryInvalid')
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'job.error.currencyInvalid')
    .default('EUR'),
  salaryPeriod: salaryPeriodSchema.default('month'),
});
const salaryRefine = (data: { salaryMin?: number; salaryMax?: number }): boolean =>
  data.salaryMin == null || data.salaryMax == null || data.salaryMax >= data.salaryMin;
export const step4Schema = step4Base.refine(salaryRefine, {
  path: ['salaryMax'],
  message: 'job.error.salaryRangeInvalid',
});

/** Krok 5 — opis roli i obowiązki. */
const step5Base = z.object({
  description: z
    .string({ required_error: 'job.error.descriptionRequired' })
    .trim()
    .min(1, 'job.error.descriptionRequired')
    .min(30, 'job.error.descriptionTooShort')
    .max(5000, 'job.error.descriptionTooLong'),
  responsibilities: z
    .array(textLine)
    .min(1, 'job.error.responsibilitiesRequired')
    .max(20, 'job.error.responsibilitiesTooMany'),
});
export const step5Schema = step5Base;

/** Krok 6 — wymagania obowiązkowe. */
const step6Base = z.object({
  requirementsMandatory: z
    .array(requirementLine)
    .min(1, 'job.error.requirementsMandatoryRequired')
    .max(20, 'job.error.requirementsTooMany'),
  mandatorySkills: z
    .array(skillLine)
    .max(30, 'job.error.skillsTooMany')
    .default([]),
  minExperienceYears: z
    .number({ invalid_type_error: 'job.error.experienceInvalid' })
    .int('job.error.experienceInvalid')
    .min(0, 'job.error.experienceInvalid')
    .max(60, 'job.error.experienceInvalid')
    .optional(),
});
export const step6Schema = step6Base;

/** Krok 7 — wymagania dodatkowe, języki, transport. */
const step7Base = z.object({
  requirementsOptional: z
    .array(requirementLine)
    .max(20, 'job.error.requirementsTooMany')
    .default([]),
  skills: z.array(skillLine).max(30, 'job.error.skillsTooMany').default([]),
  languages: z
    .array(candidateLanguageSchema)
    .max(10, 'job.error.languagesTooMany')
    .default([]),
  requiredCertificates: z
    .array(certificateLine)
    .max(20, 'job.error.certificatesTooMany')
    .default([]),
  requiresDrivingLicense: z.boolean().default(false),
  noLanguageRequired: z.boolean().default(false),
  // #101: pytania screeningowe; `screeningLocale` = język treści oferty (tekst wymagany).
  screeningQuestions: screeningQuestionsSchema,
  screeningLocale: localeSchema.optional(),
});
/**
 * #910: „Praca bez znajomości języka” i lista wymaganych języków wykluczają się nawzajem —
 * flaga i `languages` są zapisywane niezależnie (filtr publiczny czyta tylko flagę, dopasowanie
 * tylko listę), więc jednoczesne ustawienie obu dawało sprzeczny wynik dla kandydata. Błąd
 * przy polu `languages` (ta sama lista, gdzie kandydat/rekruter je widzi i usuwa).
 */
function refineNoLanguageConflict(
  data: { languages: unknown[]; noLanguageRequired: boolean },
  ctx: z.RefinementCtx,
): void {
  if (data.noLanguageRequired && data.languages.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['languages'],
      message: 'job.error.noLanguageConflict',
    });
  }
}

export const step7Schema = step7Base.superRefine((data, ctx) => {
  refineScreeningPrimaryLocale(data.screeningQuestions, data.screeningLocale, ctx);
  refineNoLanguageConflict(data, ctx);
});

/** Kwota w EUR z najwyżej dwoma miejscami po przecinku (koszty i bony, 0169). */
const euroAmount = (min: number, max: number, message: string) =>
  z
    .number({ invalid_type_error: message })
    .min(min, message)
    .max(max, message)
    .refine((value) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, message);

/**
 * Krok 8 — warunki i benefity + „Koszty i dodatki” (0169). Flagi `accommodation`/`transport`
 * zostają (filtry listy, import AI); gdy podany jest rodzaj zakwaterowania albo szczegóły
 * dojazdu, flagi wynikają z nich (`jobCostsPatch`). Wszystkie nowe pola są opcjonalne —
 * deklaracja pracodawcy, portal jej nie ocenia. Limity = CHECK-i w bazie.
 */
const step8Base = z.object({
  conditions: z.array(textLine).max(20, 'job.error.conditionsTooMany').default([]),
  benefits: z.array(textLine).max(20, 'job.error.benefitsTooMany').default([]),
  accommodation: z.boolean().default(false),
  transport: z.boolean().default(false),
  accommodationKind: z.enum(ACCOMMODATION_KINDS).optional(),
  accommodationCost: euroAmount(0, 5000, 'job.error.accommodationCostInvalid').optional(),
  accommodationCostPeriod: z.enum(ACCOMMODATION_COST_PERIODS).optional(),
  accommodationDeducted: z.boolean().optional(),
  accommodationRegistration: z.boolean().optional(),
  accommodationAfterContract: z.enum(ACCOMMODATION_AFTER_CONTRACT).optional(),
  transportShuttle: z.boolean().optional(),
  transportReimbursed: z.boolean().optional(),
  mealVoucherDaily: euroAmount(0.01, 20, 'job.error.mealVoucherInvalid').optional(),
  jointCommittee: z
    .string()
    .refine((code) => JOINT_COMMITTEE_CODES.includes(code), 'job.error.jointCommitteeInvalid')
    .optional(),
});

function refineJobCosts(
  data: {
    accommodationKind?: string;
    accommodationCost?: number;
    accommodationCostPeriod?: string;
    accommodationDeducted?: boolean;
    accommodationRegistration?: boolean;
    accommodationAfterContract?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const hasDetails =
    data.accommodationCost !== undefined ||
    data.accommodationCostPeriod !== undefined ||
    data.accommodationDeducted !== undefined ||
    data.accommodationRegistration !== undefined ||
    data.accommodationAfterContract !== undefined;
  if (hasDetails && data.accommodationKind !== 'provided') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accommodationKind'],
      message: 'job.error.accommodationDetailsProvidedOnly',
    });
  }
  if (data.accommodationCost !== undefined && data.accommodationCostPeriod === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accommodationCostPeriod'],
      message: 'job.error.accommodationCostPeriodRequired',
    });
  }
  if (data.accommodationCost === undefined && data.accommodationCostPeriod !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accommodationCost'],
      message: 'job.error.accommodationCostRequired',
    });
  }
}

export const step8Schema = step8Base.superRefine(refineJobCosts);

/**
 * Decyzja właściciela 28.09.2026: oferta PUBLICZNA z zakwaterowaniem zapewnionym musi podać
 * koszt (0 = bez kosztów) i informację, czy koszt jest potrącany z pensji. Szkic może być
 * niekompletny (`step8Schema`); tę regułę sprawdzają publikacja i edycja opublikowanej oferty
 * — w bazie strażnik `enforce_job_accommodation_terms` (0169) → `JOB_ACCOMMODATION_TERMS_REQUIRED`.
 */
export function refineAccommodationPublishTerms(
  data: { accommodationKind?: string; accommodationCost?: number; accommodationDeducted?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (data.accommodationKind !== 'provided') return;
  if (data.accommodationCost === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accommodationCost'],
      message: 'job.error.accommodationCostMandatory',
    });
  }
  if (data.accommodationDeducted === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accommodationDeducted'],
      message: 'job.error.accommodationDeductedRequired',
    });
  }
}

/** Krok 8 przy publikacji i edycji opublikowanej oferty (szkic: `step8Schema`). */
export const step8PublishSchema = step8Base
  .superRefine(refineJobCosts)
  .superRefine(refineAccommodationPublishTerms);

/**
 * Krok 9 — firma i publikacja. Szkic (`step9DraftSchema`) zapisuje opis firmy i kontakt BEZ
 * zgody na publikację (#193) — zgoda nie jest polem szkicu, tylko decyzją o publikacji, więc
 * wymaga jej wyłącznie `step9Schema` (ścieżka „Publikuj").
 */
const step9DraftBase = z.object({
  companyDescription: z
    .string({ required_error: 'job.error.companyDescriptionRequired' })
    .trim()
    .min(1, 'job.error.companyDescriptionRequired')
    .min(20, 'job.error.companyDescriptionTooShort')
    .max(3000, 'job.error.companyDescriptionTooLong'),
  contactEmail: z.string().trim().email('job.error.contactEmailInvalid').optional(),
  // #1129 (0172): kanał aplikowania u ogłoszeniodawcy — reguły 1:1 z CHECK-ami bazy
  // (`src/lib/job-apply-channel.ts`). W szkicu każdy opcjonalny; wymóg „co najmniej jeden”
  // sprawdza publikacja i edycja opublikowanej oferty (`refineApplyChannel`).
  applyUrl: z
    .string()
    .trim()
    .max(APPLY_URL_MAX_LENGTH, 'job.error.applyUrlInvalid')
    .refine(isApplyUrl, 'job.error.applyUrlInvalid')
    .optional(),
  applyEmail: z
    .string()
    .trim()
    .max(APPLY_EMAIL_MAX_LENGTH, 'job.error.applyEmailInvalid')
    .refine(isApplyEmail, 'job.error.applyEmailInvalid')
    .optional(),
  applyPhone: z
    .string()
    .transform(normalizeApplyPhone)
    .refine(isApplyPhone, 'job.error.applyPhoneInvalid')
    .optional(),
  agreePublish: z.boolean().optional(),
});
export const step9DraftSchema = step9DraftBase;

/**
 * Oferta PUBLICZNA musi wskazać co najmniej jeden kanał aplikowania (decyzja właściciela
 * 28.09.2026) — w bazie `publish_job`/`update_published_job` → `JOB_APPLY_CHANNEL_REQUIRED`.
 * Błąd przy pierwszym polu kanału (fokus i `aria-describedby` w kreatorze).
 */
export function refineApplyChannel(
  data: { applyUrl?: string; applyEmail?: string; applyPhone?: string },
  ctx: z.RefinementCtx,
): void {
  if (hasApplyChannel(data)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['applyUrl'],
    message: 'job.error.applyChannelRequired',
  });
}

/** Krok 9 w edycji opublikowanej oferty: bez zgody na publikację, z wymaganym kanałem. */
export const step9PublishedSchema = step9DraftBase.superRefine(refineApplyChannel);

const step9Base = step9DraftBase.extend({
  agreePublish: z.literal(true, {
    errorMap: () => ({ message: 'job.error.publishAgreementRequired' }),
  }),
});
export const step9Schema = step9Base.superRefine(refineApplyChannel);

/** Pełna oferta — złączenie wszystkich kroków + reguła zakresu wynagrodzenia. */
export const jobSchema = step1Base
  .merge(step2Base)
  .merge(step3Base)
  .merge(step4Base)
  .merge(step5Base)
  .merge(step6Base)
  .merge(step7Base)
  .merge(step8Base)
  .merge(step9Base)
  .refine(salaryRefine, {
    path: ['salaryMax'],
    message: 'job.error.salaryRangeInvalid',
  })
  .superRefine(refineNoLanguageConflict)
  .superRefine(refineJobCosts)
  .superRefine(refineAccommodationPublishTerms)
  .superRefine(refineApplyChannel);

export type JobStep1 = z.infer<typeof step1Schema>;
export type JobStep2 = z.infer<typeof step2Schema>;
export type JobStep3 = z.infer<typeof step3Schema>;
export type JobStep4 = z.infer<typeof step4Schema>;
export type JobStep5 = z.infer<typeof step5Schema>;
export type JobStep6 = z.infer<typeof step6Schema>;
export type JobStep7 = z.infer<typeof step7Schema>;
export type JobStep8 = z.infer<typeof step8Schema>;
export type JobStep9 = z.infer<typeof step9Schema>;
export type JobStep9Draft = z.infer<typeof step9DraftSchema>;
export type JobInput = z.infer<typeof jobSchema>;
