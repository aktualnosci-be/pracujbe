/**
 * Polityki Cloudflare Turnstile dla formularzy publicznych (#46). Plik współdzielony przez
 * serwer i klienta — bez sekretów i bez importów serwerowych.
 *
 * Turnstile jest ochroną niezbędną (bezpieczeństwo formularzy), a nie trackingiem: widżet
 * ładuje się tylko na stronach z chronionym formularzem, nie zależy od zgód cookies
 * (Invariant #7 dotyczy analityki/marketingu) i nie ustawia naszych cookies.
 *
 * Każdy przepływ ma własną nazwę akcji (Cloudflare zwraca ją w siteverify — token z innego
 * formularza jest odrzucany) i własną decyzję na wypadek awarii dostawcy:
 * - `closed` — przy niedostępnym Cloudflare (timeout, błąd sieci, błąd dostawcy, brak
 *   konfiguracji w produkcji) formularz jest odrzucany kodem `BOT_CHECK_UNAVAILABLE`;
 * - `open` — przy awarii dostawcy żądanie przechodzi dalej (pozostają rate limit i ochrona
 *   Auth). Brak lub zły token jest zawsze odrzucany, niezależnie od polityki.
 *
 * Rate limit (`src/lib/rate-limit.ts`) pozostaje osobną, niezależną warstwą.
 */

/** Przepływy chronione Turnstile. Wartość = nazwa akcji w Cloudflare ([a-z0-9_-], ≤ 32). */
export const TURNSTILE_ACTIONS = {
  login: 'login',
  register: 'register',
  passwordReset: 'password_reset',
  contact: 'contact',
  report: 'report',
  guestApply: 'guest_apply',
} as const;

export type TurnstileFlow = keyof typeof TURNSTILE_ACTIONS;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[TurnstileFlow];

export type ProviderFailurePolicy = 'open' | 'closed';

/**
 * Zachowanie przy awarii dostawcy, per przepływ:
 * - login: `open` — awaria Cloudflare nie odcina istniejących kont od logowania; bruteforce
 *   ogranicza limiter `signin` (fail-safe) i Supabase Auth.
 * - register / password_reset: `closed` — masowe zakładanie kont i wysyłka e-maili resetu
 *   to główny cel botów; chwilowa niedostępność jest mniejszym kosztem.
 * - contact / report: `closed` — formularze bez konta (spam do moderacji). Obecnie nie ma
 *   publicznego formularza kontaktu ani zgłoszeń; polityka obowiązuje, gdy powstanie.
 *
 * - guest_apply: `closed` — aplikacja bez konta (#98) wysyła e-mail na podany adres.
 *
 * Aplikowanie z konta nie ma Turnstile: wymaga zalogowanego kandydata (logowanie
 * i rejestracja są chronione), limitu `apply` i idempotencji w bazie.
 */
export const TURNSTILE_PROVIDER_FAILURE: Record<TurnstileFlow, ProviderFailurePolicy> = {
  login: 'open',
  register: 'closed',
  passwordReset: 'closed',
  contact: 'closed',
  report: 'closed',
  guestApply: 'closed',
};

/** Publiczny klucz witryny (build-time, trafia do przeglądarki). Pusty = widżet wyłączony. */
export function turnstileSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}
