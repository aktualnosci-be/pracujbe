/** Ten sam próg oceny obowiązuje na pulpicie i stronie profilu. */
export function getProfileLevelTitle(completionPct: number, goodLevel: string): string | undefined {
  return completionPct >= 60 ? goodLevel : undefined;
}

/**
 * Sekcje kompletności profilu = kroki kreatora onboardingu (1–6), w tej samej kolejności.
 * Jedno źródło dla pulpitu, strony profilu i linków „Dodaj" (#315): każda pozycja da się
 * spełnić w kreatorze, więc kandydat, który go wypełnił, ma 100%. Zdjęcia i wykształcenia
 * kreator nie zbiera, więc nie są liczone.
 */
export const PROFILE_SECTIONS = [
  'basicInfo',
  'preferences',
  'experience',
  'location',
  'languages',
  'availability',
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type ProfileChecklistState = Record<ProfileSection, boolean>;

/** Numer kroku kreatora, który uzupełnia sekcję. */
export function profileSectionStep(section: ProfileSection): number {
  return PROFILE_SECTIONS.indexOf(section) + 1;
}

export interface ProfileCompletenessInput {
  firstName: string | null;
  lastName: string | null;
  occupationsCount: number;
  categoriesCount: number;
  experienceYears: unknown;
  city: string | null;
  languagesCount: number;
  certificatesCount: number;
  availability: string | null;
}

const filled = (value: string | null): boolean => Boolean(value && value.trim());

/** Kryteria jak w kreatorze (`OnboardingWizard`, stan ukończenia kroków). */
export function computeProfileChecklist(input: ProfileCompletenessInput): ProfileChecklistState {
  return {
    basicInfo: filled(input.firstName) && filled(input.lastName),
    preferences: input.occupationsCount > 0 && input.categoriesCount > 0,
    experience: typeof input.experienceYears === 'number',
    location: filled(input.city),
    languages: input.languagesCount > 0 || input.certificatesCount > 0,
    availability: filled(input.availability),
  };
}

export function completionPctOf(checklist: ProfileChecklistState): number {
  const done = PROFILE_SECTIONS.filter((section) => checklist[section]).length;
  return Math.round((done / PROFILE_SECTIONS.length) * 100);
}

export const EMPTY_PROFILE_CHECKLIST: ProfileChecklistState = {
  basicInfo: false,
  preferences: false,
  experience: false,
  location: false,
  languages: false,
  availability: false,
};
