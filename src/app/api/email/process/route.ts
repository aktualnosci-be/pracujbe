import { NextResponse } from 'next/server';

import { processAuthEmailQueue } from '@/lib/auth/email-worker';
import { isCronAuthorized } from '@/lib/cron/auth';
import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — `/api/email/process`.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` (nagłówek `Authorization: Bearer`); przejściowo także
 * `CRON_SECRET` (`src/lib/cron/secrets.ts` — sekret maintenance nie otwiera tego zadania).
 *
 * P1-20: harmonogram prowadzi cron Railway (`scripts/railway-cron-call.mjs`, POST co 5 min,
 * `CRON_AUTH_SECRET` = `EMAIL_QUEUE_SECRET`; patrz `docs/RESEND_SETUP.md` §6). Nigdy nie jest
 * indeksowany ani cache'owany.
 *
 * Wyłącznie `POST` (#583): `GET` jest metodą bezpieczną (RFC 9110 §9.2.1) i zwraca `405`
 * bez autoryzacji, bez dostępu do bazy i bez wysyłki — worker nie rusza. Ręczne uruchomienie
 * to jawne `POST` z tym samym sekretem.
 */

export const dynamic = 'force-dynamic';

async function run(request: Request): Promise<Response> {
  if (!isCronAuthorized(request, 'emailQueue')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // #24: wiadomości kont (potwierdzenie adresu, reset hasła) z kolejki auth PostgreSQL — ten sam cron.
  const [result, auth] = await Promise.all([processEmailQueue(), processAuthEmailQueue()]);
  // P1-17: realny problem workera (brak konfiguracji w produkcji, błąd claimu) → 503, aby
  // cron/monitoring NIE widział „zielonego" przebiegu, gdy żaden e-mail nie wychodzi.
  const ok = result.ok && auth.ok;
  return NextResponse.json({ ...result, ok, auth }, { status: ok ? 200 : 503 });
}

/** GET jest bezpieczne — 405 bez autoryzacji ani dostępu do kolejki. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });
}

/** Cron Railway (POST). */
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
