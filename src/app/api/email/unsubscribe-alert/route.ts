import { NextResponse } from 'next/server';

import { isLocale, routing } from '@/i18n/routing';
import { applyAlertOff } from '@/lib/email/saved-search-alert-off';
import { env } from '@/lib/env';

/**
 * Wyłączenie JEDNEGO alertu zapisanego wyszukiwania jednym kliknięciem (RFC 8058) —
 * `/api/email/unsubscribe-alert?t=<token>&l=<locale>`, nagłówek `List-Unsubscribe` digestu
 * `jobMatch` (#100). Inne alerty i kategoria `job_matches` zostają bez zmian.
 *
 * POST (klient poczty, treść `List-Unsubscribe=One-Click`) woła `saved_search_alert_unsubscribe`
 * (tylko service_role, idempotentne); upoważnieniem jest wyłącznie podpisany token alertu —
 * treści żądania nie czytamy. GET NIGDY nic nie zmienia (skanery linków): 303 na stronę
 * potwierdzenia `/{locale}/wypisz-alert`, token we fragmencie.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const outcome = await applyAlertOff(url.searchParams.get('t'));
  const status = {
    done: 200,
    invalid: 400,
    expired: 400,
    unavailable: 503,
    error: 500,
  }[outcome.status];
  return NextResponse.json({ status: outcome.status }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get('l');
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;
  const target = new URL(`/${locale}/wypisz-alert`, env.siteUrl);
  const token = url.searchParams.get('t');
  if (token) target.hash = `t=${encodeURIComponent(token)}`;
  return NextResponse.redirect(target, { status: 303, headers: NO_STORE });
}
