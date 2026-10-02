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

/**
 * Kategorie e-mail procesu rekrutacyjnego (#1145) — decyzja produktowa: portal ogłoszeniowy.
 * W trybie `CLASSIFIEDS_ONLY` formularz ich nie pokazuje, a zapis zachowuje wartości z bazy
 * (`updateNotificationPreferences` czyta je pod sesją) — nigdy nie nadpisuje ich po cichu.
 */
export const RECRUITMENT_EMAIL_FIELDS: ReadonlySet<ToggleField> = new Set([
  'emailApplications',
  'emailOffers',
  'emailMessages',
]);

/** Pola e-mail widoczne w formularzu dla roli i trybu (tryb przychodzi z serwera). */
export function emailFieldsFor(
  role: NotificationPreferencesRole,
  recruitmentEnabled: boolean,
): readonly ToggleField[] {
  return recruitmentEnabled ? EMAIL_FIELDS[role] : EMAIL_FIELDS[role].filter((f) => !RECRUITMENT_EMAIL_FIELDS.has(f));
}

/**
 * Pola z opisem z perspektywy pracodawcy (`employer<Field>Description`). `inAppEnabled` (#1120):
 * opis wymienia wiadomości serwisowe, których preferencja nie ukrywa
 * (`@/lib/notifications/service-messages`).
 */
const EMPLOYER_DESCRIPTION_FIELDS: ReadonlySet<ToggleField> = new Set([
  'emailApplications',
  'emailOffers',
  'emailMessages',
  'inAppEnabled',
]);

/** Klucz opisu pola w namespace `settings`. */
export function descriptionKey(field: ToggleField, role: NotificationPreferencesRole): string {
  if (role === 'employer' && EMPLOYER_DESCRIPTION_FIELDS.has(field)) {
    return `employer${field.charAt(0).toUpperCase()}${field.slice(1)}Description`;
  }
  return `${field}Description`;
}
