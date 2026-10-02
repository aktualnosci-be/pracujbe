import { NextResponse } from 'next/server';

import { campaignSendingReady } from '@/lib/admin/campaigns';
import { dsaRetentionMode } from '@/lib/admin/dsa-retention-mode';
import { isCronAuthorized } from '@/lib/cron/auth';
import { revalidatePublicJobPaths } from '@/lib/jobs/public-cache';
import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc, type RpcArgs } from '@/lib/db/sql';
import { isProductionMode } from '@/lib/env';
import {
  mergeRetentionCounters,
  RETENTION_BATCH_LIMIT,
  RETENTION_MAX_BATCHES,
  retentionMode,
} from '@/lib/retention/mode';
import { captureError } from '@/lib/error-report';
import { TECHNICAL_GC_BATCH_LIMIT, TECHNICAL_GC_MAX_BATCHES } from '@/lib/maintenance/technical-gc';
import { runMatchRecompute, type MatchRecomputeRun } from '@/lib/matching/materialize';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { effectiveRecruitmentEnabled } from '@/lib/ops/portal-mode';
import { processCompanyViesAutoQueue, type ViesAutoQueueRun } from '@/lib/vies/auto-check';
import { processPushQueue, type PushQueueRun } from '@/lib/push/worker';
import { MESSAGE_ATTACHMENTS_BUCKET, runStorageGc, storageGcDryRun, type StorageGcRun } from '@/lib/storage-gc';
import {
  processStorageDeletions,
  railwayDeleter,
  unconfiguredDeleter,
  type ObjectDeleter,
} from '@/lib/storage-deletion';

