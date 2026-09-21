import { z } from 'zod/v3';
import {
  categoryKeySchema,
  contractTypeSchema,
  candidateLanguageSchema,
} from '@/lib/validation/candidate';

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

const nonEmptyLine = z.string().trim().min(1);

/** Krok 1 — podstawy: tytuł, kategoria, zawód. */
const step1Base = z.object({
  title: z
    .string({ required_error: 'job.error.titleRequired' })
    .trim()
    .min(5, 'job.error.titleTooShort')
    .max(120, 'job.error.titleTooLong'),
  category: categoryKeySchema,
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
    .min(30, 'job.error.descriptionTooShort')
    .max(5000, 'job.error.descriptionTooLong'),
  responsibilities: z
    .array(nonEmptyLine)
    .min(1, 'job.error.responsibilitiesRequired')
    .max(20, 'job.error.responsibilitiesTooMany'),
});
export const step5Schema = step5Base;

/** Krok 6 — wymagania obowiązkowe. */
const step6Base = z.object({
  requirementsMandatory: z
    .array(nonEmptyLine)
    .min(1, 'job.error.requirementsMandatoryRequired')
    .max(20, 'job.error.requirementsTooMany'),
  mandatorySkills: z
    .array(nonEmptyLine)
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
    .array(nonEmptyLine)
    .max(20, 'job.error.requirementsTooMany')
    .default([]),
  skills: z.array(nonEmptyLine).max(30, 'job.error.skillsTooMany').default([]),
  languages: z
    .array(candidateLanguageSchema)
    .max(10, 'job.error.languagesTooMany')
    .default([]),
  requiredCertificates: z
    .array(nonEmptyLine)
    .max(20, 'job.error.certificatesTooMany')
    .default([]),
  requiresDrivingLicense: z.boolean().default(false),
  noLanguageRequired: z.boolean().default(false),
});
export const step7Schema = step7Base;

/** Krok 8 — warunki i benefity. */
const step8Base = z.object({
  conditions: z.array(nonEmptyLine).max(20, 'job.error.conditionsTooMany').default([]),
  benefits: z.array(nonEmptyLine).max(20, 'job.error.benefitsTooMany').default([]),
  accommodation: z.boolean().default(false),
  transport: z.boolean().default(false),
});
export const step8Schema = step8Base;

/** Krok 9 — firma i publikacja. */
const step9Base = z.object({
  companyDescription: z
    .string({ required_error: 'job.error.companyDescriptionRequired' })
    .trim()
    .min(20, 'job.error.companyDescriptionTooShort')
    .max(3000, 'job.error.companyDescriptionTooLong'),
  contactEmail: z.string().trim().email('job.error.contactEmailInvalid').optional(),
  agreePublish: z.literal(true, {
    errorMap: () => ({ message: 'job.error.publishAgreementRequired' }),
  }),
});
export const step9Schema = step9Base;

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
  });

export type JobStep1 = z.infer<typeof step1Schema>;
export type JobStep2 = z.infer<typeof step2Schema>;
export type JobStep3 = z.infer<typeof step3Schema>;
export type JobStep4 = z.infer<typeof step4Schema>;
export type JobStep5 = z.infer<typeof step5Schema>;
export type JobStep6 = z.infer<typeof step6Schema>;
export type JobStep7 = z.infer<typeof step7Schema>;
export type JobStep8 = z.infer<typeof step8Schema>;
export type JobStep9 = z.infer<typeof step9Schema>;
export type JobInput = z.infer<typeof jobSchema>;
