/**
 * Warstwa dostępu do danych POWIADOMIEŃ in-app — Pracuj.be (Etap 6).
 *
 * Strategia (spójna z `@/lib/data/candidate`): gdy `isSupabaseConfigured()` — powiadomienia
 * czytane są POD SESJĄ użytkownika (`createServerClient`, RLS = właściciel powiadomienia,
 * `notifications.profile_id = auth.uid()`); bez env — 3 pozycje DEMO (build i UX działają
 * bez backendu).
 *
 * INVARIANT #1/#2: treść powiadomienia jest lokalizowana w APLIKACJI (nie trzymamy tekstu
 * w DB) — tytuł wyznaczamy z `type` przez klucze i18n (`notifications.item*`), a względny
 * czas przez `Intl.RelativeTimeFormat` w języku odbiorcy. Zwracamy ścieżki BEZ prefiksu
 * locale — prefiks dołoży `Link`/nawigacja z `@/i18n/navigation`.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do Sentry
 * i zwracamy osobny stan błędu, bez niepewnego licznika i linków.
 */

import { getTranslations } from 'next-intl/server';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
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

/** Tytuły powiadomień typu `system` rozróżniane po `entity_type` (#403). */
const SYSTEM_TITLE_KEY_BY_ENTITY: Record<string, string> = {
  company_invitation: 'itemTeamInvitation',
};

function titleKeyForType(type: string, entityType = ''): string {
  if (type === 'system' && SYSTEM_TITLE_KEY_BY_ENTITY[entityType]) {
    return SYSTEM_TITLE_KEY_BY_ENTITY[entityType]!;
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
 * nieprzeczytanych. Bez env → 3 pozycje DEMO (linki wg `demoRole`). Błąd → Sentry + stan błędu.
 */
export async function getNotifications(
  locale: string,
  demoRole: DemoRole = 'candidate',
): Promise<NotificationsResult> {
  const resolvedLocale = toLocale(locale);
  const t = await getTranslations({ locale: resolvedLocale, namespace: 'notifications' });

  if (!isSupabaseConfigured()) {
    return demoNotifications(t, resolvedLocale, demoRole);
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const userId = user?.id ?? null;
    if (!userId) return { status: 'ready', items: [], unread: 0 };

    const [profileRes, notifRes, unreadRes] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
      supabase
        .from('notifications')
        .select('id, type, entity_type, entity_id, read_at, created_at')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      // Licznik nieprzeczytanych osobnym zapytaniem count — NIE z pobranej listy (limit 20),
      // która zaniżałaby wynik przy >20 nieprzeczytanych.
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId)
        .is('read_at', null),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (notifRes.error) throw notifRes.error;
    if (unreadRes.error) throw unreadRes.error;

    const role = asStr(asRecord(profileRes.data)['role']);
    if (role !== 'candidate' && role !== 'employer') {
      throw new Error('Notification profile role unavailable');
    }
    if (!Array.isArray(notifRes.data) || unreadRes.count === null || unreadRes.count === undefined) {
      throw new Error('Notification read incomplete');
    }

    const items: NotificationView[] = asArr(notifRes.data).map((row) => {
      const r = asRecord(row);
      const type = asStr(r['type'], 'system');
      return {
        id: asStr(r['id']),
        title: t(titleKeyForType(type, asStr(r['entity_type']))),
        meta: formatRelativeTime(asStr(r['created_at']), resolvedLocale),
        unread: r['read_at'] == null,
        href: resolveHref(asStr(r['entity_type']), role, asStr(r['entity_id'])),
      };
    });

    return { status: 'ready', items, unread: unreadRes.count };
  } catch (error) {
    captureError(error, { area: 'notifications.getNotifications' });
    return { status: 'error' };
  }
}
