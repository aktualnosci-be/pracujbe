/**
 * Wiadomości serwisowe tylko w panelu (#1120, migracja 0221 — lustro
 * `public.notification_inapp_required`). Decyzje administratora bez odpowiednika e-mail:
 * preferencja „Powiadomienia w aplikacji” ich nie ukrywa, bo inaczej użytkownik nie dowie się
 * o nich żadnym kanałem. Wszystkie są typu `system` i trafiają do właścicieli/rekruterów firmy,
 * dlatego opis w ustawieniach pracodawcy (`settings.employerInAppEnabledDescription`) je wymienia.
 *
 * Test `notification-inapp-service.test.ts` porównuje listę z najnowszą definicją SQL.
 */
export const INAPP_REQUIRED_SYSTEM_KINDS = [
  'company_links',
  'company_description',
  'job_content_review',
] as const;

export type InAppRequiredSystemKind = (typeof INAPP_REQUIRED_SYSTEM_KINDS)[number];

/** Czy powiadomienie omija opt-out in-app (to samo co reguła w bazie). */
export function isInAppRequiredNotification(type: string, data: unknown): boolean {
  if (type !== 'system' || typeof data !== 'object' || data === null) return false;
  const kind = (data as Record<string, unknown>)['kind'];
  return typeof kind === 'string' && (INAPP_REQUIRED_SYSTEM_KINDS as readonly string[]).includes(kind);
}
