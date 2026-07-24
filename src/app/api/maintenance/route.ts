import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { hasServiceRoleKey, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Zadania utrzymaniowe (P1-20) — wywoływane przez cron (harmonogram w `vercel.json`).
 * Zwalnia porzucone rezerwacje kodów rabatowych (`release_stale_discount_reservations`) oraz
 * otwarte, nieukończone checkouty (`release_stale_checkout_intents`) — inaczej limit kodu i
 * blokada „jeden otwarty checkout na firmę" utknęłyby po porzuceniu płatności.
 *
 * Chroniony `MAINTENANCE_SECRET` lub `CRON_SECRET` (Vercel Cron: GET + `Authorization: Bearer`).
 * Wymaga service-role (RPC są service_role-only). Nie ujawnia technikaliów.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (!header) return false;
  const secrets = [process.env.MAINTENANCE_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  return secrets.some((s) => safeEqual(header, `Bearer ${s}`));
}

async function run(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!hasServiceRoleKey()) {
    // W produkcji brak service-role to realny problem (GC nie działa) → 503 dla monitoringu.
    if (isProductionMode()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const [discounts, checkouts] = await Promise.all([
      admin.rpc('release_stale_discount_reservations', { p_older_than_hours: 24 }),
      admin.rpc('release_stale_checkout_intents', { p_older_than_minutes: 30 }),
    ]);
    if (discounts.error || checkouts.error) {
      captureError(discounts.error ?? checkouts.error, { area: 'maintenance.gc' });
      return NextResponse.json({ error: 'gc failed' }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      releasedDiscounts: discounts.data ?? 0,
      releasedCheckouts: checkouts.data ?? 0,
    });
  } catch (e) {
    captureError(e, { area: 'maintenance.gc' });
    return NextResponse.json({ error: 'gc failed' }, { status: 503 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