/**
 * Zadania utrzymaniowe (P1-20) — wywoływane przez cron Railway (`scripts/railway-cron-call.mjs`,
 * POST co godzinę, `CRON_AUTH_SECRET` = `MAINTENANCE_SECRET`; patrz `docs/railway/README.md`).
 * #72: zmienia przeterminowane aktywne oferty na `expired` (`expire_due_jobs`, 0085; idempotentne).
 * #100: alerty zapisanych wyszukiwań (`process_saved_search_alerts`, 0092) — digest nowych
 * ofert per wyszukiwanie najwyżej raz na dobę/tydzień, bez ponownej wysyłki tej samej oferty;
 * e-maile trafiają do outboxa (`enqueue_email`), wysyła je `/api/email/process`.
 * #724: Web Push alertów (`processPushQueue`, za `WEB_PUSH_ENABLED`) i retencja kanału push
 * (`purge_push_data`, 0219) zaraz po digestach.
 * #98: retencja aplikacji bez konta (`purge_guest_application_requests`, 0095) — usuwa
 * niepotwierdzone zgłoszenia 7 dni po ostatnim linku i duplikaty 7 dni po potwierdzeniu (razem
 * z ich e-mailami) i zeruje tokeny przejęcia po wygaśnięciu 30-dniowego okna.
 * #486: retencja danych (`run_retention_purge`, 0105) — okresy jako dane w `retention_policies`
 * (null = kategoria wyłączona), partie z limitem i SKIP LOCKED; potem kolejka usuwania obiektów
 * storage (`processStorageDeletions`) — także obiektów plików usuniętych w tym przebiegu.
 * Nieudane usunięcie obiektu to ponowienie w kolejnym przebiegu, nie błąd zadania.
 * #574: okresy z opracowania 2026-09-25 (0127) — retencja domyślnie WYŁĄCZONA; włącza ją
 * `RETENTION_MODE=dry-run|apply` (`src/lib/retention/mode.ts`). `apply` woła kolejne partie,
 * dopóki któraś kategoria wyczerpuje limit (`fullBatches`), najwyżej RETENTION_MAX_BATCHES.
 * Kolejka usuwania obiektów działa niezależnie od trybu (usunięcie konta na wniosek).
 * 0119: załączniki wiadomości przygotowane, a niewysłane przez 24 h
 * (`purge_stale_message_attachments`) — wiersz files usunięty, obiekt trafia do kolejki storage.
 * #17: dzienny GC bucketu CV (`runStorageGc`, 0117) — obiekty bez wiersza `files` do kolejki
 * usuwania (tylko przy `STORAGE_GC_MODE=delete`; domyślnie dry-run z samymi licznikami),
 * wiersze bez obiektu tylko liczone. Bez bucketu Railway — pominięty (`storageGc: null`).
 * #833: analogiczny GC dla załączników wiadomości (`messageAttachmentsGc`, ten sam bucket
 * Railway, logiczny bucket `message-files`, wzorzec klucza `att-*`) — do #833 był pomijany
 * przez GC CV jako „obcy” i nigdy nie trafiał do kolejki usuwania, nawet po awarii uploadu.
 * #45: kampanie e-mail (`process_email_campaigns`, 0101) — rezerwacja „rewizja + odbiorca”
 * przed kolejkowaniem, zgoda sprawdzana teraz; restart crona nie tworzy drugiego listu.
 * #575: twarde terminy lejka ofert (`purge_job_funnel_data`, 0128) — receipts deduplikacji
 * najwyżej 48 h, sumy dzienne z bieżącego i 12 poprzednich miesięcy kalendarzowych.
 * #43: czyszczenie spraw DSA (`dsa_retention_run`, 0104) — domyślnie WYŁĄCZONE (terminy czekają
 * na decyzję właściciela, #40); `DSA_RETENTION_MODE=dry-run` = podgląd, `apply` = anonimizacja
 * (`src/lib/admin/dsa-retention-mode.ts`). Odpowiedź: tryb + liczniki przebiegu.
 * #609: porzucone rezerwacje budżetu AI (`ai_budget_release_stale_reservations`, 0134) —
 * rezerwacja starsza niż 60 minut wciąż w stanie `reserved` (proces padł między rezerwacją
 * a rozliczeniem) jest rozliczana jako `failed`/koszt 0; ślad audytowy zostaje, limit doby/
 * miesiąca wraca do użycia. Idempotentne (`FOR UPDATE SKIP LOCKED`, filtr po statusie).
 * P1-03: materializacja dopasowań (`runMatchRecompute`, 0147) — partia podmiotów z kolejki
 * `match_recompute_queue` (triggery ofert/profili/blokad/wieku), wynik `scoreMatch` zapisany
 * przez service_role; baza kwalifikuje każdą parę. Po wygaszeniu ofert (wygasła = bez wiersza).
 * Błąd pojedynczego podmiotu to ponowienie (licznik `failed`), nie błąd zadania.
 * #1131: w trybie ogłoszeniowym zadanie nie działa (`matches: "disabled"`, bez bazy).
 *
 * Wyłącznie `POST` (#581): `GET` jest metodą bezpieczną i zwraca `405` bez autoryzacji
 * ani żadnego efektu ubocznego — mutacje nie są dostępne przez bezpieczną metodę HTTP.
 * Chroniony `MAINTENANCE_SECRET` (`Authorization: Bearer`); przejściowo także `CRON_SECRET`
 * (`src/lib/cron/secrets.ts` — sekret e-mail nie otwiera tego zadania).
 * Wymaga puli service_role (`DATABASE_SERVICE_URL`; RPC są service_role-only). #25: każde
 * zadanie to OSOBNA, krótka transakcja `withServiceRole` — wynik jednego zadania jest
 * zatwierdzony niezależnie od błędu innego (jak dawniej osobne wywołania RPC), a zadania
 * idą po kolei (mała pula service). Nie ujawnia technikaliów ani danych ofert —
 * odpowiedź i log zawierają tylko liczniki; błąd któregokolwiek zadania → 503 (bez pozornego
 * sukcesu dla crona i monitoringu).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Pliki CV leżą w prywatnym buckecie Railway (#26). Brak jego konfiguracji to błąd każdego
 * wiersza kolejki (ponowienie z backoffem), a nie awaria całego przebiegu maintenance.
 */
