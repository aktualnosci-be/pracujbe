import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — wywoływany przez cron/worker.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` lub `CRON_SECRET` (nagłówek `Authorization: Bearer`).
 *
 * P1-20: obsługuje GET (Vercel Cron wysyła GET z `Authorization: Bearer <CRON_SECRET>`) oraz POST
 * (ręczne/inne wywołania z `EMAIL_QUEUE_SECRET`). Harmonogram w `vercel.json` (co 5 min).
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

/** Autoryzacja: Bearer == EMAIL_QUEUE_SECRET (worker) LUB CRON_SECRET (Vercel Cron). */
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
  const result = await processEmailQueue();
  // P1-17: realny problem workera (brak konfiguracji w produkcji, błąd claimu) → 503, aby
  // cron/monitoring NIE widział „zielonego" przebiegu, gdy żaden e-mail nie wychodzi.
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

/** Vercel Cron (GET). */
export async function GET(request: Request): Promise<Response> {
  return run(request);
}

/** Ręczny worker / inne wywołania (POST). */
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
