import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { processAuthEmailQueue } from '@/lib/auth/email-worker';
import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — `/api/email/process`.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` lub `CRON_SECRET` (nagłówek `Authorization: Bearer`).
 *
 * P1-20: harmonogram prowadzi cron Railway (`scripts/railway-cron-call.mjs`, POST co 5 min,
 * `CRON_AUTH_SECRET` = `EMAIL_QUEUE_SECRET`; patrz `docs/RESEND_SETUP.md` §6). GET zostaje
 * dla ręcznych wywołań i zgodności. Nigdy nie jest indeksowany ani cache'owany.
 */

export const dynamic = 'force-dynamic';

/** Porównanie stałoczasowe (bez wycieku długości): najpierw bufory równej długości. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Autoryzacja: Bearer == EMAIL_QUEUE_SECRET (cron Railway / worker) LUB CRON_SECRET. */
function authorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header) return false;
  const secrets = [process.env.EMAIL_QUEUE_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  return secrets.some((s) => safeEqual(header, `Bearer ${s}`));
}

async function run(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // #24: wiadomości kont (potwierdzenie adresu, reset hasła) z kolejki auth PostgreSQL — ten sam cron.
  const [result, auth] = await Promise.all([processEmailQueue(), processAuthEmailQueue()]);
  // P1-17: realny problem workera (brak konfiguracji w produkcji, błąd claimu) → 503, aby
  // cron/monitoring NIE widział „zielonego" przebiegu, gdy żaden e-mail nie wychodzi.
  const ok = result.ok && auth.ok;
  return NextResponse.json({ ...result, ok, auth }, { status: ok ? 200 : 503 });
}

/** Ręczne wywołanie / zgodność (GET). */
export async function GET(request: Request): Promise<Response> {
  return run(request);
}

/** Cron Railway (POST). */
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
