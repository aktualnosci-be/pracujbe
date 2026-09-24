import type { NotificationPreferences } from '@/lib/data/notification-preferences';

/**
 * Pola e-mail formularza preferencji wg roli (#357) — wspólne dla formularza i wersji
 * treści zgody (#45, `consent-wording.ts`), żeby dowód zgody opisywał dokładnie to, co widać.
 */

export type ToggleField = keyof NotificationPreferences;

export type NotificationPreferencesRole = 'candidate' | 'employer';

/**
 * Pracodawca nie dostaje e-maili `jobMatch`, więc przełącznik dopasowanych ofert byłby
 * atrapą — ukrywamy go (wartość z bazy przechodzi bez zmian w `defaultValues`). Ta sama flaga
 * `email_offers` u pracodawcy steruje e-mailami `offerAccepted`/`offerDeclined` (0020) —
 * stąd osobne opisy z perspektywy pracodawcy.
 */
export const EMAIL_FIELDS: Record<NotificationPreferencesRole, readonly ToggleField[]> = {
  candidate: ['emailApplications', 'emailOffers', 'emailMessages', 'emailJobMatches', 'emailMarketing'],
  employer: ['emailApplications', 'emailOffers', 'emailMessages', 'emailMarketing'],
};

/** Pola z opisem z perspektywy pracodawcy (`employer<Field>Description`). */
const EMPLOYER_DESCRIPTION_FIELDS: ReadonlySet<ToggleField> = new Set([
  'emailApplications',
  'emailOffers',
  'emailMessages',
]);

/** Klucz opisu pola w namespace `settings`. */
export function descriptionKey(field: ToggleField, role: NotificationPreferencesRole): string {
  if (role === 'employer' && EMPLOYER_DESCRIPTION_FIELDS.has(field)) {
    return `employer${field.charAt(0).toUpperCase()}${field.slice(1)}Description`;
  }
  return `${field}Description`;
}
