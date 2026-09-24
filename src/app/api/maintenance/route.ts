import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc, type RpcArgs } from '@/lib/db/sql';
import { isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Zadania utrzymaniowe (P1-20) — wywoływane przez cron Railway (`scripts/railway-cron-call.mjs`,
 * POST co godzinę, `CRON_AUTH_SECRET` = `MAINTENANCE_SECRET`; patrz `docs/railway/README.md`).
 * Zwalnia porzucone rezerwacje kodów rabatowych (`release_stale_discount_reservations`) oraz
 * otwarte, nieukończone checkouty (`release_stale_checkout_intents`) — inaczej limit kodu i
 * blokada „jeden otwarty checkout na firmę" utknęłyby po porzuceniu płatności. #72: zmienia
 * przeterminowane aktywne oferty na `expired` (`expire_due_jobs`, 0085; idempotentne).
 * #100: alerty zapisanych wyszukiwań (`process_saved_search_alerts`, 0092) — digest nowych
 * ofert per wyszukiwanie najwyżej raz na dobę/tydzień, bez ponownej wysyłki tej samej oferty;
 * e-maile trafiają do outboxa (`enqueue_email`), wysyła je `/api/email/process`.
 * #98: retencja aplikacji bez konta (`purge_guest_application_requests`, 0095) — usuwa
 * niepotwierdzone zgłoszenia 7 dni po ostatnim linku i duplikaty 7 dni po potwierdzeniu (razem
 * z ich e-mailami) i zeruje tokeny przejęcia po wygaśnięciu 30-dniowego okna.
 * #45: kampanie e-mail (`process_email_campaigns`, 0101) — rezerwacja „rewizja + odbiorca”
 * przed kolejkowaniem, zgoda sprawdzana teraz; restart crona nie tworzy drugiego listu.
 *
 * Chroniony `MAINTENANCE_SECRET` lub `CRON_SECRET` (`Authorization: Bearer`).
 * Wymaga puli service_role (`DATABASE_SERVICE_URL`; RPC są service_role-only). #25: każde
 * zadanie to OSOBNA, krótka transakcja `withServiceRole` — wynik jednego zadania jest
 * zatwierdzony niezależnie od błędu innego (jak dawniej osobne wywołania RPC), a zadania
 * idą po kolei (mała pula service). Nie ujawnia technikaliów ani danych ofert —
 * odpowiedź i log zawierają tylko liczniki; błąd któregokolwiek zadania → 503 (bez pozornego
 * sukcesu dla crona i monitoringu).
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
  if (!isServiceDatabaseConfigured()) {
    // W produkcji brak puli service_role to realny problem (GC nie działa) → 503 dla monitoringu.
    if (isProductionMode()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });
    return NextResponse.json({ ok: true, skipped: true });
  }

  type Task =
    | 'discounts'
    | 'checkouts'
    | 'jobExpiry'
    | 'guestRequests'
    | 'savedSearchAlerts'
    | 'emailCampaigns';
  const failures: Array<{ task: Task; error: unknown }> = [];

  /** Jedno zadanie = jedna transakcja; `null` = błąd (zapamiętany), kolejne zadania idą dalej. */
  async function task(name: Task, fn: string, args: RpcArgs = {}): Promise<number | null> {
    try {
      const value = await withServiceRole((tx) => rpc<number>(tx, fn, args));
      return typeof value === 'number' ? value : 0;
    } catch (error) {
      failures.push({ task: name, error });
      return null;
    }
  }

  const releasedDiscounts = await task('discounts', 'release_stale_discount_reservations', {
    p_older_than_hours: 24,
  });
  const releasedCheckouts = await task('checkouts', 'release_stale_checkout_intents', {
    p_older_than_minutes: 30,
  });
  const expiredJobs = await task('jobExpiry', 'expire_due_jobs');
  const purgedGuestRequests = await task('guestRequests', 'purge_guest_application_requests');
  // Po wygaszeniu ofert: alert nie może zgłosić oferty, która właśnie wygasła.
  const savedSearchDigests =
    expiredJobs === null
      ? 0
      : await task('savedSearchAlerts', 'process_saved_search_alerts', { p_limit: 500 });
  // #45: rezerwacja i kolejkowanie paczki odbiorców aktywnych rewizji kampanii (0101).
  const campaignEmailsQueued = await task('emailCampaigns', 'process_email_campaigns', {
    p_limit: 500,
  });

  const [first] = failures;
  if (first) {
    captureError(first.error, { area: 'maintenance.gc', task: first.task });
    return NextResponse.json({ error: 'gc failed' }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    releasedDiscounts: releasedDiscounts ?? 0,
    releasedCheckouts: releasedCheckouts ?? 0,
    expiredJobs: expiredJobs ?? 0,
    purgedGuestRequests: purgedGuestRequests ?? 0,
    savedSearchDigests: savedSearchDigests ?? 0,
    campaignEmailsQueued: campaignEmailsQueued ?? 0,
  });
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
