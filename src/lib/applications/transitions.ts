/**
 * Macierz przejść statusu aplikacji — lustro `transition_application` w DB
 * (`supabase/migrations/0040_state_and_role_hardening.sql`, `v_allowed`).
 *
 * Źródłem prawdy pozostaje baza (RPC odrzuca każde inne przejście). Ta kopia służy wyłącznie
 * UI: menu statusu pokazuje tylko opcje, które RPC przyjmie. Zgodność z SQL pilnuje test
 * `tests/unit/application-transitions.test.ts` (parsuje migrację). Zmiana macierzy w DB
 * wymaga aktualizacji tego pliku — inaczej test pada.
 */

export const APPLICATION_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['viewed', 'shortlisted', 'interview', 'offer_sent', 'rejected'],
  submitted: ['viewed', 'shortlisted', 'interview', 'offer_sent', 'rejected'],
  viewed: ['shortlisted', 'interview', 'offer_sent', 'rejected', 'hired'],
  shortlisted: ['interview', 'offer_sent', 'rejected', 'hired'],
  interview: ['shortlisted', 'offer_sent', 'rejected', 'hired'],
  offer_sent: ['hired', 'rejected'],
};

/**
 * Statusy, które pracodawca ustawia ręcznie z menu. `offer_sent` jest dozwolone w DB, ale
 * ustawia je wysyłka propozycji (`sendOffer`), nie samo menu.
 */
export const MENU_TARGET_STATUSES = ['viewed', 'shortlisted', 'interview', 'rejected', 'hired'] as const;
export type MenuTargetStatus = (typeof MENU_TARGET_STATUSES)[number];

/** Przejścia, które wymagają potwierdzenia (skutek trudny do cofnięcia — stan końcowy). */
export const CONFIRM_TARGET_STATUSES: readonly MenuTargetStatus[] = ['rejected', 'hired'];

/** Czy RPC przyjmie przejście `from → to`. */
export function canTransition(from: string, to: string): boolean {
  return (APPLICATION_TRANSITIONS[from] ?? []).includes(to);
}

/** Opcje menu dla bieżącego statusu (kolejność stała, jak w `MENU_TARGET_STATUSES`). */
export function menuTargetsFor(from: string): MenuTargetStatus[] {
  return MENU_TARGET_STATUSES.filter((to) => canTransition(from, to));
}
