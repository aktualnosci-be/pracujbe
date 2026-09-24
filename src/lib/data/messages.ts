/**
 * Warstwa dostępu do danych KOMUNIKACJI (Etap 6) — Pracuj.be.
 *
 * Strategia (spójna z `@/lib/data/candidate`): gdy `isSupabaseConfigured()` — dane czytane są
 * POD SESJĄ użytkownika (`createServerClient`, RLS wg `auth.uid()`, NIE service-role); bez env —
 * te same struktury wypełnione danymi DEMO (build i UX działają bez backendu).
 *
 * Widoczność stron konwersacji wynika z RLS:
 * - `profiles`: właściciel + kandydat powiązany relacją z firmą (pracodawca widzi kandydata,
 *   kandydat NIE widzi profilu pracodawcy) — dlatego nazwę drugiej strony ustalamy z `profiles`,
 *   a przy braku dostępu (perspektywa kandydata) spadamy na nazwę firmy (`companies`, publiczne
 *   tylko dla zweryfikowanych).
 * - `conversations`/`conversation_members`/`messages`: wyłącznie uczestnik konwersacji.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do Sentry,
 * a wyniki listy i wątku odróżniają awarię od prawdziwego braku danych.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { routing, type Locale } from '@/i18n/routing';
import { demoCompanies, resolveDemoJobs } from '@/lib/data/demo';

/* ---------------------------------------------------------------------------
 * Kontrakt danych komunikacji
 * ------------------------------------------------------------------------- */

export interface ConversationListItem {
  id: string;
  subject: string;
  /** Nazwa drugiej strony (imię+nazwisko lub nazwa firmy). Pusty = brak dostępu → UI: fallback. */
  counterpartyName: string;
  /** Treść ostatniej wiadomości (skrót). */
  lastPreview: string;
  /** Czas ostatniej wiadomości (ISO). Formatowanie do wyświetlenia robi ekran (locale). */
  lastMessageAt: string;
  unread: boolean;
  unreadCount: number;
}

export interface ThreadMessage {
  id: string;
  body: string;
  /** Czas wysłania (ISO). Formatowanie robi ekran (locale). */
  createdAt: string;
  /** Czy wiadomość wysłał bieżący użytkownik. */
  mine: boolean;
  /**
   * Nazwa nadawcy. Profil niewidoczny pod RLS (kandydat nie widzi rekrutera — decyzja z 0023)
   * → nazwa firmy rozmowy, gdy nadawca jest po stronie firmy; pusty = nic nierozwiązywalne
   * → UI: neutralna etykieta wg `senderSide` (#355). Imienia rekrutera nigdy nie ujawniamy.
   */
  senderName: string;
  /** Strona nadawcy: firma (rekruter/zespół) albo kandydat — wybór etykiety zastępczej w UI. */
  senderSide: 'company' | 'candidate';
  isSystem: boolean;
}

/** Stabilny kursor stronicowania wątku: najstarsza widoczna wiadomość (`created_at`, `id`). */
export interface ThreadCursor {
  createdAt: string;
  id: string;
}

/** Liczba wiadomości na stronę wątku (pierwsza strona = najnowsze, kolejne = starsze). */
export const THREAD_PAGE_SIZE = 50;

export interface ConversationThread {
  id: string;
  subject: string;
  counterpartyName: string;
  /** NAJNOWSZE `THREAD_PAGE_SIZE` wiadomości w kolejności chronologicznej (najstarsza pierwsza). */
  messages: ThreadMessage[];
  /** Kursor do doładowania starszych; `null` = to już początek rozmowy. */
  olderCursor: ThreadCursor | null;
}

export type ConversationThreadResult =
  | { status: 'ready'; thread: ConversationThread }
  | { status: 'not-found' }
  | { status: 'error' };

/** Starsza strona wątku (chronologicznie) albo jawny brak dostępu / awaria — nigdy „koniec historii". */
export type OlderMessagesResult =
  | { status: 'ready'; messages: ThreadMessage[]; olderCursor: ThreadCursor | null }
  | { status: 'not-found' }
  | { status: 'error' };

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

