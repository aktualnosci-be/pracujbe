/**
 * Warstwa dostępu do danych POWIADOMIEŃ in-app — Pracuj.be (Etap 6).
 *
 * Strategia (spójna z `@/lib/data/candidate`): gdy backend jest skonfigurowany
 * (`isPortalDataConfigured()`) — powiadomienia czytane są POD SESJĄ użytkownika
 * (`withPortalTransaction`, RLS = właściciel powiadomienia, `notifications.profile_id =
 * auth.uid()`); bez env — 3 pozycje DEMO (build i UX działają bez backendu).
 *
 * INVARIANT #1/#2: treść powiadomienia jest lokalizowana w APLIKACJI (nie trzymamy tekstu
 * w DB) — tytuł wyznaczamy z `type` przez klucze i18n (`notifications.item*`), a względny
 * czas przez `Intl.RelativeTimeFormat` w języku odbiorcy. Zwracamy ścieżki BEZ prefiksu
 * locale — prefiks dołoży `Link`/nawigacja z `@/i18n/navigation`.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do kanału błędów
 * i zwracamy osobny stan błędu, bez niepewnego licznika i linków.
 */

import { getTranslations } from 'next-intl/server';

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryCount, queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { createAppDateFormatter } from '@/lib/datetime';
import { routing, type Locale } from '@/i18n/routing';

/* ---------------------------------------------------------------------------
 * Kontrakt danych
 * ------------------------------------------------------------------------- */

export interface NotificationView {
  id: string;
  /** Zlokalizowany tytuł (wyznaczony z `type` przez klucze `notifications.item*`). */
  title: string;
  /** Względny czas w języku odbiorcy (np. „10 minut temu"). Dane, nie chrome UI. */
  meta: string;
  /** Nieprzeczytane — `read_at is null`. */
  unread: boolean;
  /** Ścieżka docelowa BEZ prefiksu locale (prefiks dołoży nawigacja). */
  href: string;
}

/* ---------------------------------------------------------------------------
 * Pomocnicze konwersje (bez `any`, wzorzec z @/lib/data/candidate)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

type NotificationsTranslator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Mapowanie `notification_type` → klucz i18n tytułu (namespace `notifications`).
 * Klucze muszą istnieć we WSZYSTKICH plikach `src/messages/*.json` (dodaje je agent UI).
 * Nieznany typ → `itemSystem` (bezpieczny fallback).
 */
const TITLE_KEY_BY_TYPE: Record<string, string> = {
  application_received: 'itemApplicationReceived',
  application_status_changed: 'itemApplicationStatusChanged',
  offer_received: 'itemOfferReceived',
  offer_status_changed: 'itemOfferStatusChanged',
  message_received: 'itemMessageReceived',
  job_match: 'itemJobMatch',
  company_verified: 'itemCompanyVerified',
  system: 'itemSystem',
};

/**
 * Decyzja admina o firmie (0084, #310): odrzucenie/zawieszenie przychodzi jako `system`
 * z `data.kind = 'company_status'` (enum `notification_type` bez zmian) — tytuł wg `data.status`.
 */
const COMPANY_STATUS_TITLE_KEY: Record<string, string> = {
  verified: 'itemCompanyVerified',
  rejected: 'itemCompanyRejected',
  suspended: 'itemCompanySuspended',
};

/** Decyzja admina o pytaniu screeningowym (0103, #497): `system` + `data.kind = 'screening_review'`. */
const SCREENING_REVIEW_TITLE_KEY: Record<string, string> = {
  approved: 'itemScreeningApproved',
  rejected: 'itemScreeningRejected',
  // #497 (0201): odrzucenie pytania opublikowanej oferty = ukrycie + prośba o poprawkę.
  hidden: 'itemScreeningHidden',
};

/**
 * Decyzja moderacyjna (0099, #42): `system` z `data.kind = 'moderation'` — tytuł wg
 * `data.decision` (wycofanie oferty, zawieszenie firmy, cofnięcie ograniczenia).
 */
const MODERATION_TITLE_KEY: Record<string, string> = {
  job_removed: 'itemModerationJobRemoved',
  company_suspended: 'itemModerationCompanySuspended',
  restored: 'itemModerationRestored',
  appeal_upheld: 'itemModerationAppealUpheld',
  appeal_reversed: 'itemModerationAppealReversed',
};

