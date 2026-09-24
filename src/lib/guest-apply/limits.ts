/**
 * Limity pól jednorazowej aplikacji gościa (#98) — wspólne dla formularza (klient, bez Zoda)
 * i walidacji serwera (`@/lib/validation/guest-application`). Wartości = CHECK-i z migracji 0095.
 */
export const GUEST_NAME_MAX = 160;
export const GUEST_EMAIL_MAX = 254;
/** Formularz pokazuje licznik jak ApplyModal; baza przyjmuje do 4000 znaków. */
export const GUEST_MESSAGE_MAX = 500;

/** Uproszczona kontrola adresu po stronie klienta (serwer waliduje Zodem i w bazie). */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= GUEST_EMAIL_MAX;
}