/** Zwraca zalogowanego użytkownika (albo null), a awarii Auth nie maskuje jako braku sesji. */
async function getAuthUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user?.id ?? null;
}

/** Składa „imię nazwisko" z rekordu profilu (pusty string, gdy brak). */
function fullName(record: Record<string, unknown>): string {
  return `${asStr(record['first_name'])} ${asStr(record['last_name'])}`.trim();
}

/** Mapa profile_id → „imię nazwisko" (tylko profile widoczne pod RLS). */
async function fetchProfileNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', ids);
  if (error) throw error;

  for (const row of asArr(data)) {
    const r = asRecord(row);
    const id = asStr(r['id']);
    const name = fullName(r);
    if (id && name) map.set(id, name);
  }
  return map;
}

/** Mapa company_id → nazwa (tylko firmy widoczne pod RLS: zweryfikowane / własne). */
async function fetchCompanyNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase.from('companies').select('id, name').in('id', ids);
  if (error) throw error;

  for (const row of asArr(data)) {
    const r = asRecord(row);
    const id = asStr(r['id']);
    const name = asStr(r['name']);
    if (id && name) map.set(id, name);
  }
  return map;
}

/**
 * Ustala nazwę drugiej strony: pierwszy rozwiązywalny (widoczny pod RLS) uczestnik ≠ ja,
 * a przy braku — nazwa firmy konwersacji. Zwraca '' gdy nic nierozwiązywalne.
 */
function resolveCounterparty(
  otherProfileIds: string[],
  companyId: string,
  nameByProfile: Map<string, string>,
  companyNameById: Map<string, string>,
): string {
  for (const pid of otherProfileIds) {
    const name = nameByProfile.get(pid);
    if (name) return name;
  }
  return companyId ? (companyNameById.get(companyId) ?? '') : '';
}

/**
 * Jedna strona wiadomości wątku OD NAJNOWSZYCH (#146). Sortowanie `(created_at, id)` malejąco
 * jest stabilne także dla wiadomości o identycznym `created_at`; kursor wskazuje najstarszy
 * zwrócony wiersz, więc kolejna strona nie ma luk ani duplikatów, a wiadomość dopisana między
 * pobraniami (nowsza od kursora) nie przesuwa starszych stron. Pobieramy `limit + 1`, aby bez
 * osobnego `count` wiedzieć, czy istnieją starsze. Zwraca wiersze CHRONOLOGICZNIE.
 * Odczyt pod sesją — RLS `messages` ogranicza wynik do uczestnika rozmowy.
 */
