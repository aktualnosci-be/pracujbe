import { isLocale, routing, type Locale } from '@/i18n/routing';
import { safeNextPath } from '@/lib/auth/next-path';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * Bramka dostępu do całego serwisu (tryb „w przygotowaniu”).
 *
 * Włączona, gdy ustawiono `SITE_ACCESS_PASSWORD` (tylko serwer, nigdy NEXT_PUBLIC_*).
 * Bez tej zmiennej serwis działa normalnie. Middleware zwraca stronę z formularzem hasła
 * (503 + noindex) dla każdej strony bez ważnego cookie; `POST /api/site-access` sprawdza
 * hasło i ustawia cookie. Cookie przechowuje HMAC hasła, nie samo hasło — zmiana hasła
 * w Railway unieważnia wszystkie wydane cookies.
 *
 * Kod działa w runtime edge (middleware) i node (route handler) — tylko Web Crypto.
 */

export const SITE_ACCESS_COOKIE = 'pb_site_access';
export const SITE_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;
/** Parametr zapytania, którym route handler sygnalizuje błędne hasło. */
export const SITE_ACCESS_DENIED_PARAM = 'pb_access';

const TOKEN_CONTEXT = 'pracujbe-site-access-v1';

type SiteAccessCopy = typeof pl.siteAccess;
const COPY: Record<Locale, SiteAccessCopy> = {
  pl: pl.siteAccess,
  nl: nl.siteAccess,
  fr: fr.siteAccess,
  en: en.siteAccess,
};

/** Hasło bramki albo undefined, gdy bramka jest wyłączona. */
export function getSiteAccessPassword(): string | undefined {
  const value = process.env.SITE_ACCESS_PASSWORD?.trim();
  return value ? value : undefined;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Wartość cookie dla danego hasła: HMAC-SHA256(klucz = hasło, kontekst stały). */
export async function siteAccessToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(TOKEN_CONTEXT)));
}

/** Porównanie w stałym czasie (dla równej długości). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hasSiteAccess(
  cookieValue: string | undefined,
  password: string,
): Promise<boolean> {
  if (!cookieValue) return false;
  return constantTimeEqual(cookieValue, await siteAccessToken(password));
}

/** Język strony bramki: prefiks ścieżki → Accept-Language → język domyślny. */
export function pickGateLocale(pathname: string, acceptLanguage: string | null): Locale {
  const first = pathname.split('/')[1];
  if (isLocale(first)) return first;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return routing.defaultLocale;
}

/** Bezpieczny cel powrotu po podaniu hasła (tylko ścieżki `/{locale}/…` z tej domeny). */
export function siteAccessReturnPath(next: string | null | undefined, locale: Locale): string {
  return safeNextPath(next ?? null) ?? `/${locale}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Samodzielna strona HTML bramki (bez layoutu aplikacji — middleware nie renderuje React).
 * Kolory odpowiadają tokenom marki z globals.css (biel, czerwień, czerń).
 */
export function renderSiteAccessPage(opts: {
  locale: Locale;
  next: string;
  error: boolean;
  /** Limit prób przekroczony (#584) — komunikat zamiast „nieprawidłowe hasło”. */
  rateLimited?: boolean;
}): string {
  const t = COPY[opts.locale];
  const next = escapeHtml(opts.next);
  const message = opts.rateLimited ? t.rateLimited : opts.error ? t.error : null;
  const error = message
    ? `<p id="pb-access-error" role="alert" style="margin:0 0 1rem;color:#B42318;font-weight:600">${escapeHtml(message)}</p>`
    : '';
  const describedBy = message ? ' aria-describedby="pb-access-error" aria-invalid="true"' : '';
  return (
    `<!doctype html><html lang="${opts.locale}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    `<title>${escapeHtml(t.pageTitle)}</title></head>` +
    '<body style="margin:0;background:#FFFFFF;color:#151515;font-family:DM Sans,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
    '<main style="box-sizing:border-box;max-width:28rem;margin:12vh auto;padding:0 16px">' +
    '<p style="margin:0 0 2rem;font-size:1.75rem;font-weight:800;letter-spacing:-0.02em" aria-label="Pracuj.be">' +
    'pracuj<span style="display:inline-block;margin-left:2px;padding:0 0.3em;border-radius:0.5em;background:#D92932;color:#FFFFFF">.be</span></p>' +
    `<h1 style="margin:0 0 0.75rem;font-size:1.5rem;line-height:1.25">${escapeHtml(t.title)}</h1>` +
    `<p style="margin:0 0 1.5rem;line-height:1.5;color:#3F3F46">${escapeHtml(t.lead)}</p>` +
    error +
    '<form method="post" action="/api/site-access">' +
    `<input type="hidden" name="next" value="${next}">` +
    `<input type="hidden" name="locale" value="${opts.locale}">` +
    `<label for="pb-access-password" style="display:block;margin:0 0 0.5rem;font-weight:600">${escapeHtml(t.passwordLabel)}</label>` +
    `<input id="pb-access-password" name="password" type="password" required autocomplete="current-password" autofocus${describedBy} ` +
    'style="box-sizing:border-box;width:100%;min-height:48px;padding:0 12px;border:1px solid #71717A;border-radius:12px;font-size:1rem">' +
    `<button type="submit" style="margin-top:1rem;width:100%;min-height:48px;border:0;border-radius:12px;background:#D92932;color:#FFFFFF;font-size:1rem;font-weight:700;cursor:pointer">${escapeHtml(t.submit)}</button>` +
    '</form></main></body></html>'
  );
}
