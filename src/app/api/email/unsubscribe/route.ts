import { NextResponse } from 'next/server';

import { isLocale, routing } from '@/i18n/routing';
import { applyUnsubscribe } from '@/lib/email/unsubscribe';
import { env } from '@/lib/env';

/**
 * Wypisanie jednym kliknięciem (RFC 8058) — `/api/email/unsubscribe?t=<token>&l=<locale>`.
 *
 * POST (klient poczty po kliknięciu „Wypisz", treść `List-Unsubscribe=One-Click`) zapisuje
 * wypisanie bez logowania; ponowienie daje ten sam wynik (idempotentne RPC). Upoważnieniem
 * jest wyłącznie podpisany token — treści żądania nie czytamy.
 *
 * GET NIGDY nie zmienia preferencji (skanery linków w poczcie wykonują GET): przekierowuje
 * na stronę potwierdzenia `/{locale}/wypisz`, gdzie zapis wymaga świadomego kliknięcia.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const outcome = await applyUnsubscribe(url.searchParams.get('t'), {
    source: 'one_click',
    locale: url.searchParams.get('l'),
  });
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
  const target = new URL(`/${locale}/wypisz`, env.siteUrl);
  const token = url.searchParams.get('t');
  if (token) target.hash = `t=${encodeURIComponent(token)}`;
  return NextResponse.redirect(target, { status: 303, headers: NO_STORE });
}