async function fetchMessagePage(
  supabase: SupabaseClient,
  conversationId: string,
  cursor: ThreadCursor | null,
): Promise<{ rows: unknown[]; olderCursor: ThreadCursor | null }> {
  let query = supabase
    .from('messages')
    .select('id, body, sender_id, is_system, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (cursor) {
    // PostgREST wymaga cudzysłowu dla wartości ISO 8601 (dwukropki, kropka). Kursor z Server
    // Action jest sprawdzany przez Zod (ISO datetime + UUID) przed trafieniem tutaj.
    const timestamp = `"${cursor.createdAt}"`;
    query = query.or(
      `created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query.limit(THREAD_PAGE_SIZE + 1);
  if (error) throw error;

  const rows = asArr(data);
  const visible = rows.slice(0, THREAD_PAGE_SIZE);
  const oldest = asRecord(visible[visible.length - 1]);
  const olderCursor =
    rows.length > THREAD_PAGE_SIZE
      ? { createdAt: asStr(oldest['created_at']), id: asStr(oldest['id']) }
      : null;
  return { rows: visible.reverse(), olderCursor };
}

/**
 * Kontekst nadawców wątku (#355): nazwy z profili widocznych pod RLS, nazwa firmy rozmowy
 * i zbiór nadawców będących członkami tej firmy (RLS `company_members`: członek widzi zespół,
 * kandydat tylko własne wiersze — więc dla kandydata zbiór jest pusty).
 */
interface SenderContext {
  nameByProfile: Map<string, string>;
  companyName: string;
  teamIds: Set<string>;
  /** Bieżący użytkownik jest członkiem firmy rozmowy (perspektywa pracodawcy). */
  viewerIsCompany: boolean;
}

/** Członkowie firmy rozmowy spośród `profileIds` (widoczni tylko dla członków tej firmy). */
async function fetchCompanyMemberIds(
  supabase: SupabaseClient,
  companyId: string,
  profileIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!companyId || profileIds.length === 0) return ids;
  const { data, error } = await supabase
    .from('company_members')
    .select('profile_id')
    .eq('company_id', companyId)
    .in('profile_id', profileIds);
  if (error) throw error;
  for (const row of asArr(data)) {
    const pid = asStr(asRecord(row)['profile_id']);
    if (pid) ids.add(pid);
  }
  return ids;
}

/** Nazwy nadawców + nazwa firmy + zespół — jeden zestaw zapytań pod RLS dla strony wątku. */
async function fetchSenderContext(
  supabase: SupabaseClient,
  uid: string,
  companyId: string,
  profileIds: Set<string>,
): Promise<SenderContext> {
  const [nameByProfile, companyNameById, memberIds] = await Promise.all([
    fetchProfileNames(supabase, [...profileIds]),
    fetchCompanyNames(supabase, companyId ? [companyId] : []),
    fetchCompanyMemberIds(supabase, companyId, [...new Set([...profileIds, uid])]),
  ]);
  return {
    nameByProfile,
    companyName: companyNameById.get(companyId) ?? '',
    teamIds: memberIds,
    viewerIsCompany: memberIds.has(uid),
  };
}

/**
 * Mapuje wiersze `messages` na kontrakt UI. Nadawca z profilu widocznego pod RLS; bez niego
 * (#355) wiadomość strony firmowej podpisujemy nazwą firmy, a stronę ustalamy tak: kandydat
 * widzi po drugiej stronie wyłącznie firmę, pracodawca — zespół (członkowie firmy) albo kandydata.
 */
function toThreadMessages(rows: unknown[], uid: string, ctx: SenderContext): ThreadMessage[] {
  return rows.map((row) => {
    const r = asRecord(row);
    const senderId = asStr(r['sender_id']);
    const mine = senderId === uid;
    const fromCompany = mine
      ? ctx.viewerIsCompany
      : ctx.viewerIsCompany
        ? ctx.teamIds.has(senderId)
        : true;
    const resolved = ctx.nameByProfile.get(senderId) ?? '';
    return {
      id: asStr(r['id']),
      body: asStr(r['body']),
      createdAt: asStr(r['created_at']),
      mine,
      senderName: resolved || (fromCompany ? ctx.companyName : ''),
      senderSide: fromCompany ? 'company' : 'candidate',
      isSystem: Boolean(r['is_system']),
    };
  });
}

/** Zbiór nadawców z wierszy wiadomości. */
function senderIdsOf(rows: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const sid = asStr(asRecord(row)['sender_id']);
    if (sid) ids.add(sid);
  }
  return ids;
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez bazy) — spójne z demo ofert/firm (lokalizowane treści)
 * ------------------------------------------------------------------------- */

/** Nazwa bieżącego użytkownika w trybie demo (spójna z panelem kandydata). */
const DEMO_SELF_NAME = 'Adam Nowak';

/** Krótkie treści wiadomości demo (fikcyjne, wielojęzyczne — jak reszta danych demo). */
const DEMO_BODIES: Record<Locale, string[]> = {
  pl: [
    'Dzień dobry, dziękujemy za zgłoszenie. Czy ma Pan/Pani czas na krótką rozmowę w tym tygodniu?',
    'Dzień dobry, tak — pasuje mi czwartek po południu.',
    'Świetnie, potwierdzamy czwartek o 14:00. Do usłyszenia!',
  ],
  nl: [
    'Goedendag, bedankt voor uw sollicitatie. Heeft u deze week tijd voor een kort gesprek?',
    'Goedendag, ja — donderdagnamiddag past mij goed.',
    'Prima, we bevestigen donderdag om 14:00 uur. Tot dan!',
  ],
  fr: [
    'Bonjour, merci pour votre candidature. Auriez-vous un moment cette semaine pour un court entretien ?',
    'Bonjour, oui — jeudi après-midi me convient.',
    'Parfait, nous confirmons jeudi à 14h00. À bientôt !',
  ],
  en: [
    'Hello, thank you for your application. Do you have time for a short call this week?',
    'Hello, yes — Thursday afternoon works for me.',
    'Great, we confirm Thursday at 2:00 pm. Talk soon!',
  ],
};

interface DemoSeed {
  id: string;
  companyIdx: number;
  jobIdx: number;
  daysAgo: number;
  /** Wzorzec nadawców: true = firma, false = ja. Ostatni decyduje o `unread`. */
  senders: boolean[];
  unread: boolean;
}

const DEMO_SEEDS: DemoSeed[] = [
  { id: 'demo-conv-0', companyIdx: 0, jobIdx: 0, daysAgo: 0, senders: [true, false, true], unread: true },
  { id: 'demo-conv-1', companyIdx: 2, jobIdx: 2, daysAgo: 2, senders: [true, false], unread: false },
  { id: 'demo-conv-2', companyIdx: 6, jobIdx: 6, daysAgo: 6, senders: [true, false, true], unread: false },
];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function demoThreadMessages(seed: DemoSeed, locale: Locale, companyName: string): ThreadMessage[] {
  const bodies = DEMO_BODIES[locale];
  const base = Date.now() - seed.daysAgo * DAY_MS;
  return seed.senders.map((fromCompany, i) => ({
    id: `${seed.id}-m${i}`,
    body: bodies[i % bodies.length] ?? '',
    createdAt: new Date(base + i * HOUR_MS).toISOString(),
    mine: !fromCompany,
    senderName: fromCompany ? companyName : DEMO_SELF_NAME,
    senderSide: fromCompany ? 'company' : 'candidate',
    isSystem: false,
  }));
}

/** Buduje spójny zestaw demo: lista + wątki (ta sama treść w obu widokach). */
function buildDemo(locale: Locale): {
  list: ConversationListItem[];
  threads: Map<string, ConversationThread>;
} {
  const jobs = resolveDemoJobs(locale);
  const list: ConversationListItem[] = [];
  const threads = new Map<string, ConversationThread>();

  for (const seed of DEMO_SEEDS) {
    const companyName = demoCompanies[seed.companyIdx]?.name ?? '';
    const subject = jobs[seed.jobIdx]?.title ?? '';
    const messages = demoThreadMessages(seed, locale, companyName);
    const last = messages[messages.length - 1];

    list.push({
      id: seed.id,
      subject,
      counterpartyName: companyName,
      lastPreview: last?.body ?? '',
      lastMessageAt: last?.createdAt ?? new Date().toISOString(),
      unread: seed.unread,
      unreadCount: seed.unread ? 1 : 0,
    });
    threads.set(seed.id, {
      id: seed.id,
      subject,
      counterpartyName: companyName,
      messages,
      olderCursor: null,
    });
  }

  return { list, threads };
}

/* ---------------------------------------------------------------------------
 * Publiczne API danych komunikacji
 * ------------------------------------------------------------------------- */

/** Lista konwersacji bieżącego użytkownika (najświeższe pierwsze). */
export type ConversationsResult =
  | { status: 'ready'; items: ConversationListItem[] }
  | { status: 'error'; items: [] };

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string | undefined): Locale {
  return locale && (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

/**
 * Zachowuje różnicę między brakiem rozmów a awarią odczytu. `locale` = język strony — steruje
 * wyłącznie treścią DEMO (#359); realne wiadomości to dane użytkowników, bez tłumaczenia.
 */
export async function getConversationsResult(locale?: string): Promise<ConversationsResult> {
  if (!isSupabaseConfigured()) return { status: 'ready', items: buildDemo(toLocale(locale)).list };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const uid = await getAuthUserId(supabase);
    if (!uid) return { status: 'ready', items: [] };

    // 1) Moje członkostwa → conversation_id + last_read_at.
    const { data: memberData, error: memberError } = await supabase
      .from('conversation_members')
      .select('conversation_id, last_read_at')
      .eq('profile_id', uid);
    if (memberError) throw memberError;

    const lastReadByConv = new Map<string, string | null>();
    for (const row of asArr(memberData)) {
      const r = asRecord(row);
      const cid = asStr(r['conversation_id']);
      if (cid) {
        lastReadByConv.set(cid, typeof r['last_read_at'] === 'string' ? (r['last_read_at'] as string) : null);
      }
    }
    if (lastReadByConv.size === 0) return { status: 'ready', items: [] };
    const convIds = [...lastReadByConv.keys()];

    // 2) Konwersacje (najświeższe pierwsze).
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, subject, company_id, last_message_at')
      .in('id', convIds)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (convError) throw convError;

    const convs = asArr(convData);
    if (convs.length === 0) return { status: 'ready', items: [] };
    const orderedIds = convs.map((c) => asStr(asRecord(c)['id'])).filter(Boolean);

    // 3) Pozostali uczestnicy (kandydaci na „drugą stronę").
    const { data: otherMembers, error: otherError } = await supabase
      .from('conversation_members')
      .select('conversation_id, profile_id')
      .in('conversation_id', orderedIds)
      .neq('profile_id', uid);
    if (otherError) throw otherError;

    const otherIdsByConv = new Map<string, string[]>();
    const allOtherIds = new Set<string>();
    for (const row of asArr(otherMembers)) {
      const r = asRecord(row);
      const cid = asStr(r['conversation_id']);
      const pid = asStr(r['profile_id']);
      if (!cid || !pid) continue;
      const arr = otherIdsByConv.get(cid) ?? [];
      arr.push(pid);
      otherIdsByConv.set(cid, arr);
      allOtherIds.add(pid);
    }

    const companyIds = new Set<string>();
    for (const c of convs) {
      const companyId = asStr(asRecord(c)['company_id']);
      if (companyId) companyIds.add(companyId);
    }

    // 4) Nazwy stron (profile widoczne pod RLS) + firmy (fallback) + PODSUMOWANIA konwersacji.
    // Ostatnia wiadomość i licznik nieprzeczytanych liczone PO STRONIE SQL (RPC 0021,
    // DISTINCT/LATERAL) — koniec pobierania WSZYSTKICH wiadomości do UI (P2#10). Nazwę drugiej
    // strony nadal rozwiązujemy pod RLS (nie z RPC, który omija RLS) — bez zmiany prywatności.
    const [nameByProfile, companyNameById, summaryResult] = await Promise.all([
      fetchProfileNames(supabase, [...allOtherIds]),
      fetchCompanyNames(supabase, [...companyIds]),
      supabase.rpc('get_conversation_summaries'),
    ]);
    if (summaryResult.error) throw summaryResult.error;

    const lastMsgByConv = new Map<string, { body: string; createdAt: string }>();
    const unreadByConv = new Map<string, number>();
    for (const row of asArr(summaryResult.data)) {
      const r = asRecord(row);
      const cid = asStr(r['conversation_id']);
      if (!cid) continue;
      lastMsgByConv.set(cid, { body: asStr(r['last_body']), createdAt: asStr(r['last_at']) });
      const n = r['unread_count'];
      unreadByConv.set(cid, typeof n === 'number' ? n : Number(n ?? 0) || 0);
    }

    const items = convs.map((c) => {
      const r = asRecord(c);
      const cid = asStr(r['id']);
      const last = lastMsgByConv.get(cid);
      const unreadCount = unreadByConv.get(cid) ?? 0;
      return {
        id: cid,
        subject: asStr(r['subject']),
        counterpartyName: resolveCounterparty(
          otherIdsByConv.get(cid) ?? [],
          asStr(r['company_id']),
          nameByProfile,
          companyNameById,
        ),
        lastPreview: last?.body ?? '',
        lastMessageAt: last?.createdAt || asStr(r['last_message_at']),
        unread: unreadCount > 0,
        unreadCount,
      };
    });
    return { status: 'ready', items };
  } catch (error) {
    captureError(error, { area: 'messages.getConversations' });
    return { status: 'error', items: [] };
  }
}

/** Kompatybilność z istniejącymi licznikami wiadomości. */
export async function getConversations(locale?: string): Promise<ConversationListItem[]> {
  return (await getConversationsResult(locale)).items;
}

/**
 * Wątek z NAJNOWSZĄ stroną wiadomości (starsze: `getOlderThreadMessages`); brak dostępu
 * i nieistnienie dają ten sam wynik, awaria osobny.
 */
export async function getConversationThread(
  conversationId: string,
  locale?: string,
): Promise<ConversationThreadResult> {
  if (!isSupabaseConfigured()) {
    const thread = buildDemo(toLocale(locale)).threads.get(conversationId);
    return thread ? { status: 'ready', thread } : { status: 'not-found' };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const uid = await getAuthUserId(supabase);
    if (!uid) return { status: 'not-found' };

    const { data: convRow, error: convError } = await supabase
      .from('conversations')
      .select('id, subject, company_id')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle();
    if (convError) throw convError;

    const conv = asRecord(convRow);
    const cid = asStr(conv['id']);
    if (!cid) return { status: 'not-found' }; // brak dostępu (RLS) lub nie istnieje

    const { rows: messageRows, olderCursor } = await fetchMessagePage(
      supabase,
      conversationId,
      null,
    );

    // Nazwy nadawców (profile widoczne pod RLS) + pozostali uczestnicy (druga strona).
    const senderIds = senderIdsOf(messageRows);

    const { data: otherMembers, error: otherError } = await supabase
      .from('conversation_members')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .neq('profile_id', uid);
    if (otherError) throw otherError;

    const otherIds: string[] = [];
    for (const row of asArr(otherMembers)) {
      const pid = asStr(asRecord(row)['profile_id']);
      if (pid) {
        otherIds.push(pid);
        senderIds.add(pid);
      }
    }

    const companyId = asStr(conv['company_id']);
    const ctx = await fetchSenderContext(supabase, uid, companyId, senderIds);
    const messages = toThreadMessages(messageRows, uid, ctx);

    return {
      status: 'ready',
      thread: {
        id: cid,
        subject: asStr(conv['subject']),
        counterpartyName: resolveCounterparty(
          otherIds,
          companyId,
          ctx.nameByProfile,
          new Map([[companyId, ctx.companyName]]),
        ),
        messages,
        olderCursor,
      },
    };
  } catch (error) {
    captureError(error, { area: 'messages.getConversationThread' });
    return { status: 'error' };
  }
}

/**
 * Starsza strona wątku (przed `cursor`) — „Wczytaj starsze" (#146). Dostęp sprawdzany jak przy
 * otwarciu wątku (konwersacja widoczna pod RLS); awaria to osobny stan, nie pusta strona.
 */
export async function getOlderThreadMessages(
  conversationId: string,
  cursor: ThreadCursor,
): Promise<OlderMessagesResult> {
  if (!isSupabaseConfigured()) {
    // Demo ma krótkie wątki (bez kursora), więc starsza strona zawsze jest pusta.
    return DEMO_SEEDS.some((seed) => seed.id === conversationId)
      ? { status: 'ready', messages: [], olderCursor: null }
      : { status: 'not-found' };
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const uid = await getAuthUserId(supabase);
    if (!uid) return { status: 'not-found' };

    const { data: convRow, error: convError } = await supabase
      .from('conversations')
      .select('id, company_id')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle();
    if (convError) throw convError;
    const conv = asRecord(convRow);
    if (!asStr(conv['id'])) return { status: 'not-found' };

    const { rows, olderCursor } = await fetchMessagePage(supabase, conversationId, cursor);
    const ctx = await fetchSenderContext(supabase, uid, asStr(conv['company_id']), senderIdsOf(rows));
    return { status: 'ready', messages: toThreadMessages(rows, uid, ctx), olderCursor };
  } catch (error) {
    captureError(error, { area: 'messages.getOlderThreadMessages' });
    return { status: 'error' };
  }
}

/** Liczba konwersacji z nieprzeczytanymi wiadomościami (np. do plakietki w nawigacji). */
export async function getUnreadConversationsCount(locale?: string): Promise<number> {
  // Reużywa `getConversations` (obsługuje demo/env/błędy → nigdy nie rzuca).
  const conversations = await getConversations(locale);
  return conversations.filter((c) => c.unread).length;
}