/** Tytuły powiadomień typu `system` rozróżniane po `entity_type` (#403). */
const SYSTEM_TITLE_KEY_BY_ENTITY: Record<string, string> = {
  company_invitation: 'itemTeamInvitation',
};

/** Tytuły wg `entity_type` niezależnie od typu powiadomienia (#100: alert wyszukiwania). */
const TITLE_KEY_BY_ENTITY: Record<string, string> = {
  saved_search: 'itemSavedSearch',
};

export function titleKeyForType(type: string, data?: unknown, entityType = ''): string {
  if (type === 'system' && SYSTEM_TITLE_KEY_BY_ENTITY[entityType]) {
    return SYSTEM_TITLE_KEY_BY_ENTITY[entityType]!;
  }
  if (TITLE_KEY_BY_ENTITY[entityType]) return TITLE_KEY_BY_ENTITY[entityType]!;
  const d = asRecord(data);
  if (d['kind'] === 'company_status') {
    const key = COMPANY_STATUS_TITLE_KEY[asStr(d['status'])];
    if (key) return key;
  }
  if (d['kind'] === 'screening_review') {
    const key = SCREENING_REVIEW_TITLE_KEY[asStr(d['status'])];
    if (key) return key;
  }
  if (d['kind'] === 'moderation') {
    const key = MODERATION_TITLE_KEY[asStr(d['decision'])];
    if (key) return key;
  }
  return TITLE_KEY_BY_TYPE[type] ?? TITLE_KEY_BY_TYPE['system']!;
}

