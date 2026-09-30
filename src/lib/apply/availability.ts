import type { AVAILABILITY_VALUES } from '@/lib/validation/candidate';

/**
 * Dostępność w formularzu aplikowania — stałe dla komponentów klienckich (#1055).
 *
 * Moduł bez Zoda i bez `libphonenumber-js`: `ApplyModal`/`GuestApplyForm` importują stąd opcje,
 * a schematy walidacji (`validation/application.ts`) zostają na serwerze. Wzór: `auth/next-path.ts`
 * (#390). Strażnik: `tests/unit/public-bundle-no-zod.test.ts`.
 */

/**
 * Dostępność w aplikacji: wartości profilu + „w ciągu 2 tygodni" (#190, enum 0074).
 * Profil kandydata zachowuje węższy zestaw (AVAILABILITY_VALUES).
 */
type AvailabilityValue = (typeof AVAILABILITY_VALUES)[number];
export const APPLICATION_AVAILABILITY_VALUES = [
  'immediate',
  'within_two_weeks',
  'within_month',
  'within_three_months',
  'flexible',
] as const satisfies readonly (AvailabilityValue | 'within_two_weeks')[];
export type ApplicationAvailability = (typeof APPLICATION_AVAILABILITY_VALUES)[number];

/** Opcje dostępności w formularzu aplikowania (ApplyModal). */
export const APPLY_AVAILABILITY_OPTIONS = ['immediate', 'twoWeeks', 'oneMonth', 'flexible'] as const;
export type ApplyAvailabilityOption = (typeof APPLY_AVAILABILITY_OPTIONS)[number];

/**
 * Opcja formularza → wartość enuma `availability_status` (0001, 0074). Każda widoczna
 * opcja zapisuje rozróżnialną wartość (#190).
 */
export const APPLY_AVAILABILITY_TO_DB: Record<ApplyAvailabilityOption, ApplicationAvailability> = {
  immediate: 'immediate',
  twoWeeks: 'within_two_weeks',
  oneMonth: 'within_month',
  flexible: 'flexible',
};
