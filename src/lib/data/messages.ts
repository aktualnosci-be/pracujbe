/**
 * Warstwa dostępu do danych KOMUNIKACJI (Etap 6) — Pracuj.be.
 *
 * Strategia (#25): gdy `isPortalDataConfigured()` — dane czytane są POD SESJĄ użytkownika
 * (`getPortalIdentity` + `withPortalTransaction`: jedna transakcja, RLS wg `auth.uid()`,
 * NIE service-role); bez env — te same struktury wypełnione danymi DEMO.
 *
 * Widoczność stron konwersacji wynika z RLS:
 * - `profiles`: właściciel + kandydat powiązany relacją z firmą (pracodawca widzi kandydata,
 *   kandydat NIE widzi profilu pracodawcy) — dlatego nazwę drugiej strony ustalamy z `profiles`,
 *   a przy braku dostępu (perspektywa kandydata) spadamy na nazwę firmy (`companies` pod RLS —
 *   od 0014 czytelne tylko dla członków firmy, więc kandydat dostaje '' → neutralna etykieta UI).
 * - `conversations`/`conversation_members`/`messages`: wyłącznie uczestnik konwersacji.
 *
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do Sentry,
 * a wyniki listy i wątku odróżniają awarię od prawdziwego braku danych.
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, queryRows, rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
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

/** Składa „imię nazwisko" z rekordu profilu (pusty string, gdy brak). */
function fullName(record: Record<string, unknown>): string {
  return `${asStr(record['first_name'])} ${asStr(record['last_name'])}`.trim();
}

/** Mapa profile_id → „imię nazwisko" (tylko profile widoczne pod RLS). */
async function fetchProfileNames(
  tx: TransactionQuery,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const rows = await queryRows(tx, 'messages.profile-names',
    'SELECT id, first_name, last_name FROM public.profiles WHERE id = ANY($1::uuid[])', [ids]);

  for (const row of rows) {
    const r = asRecord(row);
    const id = asStr(r['id']);
    const name = fullName(r);
    if (id && name) map.set(id, name);
  }
  return map;
}

