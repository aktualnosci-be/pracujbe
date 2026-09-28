/**
 * Szablony e-mail procesu rekrutacyjnego (#1145) — lustro `email_recruitment_template()`
 * z migracji 0175. Decyzja produktowa: portal ogłoszeniowy — w trybie `CLASSIFIEDS_ONLY`
 * kolejka wygasza te wiersze (`suppressed_feature_disabled`) przy claimie i tuż przed wysyłką,
 * także gdy trafiły do kolejki wcześniej. Zgodność listy z SQL pilnuje test
 * `tests/unit/classifieds-notifications.test.ts` (z kontrolą ujemną).
 */
export const RECRUITMENT_EMAIL_TEMPLATES = [
  'newApplication',
  'applicationViewed',
  'statusChanged',
  'jobOffer',
  'offerAccepted',
  'offerDeclined',
  'newMessage',
  'guestApplicationConfirm',
  'guestApplicationSent',
  'guestStatusChanged',
] as const;

export type RecruitmentEmailTemplate = (typeof RECRUITMENT_EMAIL_TEMPLATES)[number];

/** Przyczyna wygaszenia wiersza kolejki w trybie ogłoszeniowym (kolumna `error_message`). */
export const SUPPRESSED_FEATURE_DISABLED = 'suppressed_feature_disabled';

export function isRecruitmentEmailTemplate(template: string): template is RecruitmentEmailTemplate {
  return (RECRUITMENT_EMAIL_TEMPLATES as readonly string[]).includes(template);
}
