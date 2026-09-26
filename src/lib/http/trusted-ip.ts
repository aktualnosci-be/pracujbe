import 'server-only';

/**
 * Zaufany adres IP klienta zza reverse proxy (utwardzenie #588/#602).
 *
 * Model zaufania: proces Node nie przyjmuje ruchu bezpośrednio z internetu — jedyna ścieżka
 * prowadzi przez brzeg Railway (domyślnie) albo przez Cloudflare przed Railway (jawnie
 * skonfigurowane). Zaufana warstwa proxy USTAWIA jeden konkretny nagłówek na podstawie
 * własnego, kontrolowanego połączenia TCP — klient nie ma jak go nadpisać.
 *
 * `X-Forwarded-For` celowo NIE jest tu źródłem: to nagłówek DOPISYWANY do łańcucha, który
 * klient wysyła jako pierwszy, więc bez jawnie skonfigurowanej liczby zaufanych hopów nie da
 * się bezpiecznie wskazać, który segment pochodzi od proxy, a który od żądającego. Zamiast
 * zgadywać — czytamy wyłącznie jeden, jawnie wskazany nagłówek; jego brak daje `null`
 * (receipt/log zostaje bez IP, zamiast przyjmować niezaufaną wartość).
 */

export type TrustedProxyHeaderName = 'x-real-ip' | 'cf-connecting-ip';

const KNOWN_HEADERS: ReadonlySet<string> = new Set(['x-real-ip', 'cf-connecting-ip']);

/** Nazwa zaufanego nagłówka proxy: `x-real-ip` (Railway, domyślnie) albo `cf-connecting-ip`
 * (Cloudflare proxying przed Railway) przez `TRUSTED_PROXY_HEADER`. Nieznana/pusta wartość
 * wraca do domyślnej — nie wyłącza odczytu IP przez literówkę w konfiguracji. */
export function trustedProxyHeaderName(): TrustedProxyHeaderName {
  const raw = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  return raw && KNOWN_HEADERS.has(raw) ? (raw as TrustedProxyHeaderName) : 'x-real-ip';
}

/** Górny limit długości — obrona w głąb (adres wraca do bazy jako `inet`/`text`), nie walidacja formatu. */
const MAX_IP_LENGTH = 64;

/**
 * Adres klienta z JEDYNEGO, jawnie skonfigurowanego, zaufanego nagłówka proxy. `null`, gdy
 * nagłówek jest pusty/nieustawiony — NIGDY nie sięgamy po `X-Forwarded-For` jako zastępstwo.
 */
export function trustedClientIp(headers: Headers): string | null {
  const value = headers.get(trustedProxyHeaderName())?.trim();
  if (!value || value.length > MAX_IP_LENGTH) return null;
  return value;
}
