import { NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron/auth';
import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — `/api/email/process`.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` (nagłówek `Authorization: Bearer`); przejściowo także
 * `CRON_SECRET` (`src/lib/cron/secrets.ts` — sekret maintenance nie otwiera tego zadania).
 *
 * P1-20: harmonogram prowadzi cron Railway (`scripts/railway-cron-call.mjs`, POST co 5 min,
 * `CRON_AUTH_SECRET` = `EMAIL_QUEUE_SECRET`; patrz `docs/RESEND_SETUP.md` §6). GET zostaje
 * dla ręcznych wywołań i zgodności. Nigdy nie jest indeksowany ani cache'owany.
 */

export const dynamic = 'force-dynamic';

async function run(request: Request): Promise<Response> {
  if (!isCronAuthorized(request, 'emailQueue')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await processEmailQueue();
  // P1-17: realny problem workera (brak konfiguracji w produkcji, błąd claimu) → 503, aby
  // cron/monitoring NIE widział „zielonego" przebiegu, gdy żaden e-mail nie wychodzi.
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

/** Ręczne wywołanie / zgodność (GET). */
export async function GET(request: Request): Promise<Response> {
  return run(request);
}

/** Cron Railway (POST). */
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
