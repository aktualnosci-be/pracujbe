import { NextResponse } from 'next/server';

import { processEmailQueue } from '@/lib/email/outbox';

/**
 * Route handler przetwarzający kolejkę e-mail (outbox) — wywoływany przez cron/worker.
 * Chroniony sekretem `EMAIL_QUEUE_SECRET` (nagłówek `Authorization: Bearer <secret>`).
 * Nigdy nie jest indeksowany ani cache'owany.
 */

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.EMAIL_QUEUE_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await processEmailQueue();
  return NextResponse.json(result);
}
