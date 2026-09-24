import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { hasServiceRoleKey, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import {
  processStorageDeletions,
  railwayDeleter,
  supabaseDeleter,
  type ObjectDeleter,
} from '@/lib/storage-deletion';

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
 * #486: retencja danych (`run_retention_purge`, 0105) — okresy jako dane w `retention_policies`
 * (null = kategoria wyłączona), partie z limitem i SKIP LOCKED; potem kolejka usuwania obiektów
 * storage (`processStorageDeletions`) — także obiektów plików usuniętych w tym przebiegu.
 * Nieudane usunięcie obiektu to ponowienie w kolejnym przebiegu, nie błąd zadania.
 * #45: kampanie e-mail (`process_email_campaigns`, 0101) — rezerwacja „rewizja + odbiorca”
 * przed kolejkowaniem, zgoda sprawdzana teraz; restart crona nie tworzy drugiego listu.
 *
 * Chroniony `MAINTENANCE_SECRET` lub `CRON_SECRET` (`Authorization: Bearer`).
 * Wymaga service-role (RPC są service_role-only). Nie ujawnia technikaliów ani danych ofert —
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

/** Pliki CV leżą w prywatnym buckecie Railway (#26); bez jego konfiguracji — Supabase Storage. */
async function objectDeleter(admin: Parameters<typeof supabaseDeleter>[0]): Promise<ObjectDeleter> {
  const { fileBucketConfig } = await import('@/lib/env');
  const config = fileBucketConfig();
  if (!config) return supabaseDeleter(admin);
  const { createRailwayBucket } = await import('@/lib/storage/railway-bucket');
  return railwayDeleter(createRailwayBucket(config));
}

/** Same liczniki z `run_retention_purge` (liczby całkowite), bez innych pól. */
function retentionCounters(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => Number.isInteger(entry[1]),
    ),
  );
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
    const [discounts, checkouts, expiredJobs, guestRequests] = await Promise.all([
      admin.rpc('release_stale_discount_reservations', { p_older_than_hours: 24 }),
      admin.rpc('release_stale_checkout_intents', { p_older_than_minutes: 30 }),
      admin.rpc('expire_due_jobs'),
      admin.rpc('purge_guest_application_requests'),
    ]);
    // Po wygaszeniu ofert: alert nie może zgłosić oferty, która właśnie wygasła.
    const searchAlerts = expiredJobs.error
      ? { data: null, error: null }
      : await admin.rpc('process_saved_search_alerts', { p_limit: 500 });
    // #45: rezerwacja i kolejkowanie paczki odbiorców aktywnych rewizji kampanii (0101).
    const campaigns = await admin.rpc('process_email_campaigns', { p_limit: 500 });
    const retention = await admin.rpc('run_retention_purge', { p_limit: 200 });
    if (
      discounts.error ||
      checkouts.error ||
      expiredJobs.error ||
      guestRequests.error ||
      searchAlerts.error ||
      campaigns.error ||
      retention.error
    ) {
      const failed = discounts.error
        ? 'discounts'
        : checkouts.error
          ? 'checkouts'
          : expiredJobs.error
            ? 'jobExpiry'
            : guestRequests.error
              ? 'guestRequests'
              : searchAlerts.error
                ? 'savedSearchAlerts'
                : campaigns.error
                  ? 'emailCampaigns'
                  : 'retention';
      captureError(
        discounts.error ??
          checkouts.error ??
          expiredJobs.error ??
          guestRequests.error ??
          searchAlerts.error ??
          campaigns.error ??
          retention.error,
        {
        area: 'maintenance.gc',
        task: failed,
      });
      return NextResponse.json({ error: 'gc failed' }, { status: 503 });
    }
    let storage;
    try {
      storage = await processStorageDeletions(admin, await objectDeleter(admin));
    } catch (error) {
      captureError(error, { area: 'maintenance.gc', task: 'storageDeletions' });
      return NextResponse.json({ error: 'gc failed' }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      releasedDiscounts: discounts.data ?? 0,
      releasedCheckouts: checkouts.data ?? 0,
      expiredJobs: typeof expiredJobs.data === 'number' ? expiredJobs.data : 0,
      purgedGuestRequests: typeof guestRequests.data === 'number' ? guestRequests.data : 0,
      savedSearchDigests: typeof searchAlerts.data === 'number' ? searchAlerts.data : 0,
      campaignEmailsQueued: typeof campaigns.data === 'number' ? campaigns.data : 0,
      retention: retentionCounters(retention.data),
      storageDeletions: storage,
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
