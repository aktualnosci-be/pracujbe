import type { EmailType } from '@/emails/copy';

/**
 * Rejestr pokrycia szablonów e-mail zdarzeniami produktu (#295).
 *
 * Każdy typ z `EMAIL_TYPES` należy do dokładnie jednej grupy — pilnuje tego
 * `tests/unit/email-wiring.test.ts` (także kontrola ujemna: typ z `UNWIRED_EMAIL_TYPES`
 * nie może pojawić się w żadnym wywołaniu `enqueue_email`). Moduł to czyste dane.
 */

/** Kolejka `email_deliveries` — kolejkowane przez RPC w `supabase/migrations`. */
export const QUEUED_EMAIL_TYPES = [
  'newApplication', // apply_to_job
  'applicationViewed', // transition_application → viewed
  'statusChanged', // transition_application → pozostałe statusy
  'jobOffer', // send_offer
  'offerAccepted', // respond_to_offer
  'offerDeclined', // respond_to_offer
  'newMessage', // send_message
  'jobPublished', // publish_job
  'companyVerified', // admin_set_company_status → verified (0084)
  'companyRejected', // admin_set_company_status → rejected (0084)
  'companySuspended', // admin_set_company_status → suspended (0084)
  'teamInvitation', // invite_company_member (0086)
  'jobMatch', // process_saved_search_alerts (0092) — digest zapisanego wyszukiwania
  'reportReceived', // submit_content_report (0094) — enqueue_email_to_address
  'reportDecisionActioned', // admin_decide_report (0099) → ograniczenie treści — do zgłaszającego
  'reportDecisionNoAction', // admin_decide_report (0099) → brak działań — do zgłaszającego
  'moderationJobRemoved', // admin_decide_report (0099) → uzasadnienie dla właściciela firmy
  'moderationCompanySuspended', // admin_decide_report (0099) → uzasadnienie dla właściciela firmy
  'moderationRestored', // admin_restore_moderation (0099)
  'appealReceived', // submit_moderation_appeal / submit_report_appeal (0104) — do odwołującego się
  'appealUpheld', // admin_decide_appeal (0104) → decyzja utrzymana
  'appealReversed', // admin_decide_appeal (0104) → odwołanie uwzględnione
  'breachNotice', // admin_notify_breach_subjects (0105) — treść od administratora
] as const satisfies readonly EmailType[];

/**
 * Aplikacja bez konta (#98) — kolejkowane przez `enqueue_guest_email` (0095) na adres gościa
 * bez profilu; link z tokenem dokłada worker (`src/lib/email/guest-delivery.ts`).
 */
export const GUEST_EMAIL_TYPES = [
  'guestApplicationConfirm', // submit_guest_application
  'guestApplicationSent', // confirm_guest_application
] as const satisfies readonly EmailType[];

/** E-maile konta — wysyłane przez warstwę Auth (`src/lib/email/auth-email.ts`). */
export const AUTH_EMAIL_TYPES = [
  'accountConfirmation',
  'passwordReset',
  'magicLink',
  'emailChange',
  'invite',
] as const satisfies readonly EmailType[];

/**
 * Świadomie NIEUŻYWANE — w produkcie nie ma dziś zdarzenia, które by je wysyłało.
 * Szablony i tłumaczenia zostają pod planowane przepływy; nie udajemy wysyłki.
 * Podpięcie wymaga przeniesienia typu do właściwej grupy powyżej (test to wymusi).
 */
export const UNWIRED_EMAIL_TYPES = {
  welcome: 'Brak zdarzenia „konto potwierdzone” w nowej warstwie Auth (migracja Auth w toku).',
  contactInvitation: 'Brak funkcji zaproszenia kandydata z wyszukiwarki przez pracodawcę.',
  jobExpiring: 'Kreator nie ustawia jobs.expires_at i nie ma zadania wygaszania ofert.',
  payment: 'Płatności wyłączone w bezpłatnym MVP (#51).',
  invoice: 'Płatności wyłączone w bezpłatnym MVP (#51).',
  supportContact: 'Strona kontaktu nie ma formularza; brak zgłoszeń do obsłużenia.',
} as const satisfies Partial<Record<EmailType, string>>;
