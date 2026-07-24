import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — wywoływany przez cron/worker.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` (nagłówek `Authorization: Bearer <secret>`).
 * Nigdy nie jest indeksowany ani cache'owany.
 */

export const dynamic = 'force-dynamic';

/** Porównanie stałoczasowe (bez wycieku długości): najpierw bufory równej długości. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function authorized(request: Request): boolean {
  const secret = process.env.EMAIL_QUEUE_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  if (!header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await processEmailQueue();
  // P1-17: realny problem workera (brak konfiguracji w produkcji, błąd claimu) → 503, aby
  // cron/monitoring NIE widział „zielonego" przebiegu, gdy żaden e-mail nie wychodzi.
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
