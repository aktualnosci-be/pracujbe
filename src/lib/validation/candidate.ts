import { z } from 'zod';
import type { CategoryKey, ContractType } from '@/lib/jobs';

/**
 * Walidacja profilu kandydata oraz sześciu kroków onboardingu.
 *
 * Model dopasowany do MatchCandidate (@/lib/matching/score): occupations, categories, skills,
 * city/region/radiusKm, experienceYears, availability, languages, certificates,
 * hasDrivingLicense/hasCar, preferredContractTypes.
 *
 * Każdy krok ma osobny schemat (step1Schema..step6Schema) do walidacji częściowej.
 * candidateProfileSchema to złączenie wszystkich kroków (pełny profil).
 *
 * Komunikaty błędów to klucze i18n.
 */

export const CATEGORY_KEYS = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
] as const satisfies readonly CategoryKey[];

export const CONTRACT_TYPES = [
  'permanent',
  'temporary',
  'interim',
  'freelance',
  'internship',
  'seasonal',
] as const satisfies readonly ContractType[];

export const AVAILABILITY_VALUES = [
  'immediate',
  'within_month',
  'within_three_months',
  'flexible',
] as const;

export const LANGUAGE_LEVELS = ['basic', 'intermediate', 'fluent', 'native'] as const;

export const categoryKeySchema = z.enum(CATEGORY_KEYS);
export const contractTypeSchema = z.enum(CONTRACT_TYPES);
export const availabilitySchema = z.enum(AVAILABILITY_VALUES);

export const candidateLanguageSchema = z.object({
  language: z
    .string({ required_error: 'candidate.error.languageRequired' })
    .trim()
    .min(2, 'candidate.error.languageInvalid')
    .max(40, 'candidate.error.languageInvalid'),
  level: z.enum(LANGUAGE_LEVELS),
});

/** Krok 1 — kim jesteś: dane podstawowe. */
export const step1Schema = z.object({
  firstName: z
    .string({ required_error: 'candidate.error.firstNameRequired' })
    .trim()
    .min(2, 'candidate.error.firstNameTooShort')
    .max(80, 'candidate.error.firstNameTooLong'),
  lastName: z
    .string({ required_error: 'candidate.error.lastNameRequired' })
    .trim()
    .min(2, 'candidate.error.lastNameTooShort')
    .max(80, 'candidate.error.lastNameTooLong'),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s().-]{6,20}$/, 'candidate.error.phoneInvalid')
    .optional()
    .or(z.literal('')),
});

/** Krok 2 — czego szukasz: zawody i kategorie. */
export const step2Schema = z.object({
  occupations: z
    .array(z.string().trim().min(1))
    .min(1, 'candidate.error.occupationsRequired')
    .max(10, 'candidate.error.occupationsTooMany'),
  categories: z
    .array(categoryKeySchema)
    .min(1, 'candidate.error.categoriesRequired')
    .max(10, 'candidate.error.categoriesTooMany'),
});

/** Krok 3 — umiejętności i doświadczenie. */
export const step3Schema = z.object({
  skills: z
    .array(z.string().trim().min(1))
    .max(50, 'candidate.error.skillsTooMany')
    .default([]),
  experienceYears: z
    .number({ invalid_type_error: 'candidate.error.experienceInvalid' })
    .int('candidate.error.experienceInvalid')
    .min(0, 'candidate.error.experienceInvalid')
    .max(60, 'candidate.error.experienceInvalid'),
});

/** Krok 4 — lokalizacja i mobilność. */
export const step4Schema = z.object({
  city: z
    .string({ required_error: 'candidate.error.cityRequired' })
    .trim()
    .min(2, 'candidate.error.cityRequired')
    .max(80, 'candidate.error.cityTooLong'),
  region: z.string().trim().max(80, 'candidate.error.regionTooLong').optional(),
  radiusKm: z
    .number({ invalid_type_error: 'candidate.error.radiusInvalid' })
    .int('candidate.error.radiusInvalid')
    .min(0, 'candidate.error.radiusInvalid')
    .max(300, 'candidate.error.radiusInvalid')
    .default(25),
  hasDrivingLicense: z.boolean().default(false),
  hasCar: z.boolean().default(false),
});

/** Krok 5 — języki i certyfikaty. */
export const step5Schema = z.object({
  languages: z
    .array(candidateLanguageSchema)
    .max(15, 'candidate.error.languagesTooMany')
    .default([]),
  certificates: z
    .array(z.string().trim().min(1))
    .max(30, 'candidate.error.certificatesTooMany')
    .default([]),
});

/** Krok 6 — preferencje i zgody. */
export const step6Schema = z.object({
  availability: availabilitySchema,
  preferredContractTypes: z
    .array(contractTypeSchema)
    .max(6, 'candidate.error.contractTypesTooMany')
    .default([]),
  expectedSalaryMin: z
    .number({ invalid_type_error: 'candidate.error.salaryInvalid' })
    .int('candidate.error.salaryInvalid')
    .min(0, 'candidate.error.salaryInvalid')
    .max(1000000, 'candidate.error.salaryInvalid')
    .optional(),
  bio: z.string().trim().max(2000, 'candidate.error.bioTooLong').optional(),
  agreeTerms: z.literal(true, {
    errorMap: () => ({ message: 'candidate.error.termsRequired' }),
  }),
});

/** Pełny profil kandydata — złączenie wszystkich kroków. */
export const candidateProfileSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema)
  .merge(step5Schema)
  .merge(step6Schema);

export type CandidateStep1 = z.infer<typeof step1Schema>;
export type CandidateStep2 = z.infer<typeof step2Schema>;
export type CandidateStep3 = z.infer<typeof step3Schema>;
export type CandidateStep4 = z.infer<typeof step4Schema>;
export type CandidateStep5 = z.infer<typeof step5Schema>;
export type CandidateStep6 = z.infer<typeof step6Schema>;
export type CandidateLanguage = z.infer<typeof candidateLanguageSchema>;
export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
