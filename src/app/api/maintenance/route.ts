import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { dsaRetentionMode } from '@/lib/admin/dsa-retention-mode';
import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc, type RpcArgs } from '@/lib/db/sql';
import { isProductionMode } from '@/lib/env';
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
 * #43: czyszczenie spraw DSA (`dsa_retention_run`, 0104) — domyślnie WYŁĄCZONE (terminy czekają
 * na decyzję właściciela, #40); `DSA_RETENTION_MODE=dry-run` = podgląd, `apply` = anonimizacja
 * (`src/lib/admin/dsa-retention-mode.ts`). Odpowiedź: tryb + liczniki przebiegu.
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

/**
 * Pliki CV leżą w prywatnym buckecie Railway (#26); bez jego konfiguracji — Supabase Storage
 * (przejściowo, klient Storage tworzony tylko w tej gałęzi; usunięcie SDK = #27).
 */
async function objectDeleter(): Promise<ObjectDeleter> {
  const { fileBucketConfig } = await import('@/lib/env');
  const config = fileBucketConfig();
  if (!config) {
    // Klient Storage dopiero przy pierwszym obiekcie w kolejce: brak jego konfiguracji to błąd
    // tego wiersza (ponowienie z backoffem), a nie awaria całego przebiegu maintenance.
    let deleter: ObjectDeleter | undefined;
    return async (bucket, path) => {
      if (!deleter) {
        const { createAdminClient } = await import('@/lib/supabase/admin');
        deleter = supabaseDeleter(createAdminClient());
      }
      return deleter(bucket, path);
    };
  }
  const { createRailwayBucket } = await import('@/lib/storage/railway-bucket');
  return railwayDeleter(createRailwayBucket(config));
}

/** Same liczniki z `run_retention_purge`/`dsa_retention_run` (liczby całkowite), bez innych pól. */
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
    | 'emailCampaigns'
    | 'retention'
    | 'dsaRetention'
    | 'storageDeletions';
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
  // #486: retencja jako dane (0105) — zwraca liczniki per kategoria (jsonb).
  let retention: Record<string, number> = {};
  try {
    retention = retentionCounters(
      await withServiceRole((tx) => rpc(tx, 'run_retention_purge', { p_limit: 200 })),
    );
  } catch (error) {
    failures.push({ task: 'retention', error });
  }
  // #43: sprawy DSA — tylko za jawną flagą; `off` nie woła bazy.
  const dsaMode = dsaRetentionMode();
  let dsaRetention: { mode: typeof dsaMode } & Record<string, number | string> = { mode: dsaMode };
  if (dsaMode !== 'off') {
    try {
      const summary = await withServiceRole((tx) =>
        rpc(tx, 'dsa_retention_run', { p_dry_run: dsaMode === 'dry-run' }),
      );
      dsaRetention = { ...retentionCounters(summary), mode: dsaMode };
    } catch (error) {
      failures.push({ task: 'dsaRetention', error });
    }
  }
  // Po retencji: kolejka usuwania obiektów storage (także plików usuniętych w tym przebiegu).
  let storageDeletions: Awaited<ReturnType<typeof processStorageDeletions>> | null = null;
  try {
    storageDeletions = await processStorageDeletions(await objectDeleter());
  } catch (error) {
    failures.push({ task: 'storageDeletions', error });
  }

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
    retention,
    dsaRetention,
    storageDeletions,
  });
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
