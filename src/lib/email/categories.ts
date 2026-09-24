/**
 * Kategorie preferencji e-mail (#45) — lustro `email_preference_category` z migracji 0087.
 *
 * Kategoria = kolumna `notification_preferences.email_<kategoria>`. Typ maila bez kategorii
 * (np. e-maile Auth, `jobPublished`) nie ma linku wypisania. Zgodność z SQL pilnuje test
 * `tests/unit/email-unsubscribe.test.ts`.
 */

export const EMAIL_PREFERENCE_CATEGORIES = [
  'applications',
  'offers',
  'messages',
  'job_matches',
  'marketing',
] as const;

export type EmailPreferenceCategory = (typeof EMAIL_PREFERENCE_CATEGORIES)[number];

export const EMAIL_TEMPLATE_CATEGORY: Readonly<Record<string, EmailPreferenceCategory>> = {
  newApplication: 'applications',
  statusChanged: 'applications',
  applicationViewed: 'applications',
  jobOffer: 'offers',
  offerAccepted: 'offers',
  offerDeclined: 'offers',
  newMessage: 'messages',
  jobMatch: 'job_matches',
  newsletter: 'marketing',
};

export function isEmailPreferenceCategory(value: unknown): value is EmailPreferenceCategory {
  return (
    typeof value === 'string' &&
    (EMAIL_PREFERENCE_CATEGORIES as readonly string[]).includes(value)
  );
}

export function emailPreferenceCategory(template: string): EmailPreferenceCategory | null {
  return Object.hasOwn(EMAIL_TEMPLATE_CATEGORY, template)
    ? EMAIL_TEMPLATE_CATEGORY[template]!
    : null;
}

/** Pule budżetu wysyłki — lustro `email_send_pool` z migracji 0087. */
export const EMAIL_AUTH_TEMPLATES = [
  'accountConfirmation',
  'passwordReset',
  'magicLink',
  'emailChange',
  'invite',
] as const;
export const EMAIL_MARKETING_TEMPLATES = ['newsletter', 'jobMatch'] as const;

export type EmailSendPool = 'auth' | 'transactional' | 'marketing';

export function emailSendPool(template: string): EmailSendPool {
  if ((EMAIL_AUTH_TEMPLATES as readonly string[]).includes(template)) return 'auth';
  if ((EMAIL_MARKETING_TEMPLATES as readonly string[]).includes(template)) return 'marketing';
  return 'transactional';
}