/** Mapa company_id → nazwa (tylko firmy widoczne pod RLS — od 0014 wyłącznie własne). */
async function fetchCompanyNames(
  tx: TransactionQuery,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const rows = await queryRows(tx, 'messages.company-names',
    'SELECT id, name FROM public.companies WHERE id = ANY($1::uuid[])', [ids]);

  for (const row of rows) {
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
 * Odczyt pod sesją — RLS `messages` ogranicza wynik do uczestnika rozmowy. Kursor z Server
 * Action jest sprawdzany przez Zod (ISO datetime + UUID); znacznik czasu z `json_agg` ma
 * pełną precyzję (mikrosekundy), więc porównanie w SQL jest dokładne.
 */
async function fetchMessagePage(
  tx: TransactionQuery,
  conversationId: string,
  cursor: ThreadCursor | null,
): Promise<{ rows: unknown[]; olderCursor: ThreadCursor | null }> {
  const rows = await queryRows(tx, 'messages.thread-page',
    `SELECT m.id, m.body, m.sender_id, m.is_system, m.created_at
       FROM public.messages m
      WHERE m.conversation_id = $1
        AND m.deleted_at IS NULL
        AND ($2::timestamptz IS NULL
             OR m.created_at < $2::timestamptz
             OR (m.created_at = $2::timestamptz AND m.id < $3::uuid))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4`,
    [conversationId, cursor?.createdAt ?? null, cursor?.id ?? null, THREAD_PAGE_SIZE + 1]);

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
  tx: TransactionQuery,
  companyId: string,
  profileIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!companyId || profileIds.length === 0) return ids;
  const rows = await queryRows(tx, 'messages.company-members',
    `SELECT profile_id FROM public.company_members
      WHERE company_id = $1 AND profile_id = ANY($2::uuid[])`, [companyId, profileIds]);
  for (const row of rows) {
    const pid = asStr(asRecord(row)['profile_id']);
    if (pid) ids.add(pid);
  }
  return ids;
}

/** Nazwy nadawców + nazwa firmy + zespół — jeden zestaw zapytań pod RLS dla strony wątku. */
async function fetchSenderContext(
  tx: TransactionQuery,
  uid: string,
  companyId: string,
  profileIds: Set<string>,
): Promise<SenderContext> {
  // Sekwencyjnie na jednej transakcji (jedno połączenie); błąd dowolnego odczytu = błąd wątku.
  const nameByProfile = await fetchProfileNames(tx, [...profileIds]);
  const companyNameById = await fetchCompanyNames(tx, companyId ? [companyId] : []);
  const memberIds = await fetchCompanyMemberIds(tx, companyId, [...new Set([...profileIds, uid])]);
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
  if (!isPortalDataConfigured()) return { status: 'ready', items: buildDemo(toLocale(locale)).list };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'ready', items: [] };
    const uid = me.id;

    const items = await withPortalTransaction(me, async (tx): Promise<ConversationListItem[]> => {
      // 1) Moje członkostwa → conversation_id (RLS: uczestnik rozmowy).
      const memberRows = await queryRows(tx, 'messages.my-memberships',
        'SELECT conversation_id, last_read_at FROM public.conversation_members WHERE profile_id = $1',
        [uid]);
      const convIds = [...new Set(memberRows.map((row) => asStr(asRecord(row)['conversation_id'])).filter(Boolean))];
      if (convIds.length === 0) return [];

      // 2) Konwersacje (najświeższe pierwsze).
      const convs = await queryRows(tx, 'messages.conversations',
        `SELECT id, subject, company_id, last_message_at
           FROM public.conversations
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
          ORDER BY last_message_at DESC NULLS LAST`, [convIds]);
      if (convs.length === 0) return [];
      const orderedIds = convs.map((c) => asStr(asRecord(c)['id'])).filter(Boolean);

      // 3) Pozostali uczestnicy (kandydaci na „drugą stronę").
      const otherMembers = await queryRows(tx, 'messages.other-members',
        `SELECT conversation_id, profile_id
           FROM public.conversation_members
          WHERE conversation_id = ANY($1::uuid[]) AND profile_id <> $2`, [orderedIds, uid]);

      const otherIdsByConv = new Map<string, string[]>();
      const allOtherIds = new Set<string>();
      for (const row of otherMembers) {
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
      // Ostatnia wiadomość i licznik nieprzeczytanych liczone PO STRONIE SQL (RPC 0021/0039,
      // DISTINCT/LATERAL) — bez pobierania WSZYSTKICH wiadomości (P2#10). Nazwę drugiej
      // strony nadal rozwiązujemy pod RLS (nie z RPC, który omija RLS) — bez zmiany prywatności.
      const nameByProfile = await fetchProfileNames(tx, [...allOtherIds]);
      const companyNameById = await fetchCompanyNames(tx, [...companyIds]);
      const summaries = await rpcRows(tx, 'get_conversation_summaries');

      const lastMsgByConv = new Map<string, { body: string; createdAt: string }>();
      const unreadByConv = new Map<string, number>();
      for (const row of summaries) {
        const r = asRecord(row);
        const cid = asStr(r['conversation_id']);
        if (!cid) continue;
        lastMsgByConv.set(cid, { body: asStr(r['last_body']), createdAt: asStr(r['last_at']) });
        const n = r['unread_count'];
        unreadByConv.set(cid, typeof n === 'number' ? n : Number(n ?? 0) || 0);
      }

      return convs.map((c) => {
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
  if (!isPortalDataConfigured()) {
    const thread = buildDemo(toLocale(locale)).threads.get(conversationId);
    return thread ? { status: 'ready', thread } : { status: 'not-found' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'not-found' };
    const uid = me.id;

    return await withPortalTransaction(me, async (tx): Promise<ConversationThreadResult> => {
      const conv = asRecord(await queryOne(tx, 'messages.conversation',
        `SELECT id, subject, company_id FROM public.conversations
          WHERE id = $1 AND deleted_at IS NULL`, [conversationId]));
      const cid = asStr(conv['id']);
      if (!cid) return { status: 'not-found' }; // brak dostępu (RLS) lub nie istnieje

      const { rows: messageRows, olderCursor } = await fetchMessagePage(tx, conversationId, null);

      // Nazwy nadawców (profile widoczne pod RLS) + pozostali uczestnicy (druga strona).
      const senderIds = senderIdsOf(messageRows);

      const otherMembers = await queryRows(tx, 'messages.thread-other-members',
        `SELECT profile_id FROM public.conversation_members
          WHERE conversation_id = $1 AND profile_id <> $2`, [conversationId, uid]);

      const otherIds: string[] = [];
      for (const row of otherMembers) {
        const pid = asStr(asRecord(row)['profile_id']);
        if (pid) {
          otherIds.push(pid);
          senderIds.add(pid);
        }
      }

      const companyId = asStr(conv['company_id']);
      const ctx = await fetchSenderContext(tx, uid, companyId, senderIds);
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
    });
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
  if (!isPortalDataConfigured()) {
    // Demo ma krótkie wątki (bez kursora), więc starsza strona zawsze jest pusta.
    return DEMO_SEEDS.some((seed) => seed.id === conversationId)
      ? { status: 'ready', messages: [], olderCursor: null }
      : { status: 'not-found' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'not-found' };

    return await withPortalTransaction(me, async (tx): Promise<OlderMessagesResult> => {
      const conv = asRecord(await queryOne(tx, 'messages.conversation-access',
        'SELECT id, company_id FROM public.conversations WHERE id = $1 AND deleted_at IS NULL',
        [conversationId]));
      if (!asStr(conv['id'])) return { status: 'not-found' };

      const { rows, olderCursor } = await fetchMessagePage(tx, conversationId, cursor);
      const ctx = await fetchSenderContext(tx, me.id, asStr(conv['company_id']), senderIdsOf(rows));
      return { status: 'ready', messages: toThreadMessages(rows, me.id, ctx), olderCursor };
    });
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