async function objectDeleter(): Promise<ObjectDeleter> {
  const { fileBucketConfig } = await import('@/lib/env');
  const config = fileBucketConfig();
  if (!config) return unconfiguredDeleter;
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

/**
 * 0180: ostatni przebieg dla czujek (`ops_last_maintenance_run`, panel `/admin/operacje`).
 * Tylko czas, wynik i stała nazwa zadania z błędem. Awaria zapisu nie zmienia wyniku przebiegu
 * (baza sprzed 0180 = brak funkcji) — tylko kanał błędów.
 */
async function recordRun(durationMs: number, failedTask: string | null): Promise<void> {
  try {
    await withServiceRole((tx) =>
      rpc(tx, 'record_ops_job_run', {
        p_job: 'maintenance',
        p_ok: failedTask === null,
        p_duration_ms: Math.max(0, Math.round(durationMs)),
        p_failed_task: failedTask,
      }),
    );
  } catch (error) {
    captureError(error, { area: 'maintenance.record_run' });
  }
}

/**
 * Tryb efektywny dla zadań rekrutacyjnych (#1143): env `PORTAL_LEGAL_MODE=RECRUITMENT` (#1136)
 * ORAZ `recruitment_enabled()` w bazie (0171). Bez klucza env baza nie jest pytana.
 * Błąd odczytu bazy = tryb ogłoszeniowy (fail-closed) i zapamiętany błąd (503 dla monitoringu).
 */
async function recruitmentTasksEnabled(onError: (error: unknown) => void): Promise<boolean> {
  if (!isRecruitmentEnabled('matching')) return false;
  try {
    const db = await withServiceRole((tx) => rpc<boolean>(tx, 'recruitment_enabled'));
    return effectiveRecruitmentEnabled(true, db === true);
  } catch (error) {
    onError(error);
    return false;
  }
}

async function run(request: Request): Promise<Response> {
  if (!isCronAuthorized(request, 'maintenance')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isServiceDatabaseConfigured()) {
    // W produkcji brak puli service_role to realny problem (GC nie działa) → 503 dla monitoringu.
    if (isProductionMode()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });
    return NextResponse.json({ ok: true, skipped: true });
  }

  const startedAt = Date.now();
  type Task =
    | 'aiBudgetReservations'
    | 'jobExpiry'
    | 'portalMode'
    | 'matches'
    | 'guestRequests'
    | 'savedSearchAlerts'
    | 'pushDeliveries'
    | 'pushPurge'
    | 'emailCampaigns'
    | 'retention'
    | 'jobFunnel'
    | 'messageAttachments'
    | 'rateLimits'
    | 'webhookInbox'
    | 'storageGc'
    | 'messageAttachmentsGc'
    | 'dsaRetention'
    | 'storageDeletions'
    | 'viesAutoChecks';
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

  /** #746: partie GC tabel technicznych; błąd partii = błąd zadania (bez kolejnych partii). */
  async function batchedTask(name: Task, fn: string, args: RpcArgs): Promise<{ deleted: number; backlog: boolean } | null> {
    let deleted = 0;
    for (let batch = 0; batch < TECHNICAL_GC_MAX_BATCHES; batch += 1) {
      const n = await task(name, fn, { ...args, p_limit: TECHNICAL_GC_BATCH_LIMIT });
      if (n === null) return null;
      deleted += n;
      if (n < TECHNICAL_GC_BATCH_LIMIT) return { deleted, backlog: false };
    }
    return { deleted, backlog: true };
  }

  // #609: rezerwacje budżetu AI porzucone po awarii procesu (crash/restart między rezerwacją
  // i rozliczeniem) — GC po TTL, niezależnie od pozostałych zadań.
  const releasedAiBudgetReservations = await task(
    'aiBudgetReservations',
    'ai_budget_release_stale_reservations',
    { p_older_than_minutes: 60, p_limit: 200 },
  );
  const expiredJobs = await task('jobExpiry', 'expire_due_jobs');
  // #775: oferty wygaszone w tym przebiegu (`active` → `expired`) muszą natychmiast zniknąć
  // z publicznych stron cache'owanych przez ISR (szczegół, strona główna, landingi kategorii
  // i miasta) — inaczej mogłyby zostać widoczne razem z `JobPosting` jeszcze przez okno
  // rewalidacji (do 60 s). Bez zmienionych wierszy (0 albo błąd RPC) nic nie unieważniamy.
  if (typeof expiredJobs === 'number' && expiredJobs > 0) {
    revalidatePublicJobPaths();
  }
  // #1143: zadania procesu rekrutacyjnego tylko w trybie efektywnym RECRUITMENT (env ORAZ baza).
  // W trybie ogłoszeniowym nie wołamy ich wcale (baza i tak odrzuciłaby zapis — 503 bez sensu);
  // retencja i czyszczenie (gość, załączniki, storage) działają dalej.
  const recruitment = await recruitmentTasksEnabled((error) => failures.push({ task: 'portalMode', error }));
  // P1-03: po `expire_due_jobs` — oferty wygaszone w tym przebiegu tracą wiersze od razu.
  // #1131/#1143: tryb ogłoszeniowy (env albo baza) — bez przeliczeń (zero zapytań
  // `match_recompute_*`); `matches: "disabled"` + `recruitmentTasks.skipped` w odpowiedzi.
  let matches: MatchRecomputeRun | 'disabled' | null = null;
  if (!recruitment) {
    matches = 'disabled';
  } else {
    try {
      matches = await runMatchRecompute();
    } catch (error) {
      failures.push({ task: 'matches', error });
    }
  }
  const purgedGuestRequests = await task('guestRequests', 'purge_guest_application_requests');
  // Po wygaszeniu ofert: alert nie może zgłosić oferty, która właśnie wygasła.
  const savedSearchDigests =
    expiredJobs === null
      ? 0
      : await task('savedSearchAlerts', 'process_saved_search_alerts', { p_limit: 500 });
  // #724 (0219): Web Push alertów — zaraz po digestach (te same powiadomienia). Bez flagi
  // `WEB_PUSH_ENABLED` i kluczy VAPID worker nie pobiera kolejki (`skipped: disabled`).
  let push: PushQueueRun | null = null;
  try {
    push = await processPushQueue();
  } catch (error) {
    failures.push({ task: 'pushDeliveries', error });
  }
  // Retencja kanału push zawsze (także przy wyłączonej fladze): wysyłki > 7 dni, urządzenia
  // wycofane > 30 dni.
  const purgedPushData = await task('pushPurge', 'purge_push_data');
  // #45: rezerwacja i kolejkowanie paczki odbiorców aktywnych rewizji kampanii (0101).
  // Bez nadawcy marketingu i linku wypisania worker listu nie wyśle — nie rezerwujemy
  // odbiorców (rezerwacja jest jednorazowa na rewizję), kampania czeka na konfigurację.
  const campaignEmailsQueued = campaignSendingReady()
    ? await task('emailCampaigns', 'process_email_campaigns', { p_limit: 500 })
    : 0;
  // #486/#574: retencja jako dane (0105, 0127) — tylko za jawną flagą; `off` nie woła bazy.
  const retentionRunMode = retentionMode();
  let retention: { mode: typeof retentionRunMode; batches: number } & Record<string, number | string> = {
    mode: retentionRunMode,
    batches: 0,
  };
  if (retentionRunMode !== 'off') {
    const dryRun = retentionRunMode === 'dry-run';
    let counters: Record<string, number> = {};
    let batches = 0;
    try {
      // Każda partia = osobna transakcja; dry-run = jedna partia (dane się nie zmieniają).
      do {
        const batch = retentionCounters(
          await withServiceRole((tx) =>
            rpc(tx, 'run_retention_purge', { p_limit: RETENTION_BATCH_LIMIT, p_dry_run: dryRun }),
          ),
        );
        counters = mergeRetentionCounters(counters, batch);
        batches += 1;
      } while (!dryRun && (counters['fullBatches'] ?? 0) > 0 && batches < RETENTION_MAX_BATCHES);
    } catch (error) {
      failures.push({ task: 'retention', error });
    }
    retention = { ...counters, mode: retentionRunMode, batches };
  }
  // #575: lejek ofert — receipts ≤ 48 h, agregaty ≤ 13 miesięcy kalendarzowych (0128).
  let jobFunnel: Record<string, number> = {};
  try {
    jobFunnel = retentionCounters(
      await withServiceRole((tx) => rpc(tx, 'purge_job_funnel_data', { p_limit: 5000 })),
    );
  } catch (error) {
    failures.push({ task: 'jobFunnel', error });
  }
  // 0119: przygotowane, a niewysłane załączniki wiadomości (> 24 h) → kolejka storage niżej.
  const purgedMessageAttachments = await task('messageAttachments', 'purge_stale_message_attachments', {
    p_older_than_hours: 24,
  });
  // K2/#17 (0163): tabele techniczne — okna limitera starsze niż doba (dolna granica w bazie)
  // i rozstrzygnięte wpisy inboxu webhooków starsze niż 30 dni. Bez danych do decyzji o
  // retencji: e-maile (`email_deliveries_gc`) czekają na #574.
  // #746 (0224): w partiach — każda partia w osobnej, krótkiej transakcji (SKIP LOCKED w bazie),
  // pełna partia = zaległość → kolejna partia, najwyżej TECHNICAL_GC_MAX_BATCHES na przebieg
  // (reszta w następnym). #722: inbox liczony od zakończenia (`updated_at`), nie od odebrania.
  const purgedRateLimits = await batchedTask('rateLimits', 'rate_limit_gc', { p_older_than_seconds: 86_400 });
  const purgedWebhookInbox = await batchedTask('webhookInbox', 'processed_webhooks_gc', { p_older_than_days: 30 });
  // #17/#833: GC sierot bucketu Railway przed workerem kolejki — sieroty znikają w tym samym
  // przebiegu. Dwa niezależne, logiczne buckety (CV i załączniki wiadomości) na jednym fizycznym
  // buckecie: awaria jednego przebiegu nie blokuje drugiego (osobne try/catch, osobne zadanie).
  let storageGc: StorageGcRun | null = null;
  let messageAttachmentsGc: StorageGcRun | null = null;
  try {
    const { fileBucketConfig } = await import('@/lib/env');
    const config = fileBucketConfig();
    if (config) {
      const { createRailwayBucket } = await import('@/lib/storage/railway-bucket');
      const bucketStore = createRailwayBucket(config);
      storageGc = await runStorageGc(bucketStore, { dryRun: storageGcDryRun() });
      try {
        messageAttachmentsGc = await runStorageGc(bucketStore, {
          dryRun: storageGcDryRun(),
          bucket: MESSAGE_ATTACHMENTS_BUCKET,
          pattern: 'attachment',
        });
      } catch (error) {
        failures.push({ task: 'messageAttachmentsGc', error });
      }
    }
  } catch (error) {
    failures.push({ task: 'storageGc', error });
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
  // #706/#879 (0191): kolejka automatycznego sprawdzenia VIES — ponowienia po chwilowej
  // niedostępności usługi i numery dopisane po założeniu firmy. Status firmy bez zmian.
  let viesAutoChecks: ViesAutoQueueRun | null = null;
  try {
    viesAutoChecks = await processCompanyViesAutoQueue();
  } catch (error) {
    failures.push({ task: 'viesAutoChecks', error });
  }

  const [first] = failures;
  await recordRun(Date.now() - startedAt, first?.task ?? null);
  if (failures.length > 0) {
    // #1066: każde nieudane zadanie osobno; `task` dopina się do obszaru w `captureError`
    // (`maintenance.gc.retention`), więc operator odróżnia GC bucketu od retencji czy
    // wygaszania ofert, a deduplikacja (kod, obszar) nie zlewa ich w jeden wpis.
    for (const failure of failures) {
      captureError(failure.error, { area: 'maintenance.gc', task: failure.task });
    }
    return NextResponse.json({ error: 'gc failed' }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    releasedAiBudgetReservations: releasedAiBudgetReservations ?? 0,
    expiredJobs: expiredJobs ?? 0,
    matches,
    ...(recruitment ? {} : { recruitmentTasks: { skipped: 'classifieds_only' as const } }),
    purgedGuestRequests: purgedGuestRequests ?? 0,
    savedSearchDigests: savedSearchDigests ?? 0,
    push,
    purgedPushData: purgedPushData ?? 0,
    campaignEmailsQueued: campaignEmailsQueued ?? 0,
    retention,
    jobFunnel,
    purgedMessageAttachments: purgedMessageAttachments ?? 0,
    purgedRateLimits: purgedRateLimits?.deleted ?? 0,
    purgedWebhookInbox: purgedWebhookInbox?.deleted ?? 0,
    // #746: true = przebieg doszedł do limitu partii; reszta zaległości w następnym przebiegu.
    technicalGcBacklog: Boolean(purgedRateLimits?.backlog || purgedWebhookInbox?.backlog),
    storageGc,
    messageAttachmentsGc,
    dsaRetention,
    storageDeletions,
    viesAutoChecks,
  });
}

/**
 * GET jest metodą bezpieczną (RFC 9110 §9.2.1) i nie może uruchamiać zadań mutujących —
 * `405` bez autoryzacji, dostępu do bazy ani żadnego efektu ubocznego (#581).
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
export async function POST(request: Request): Promise<Response> {
  return run(request);
}