/* Progi jednostek do względnego czasu. */
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Względny czas („10 minut temu" / „za chwilę") w języku odbiorcy. */
function formatRelativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = then - Date.now(); // ujemny dla przeszłości
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (abs < HOUR) return rtf.format(Math.round(diffMs / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
  if (abs < WEEK) return rtf.format(Math.round(diffMs / DAY), 'day');
  if (abs < MONTH) return rtf.format(Math.round(diffMs / WEEK), 'week');
  if (abs < YEAR) return rtf.format(Math.round(diffMs / MONTH), 'month');
  return rtf.format(Math.round(diffMs / YEAR), 'year');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Docelowa ścieżka powiadomienia wg `entity_type` i roli bieżącego użytkownika (#148).
 * Ścieżki BEZ prefiksu locale (dołoży go nawigacja). Cel wyznacza serwer z danych pod RLS —
 * strona docelowa i tak ponownie sprawdza dostęp, więc obcy/usunięty obiekt kończy się
 * bezpiecznym stanem tej strony (lista roli), nigdy cudzymi danymi. `entity_id` trafia do
 * URL tylko jako zweryfikowany UUID (rozmowa → `?c=`); nieznany typ → pulpit roli.
 */
export function resolveHref(entityType: string, role: string, entityId = ''): string {
  const employer = role === 'employer';
  switch (entityType) {
    case 'conversation': {
      const path = employer ? '/employer/wiadomosci' : '/candidate/wiadomosci';
      return UUID_RE.test(entityId) ? `${path}?c=${entityId.toLowerCase()}` : path;
    }
    case 'application':
      return employer ? '/employer/aplikacje' : '/candidate/aplikacje';
    case 'offer':
      // Kandydat: lista propozycji; pracodawca: odpowiedź na propozycję dotyczy zgłoszenia.
      return employer ? '/employer/aplikacje' : '/candidate/propozycje';
    case 'job':
      return employer ? '/employer/oferty' : '/candidate/oferty-polecane';
    case 'company':
      return employer ? '/employer/firma' : '/candidate';
    case 'saved_search':
      // #100: nowe oferty dla zapisanego wyszukiwania — zarządzanie i otwarcie listy.
      return employer ? '/employer' : '/candidate/wyszukiwania';
    case 'company_invitation':
      // #403: zaproszenie do zespołu — przyjęcie/odrzucenie na stronie zespołu.
      return employer ? '/employer/zespol' : '/candidate';
    default:
      return employer ? '/employer' : '/candidate';
  }
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez bazy) — 3 pozycje jak dotychczasowe `sample*`
 * ------------------------------------------------------------------------- */

interface DemoNotificationSeed {
  id: string;
  type: string;
  entityType: string;
  minutesAgo: number;
  unread: boolean;
}

const DEMO_SEEDS: readonly DemoNotificationSeed[] = [
  { id: 'demo-notif-0', type: 'job_match', entityType: 'job', minutesAgo: 10, unread: true },
  { id: 'demo-notif-1', type: 'application_status_changed', entityType: 'application', minutesAgo: 180, unread: true },
  { id: 'demo-notif-2', type: 'message_received', entityType: 'conversation', minutesAgo: 1440, unread: false },
];

/** Panel, dla którego budujemy powiadomienia DEMO (bez sesji rola nie wynika z profilu). */
export type DemoRole = 'candidate' | 'employer';

export type NotificationsResult =
  | { status: 'ready'; items: NotificationView[]; unread: number }
  | { status: 'error' };

function demoNotifications(
  t: NotificationsTranslator,
  locale: Locale,
  role: DemoRole,
): NotificationsResult {
  const now = Date.now();
  const items: NotificationView[] = DEMO_SEEDS.map((seed) => ({
    id: seed.id,
    title: t(titleKeyForType(seed.type)),
    meta: formatRelativeTime(new Date(now - seed.minutesAgo * MINUTE).toISOString(), locale),
    unread: seed.unread,
    // Brak sesji/roli: kontekst demo = panel, który renderuje dzwonek.
    href: resolveHref(seed.entityType, role),
  }));
  return { status: 'ready', items, unread: items.filter((item) => item.unread).length };
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/**
 * Ostatnie powiadomienia bieżącego użytkownika (created_at desc, limit 20) + licznik
 * nieprzeczytanych. Bez env → 3 pozycje DEMO (linki wg `demoRole`). Błąd → kanał błędów + stan błędu.
 */
export async function getNotifications(
  locale: string,
  demoRole: DemoRole = 'candidate',
): Promise<NotificationsResult> {
  const resolvedLocale = toLocale(locale);
  const t = await getTranslations({ locale: resolvedLocale, namespace: 'notifications' });

  if (!isPortalDataConfigured()) {
    return demoNotifications(t, resolvedLocale, demoRole);
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'ready', items: [], unread: 0 };
    const role = me.role;
    if (role !== 'candidate' && role !== 'employer') {
      throw new Error('Notification profile role unavailable');
    }

    const { rows, unread } = await withPortalTransaction(me, async (tx) => ({
      // notifications_select_own (RLS): wyłącznie powiadomienia właściciela sesji.
      rows: await queryRows(tx, 'notifications.latest',
        `SELECT id, type, data, entity_type, entity_id, read_at, created_at
           FROM public.notifications
          WHERE profile_id = $1
          ORDER BY created_at DESC
          LIMIT 20`, [me.id]),
      // Licznik nieprzeczytanych osobnym zapytaniem count — NIE z pobranej listy (limit 20),
      // która zaniżałaby wynik przy >20 nieprzeczytanych.
      unread: await queryCount(tx, 'notifications.unread',
        'SELECT 1 FROM public.notifications WHERE profile_id = $1 AND read_at IS NULL', [me.id]),
    }));

    const items: NotificationView[] = asArr(rows).map((row) => {
      const r = asRecord(row);
      const type = asStr(r['type'], 'system');
      return {
        id: asStr(r['id']),
        title: t(titleKeyForType(type, r['data'], asStr(r['entity_type']))),
        meta: formatRelativeTime(asStr(r['created_at']), resolvedLocale),
        unread: r['read_at'] == null,
        href: resolveHref(asStr(r['entity_type']), role, asStr(r['entity_id'])),
      };
    });

    return { status: 'ready', items, unread };
  } catch (error) {
    captureError(error, { area: 'notifications.getNotifications' });
    return { status: 'error' };
  }
}

/* ---------------------------------------------------------------------------
 * Pełna lista powiadomień (#148): `/candidate/powiadomienia`, `/employer/powiadomienia`
 * ------------------------------------------------------------------------- */

export const NOTIFICATION_PAGE_SIZE = 20;

/** Filtr z URL listy: tylko dokładne `?nieprzeczytane=1` włącza widok nieprzeczytanych. */
export function parseUnreadFilter(value: string | string[] | undefined): boolean {
  return value === '1';
}

/** Kursor strony: `created_at` + UUID ostatniej pozycji (stabilny przy równym czasie). */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export interface NotificationListItem extends NotificationView {
  /** Czas utworzenia (ISO) — kursor i atrybut `dateTime`. */
  createdAt: string;
  /** Data i godzina w Europe/Brussels w języku odbiorcy (obok czasu względnego). */
  dateLabel: string;
}

export interface NotificationsPage {
  items: NotificationListItem[];
  nextCursor: NotificationCursor | null;
  /** Wszystkie nieprzeczytane (osobny count, niezależny od strony i filtra). */
  unread: number;
}

export type NotificationsPageResult =
  | { status: 'ready'; page: NotificationsPage }
  | { status: 'error' };

export interface NotificationsPageOptions {
  /** Tylko nieprzeczytane (`read_at is null`). */
  unreadOnly?: boolean;
  cursor?: NotificationCursor | null;
  /** Panel dla danych DEMO (bez sesji). */
  demoRole?: DemoRole;
}

/**
 * Strona powiadomień bieżącego użytkownika (created_at desc, id desc; po 20). Odczyt pod
 * sesją/RLS (`notifications_select_own`) — to samo źródło tytułów i celów (`resolveHref`) co
 * dropdown. Kursor = porównanie krotek, walidowany Zodem w Server Action. Bez env → pozycje
 * DEMO (bez kolejnych stron). Błąd → kanał błędów + stan błędu (Invariant #8).
 */
export async function getNotificationsPage(
  locale: string,
  { unreadOnly = false, cursor = null, demoRole = 'candidate' }: NotificationsPageOptions = {},
): Promise<NotificationsPageResult> {
  const resolvedLocale = toLocale(locale);
  const t = await getTranslations({ locale: resolvedLocale, namespace: 'notifications' });
  const formatDate = createAppDateFormatter(resolvedLocale, { withTime: true, fallback: '' });

  if (!isPortalDataConfigured()) {
    if (cursor) return { status: 'ready', page: { items: [], nextCursor: null, unread: 0 } };
    const now = Date.now();
    const all = DEMO_SEEDS.map((seed): NotificationListItem => {
      const createdAt = new Date(now - seed.minutesAgo * MINUTE).toISOString();
      return {
        id: seed.id,
        title: t(titleKeyForType(seed.type)),
        meta: formatRelativeTime(createdAt, resolvedLocale),
        unread: seed.unread,
        href: resolveHref(seed.entityType, demoRole),
        createdAt,
        dateLabel: formatDate(createdAt),
      };
    });
    return {
      status: 'ready',
      page: {
        items: unreadOnly ? all.filter((item) => item.unread) : all,
        nextCursor: null,
        unread: all.filter((item) => item.unread).length,
      },
    };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'ready', page: { items: [], nextCursor: null, unread: 0 } };
    const role = me.role;
    if (role !== 'candidate' && role !== 'employer') {
      throw new Error('Notification profile role unavailable');
    }

    const { rows, unread } = await withPortalTransaction(me, async (tx) => ({
      rows: await queryRows(tx, 'notifications.page',
        `SELECT id, type, data, entity_type, entity_id, read_at, created_at
           FROM public.notifications
          WHERE profile_id = $1
            AND ($2::boolean = false OR read_at IS NULL)
            AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT $5`,
        [me.id, unreadOnly, cursor?.createdAt ?? null, cursor?.id ?? null, NOTIFICATION_PAGE_SIZE + 1]),
      unread: await queryCount(tx, 'notifications.unread',
        'SELECT 1 FROM public.notifications WHERE profile_id = $1 AND read_at IS NULL', [me.id]),
    }));

    const visible = asArr(rows).slice(0, NOTIFICATION_PAGE_SIZE);
    const items = visible.map((row): NotificationListItem => {
      const r = asRecord(row);
      const type = asStr(r['type'], 'system');
      const createdAt = asStr(r['created_at']);
      return {
        id: asStr(r['id']),
        title: t(titleKeyForType(type, r['data'], asStr(r['entity_type']))),
        meta: formatRelativeTime(createdAt, resolvedLocale),
        unread: r['read_at'] == null,
        href: resolveHref(asStr(r['entity_type']), role, asStr(r['entity_id'])),
        createdAt,
        dateLabel: formatDate(createdAt),
      };
    });
    const last = items[items.length - 1];
    const nextCursor = rows.length > NOTIFICATION_PAGE_SIZE && last
      ? { createdAt: last.createdAt, id: last.id }
      : null;
    return { status: 'ready', page: { items, nextCursor, unread } };
  } catch (error) {
    captureError(error, { area: 'notifications.getNotificationsPage' });
    return { status: 'error' };
  }
}
