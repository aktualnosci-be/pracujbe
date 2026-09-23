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
 * Błędy warstwy danych NIE pokazują technikaliów (Invariant #8): logujemy do Sentry i degradujemy
 * do bezpiecznej pustej struktury (`[]` / `0` / `null`), NIE crashując panelu.
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
  /** Nazwa nadawcy (pusty = brak dostępu → UI: fallback). */
  senderName: string;
  isSystem: boolean;
}

export interface ConversationThread {
  id: string;
  subject: string;
  counterpartyName: string;
  messages: ThreadMessage[];
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

/** Zwraca zalogowanego użytkownika (albo null). */
async function getAuthUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    threads.set(seed.id, { id: seed.id, subject, counterpartyName: companyName, messages });
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

/** Zachowuje różnicę między brakiem rozmów a awarią odczytu. */
export async function getConversationsResult(): Promise<ConversationsResult> {
  if (!isSupabaseConfigured()) return { status: 'ready', items: buildDemo(routing.defaultLocale).list };

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
export async function getConversations(): Promise<ConversationListItem[]> {
  return (await getConversationsResult()).items;
}

/** Pełny wątek jednej konwersacji (wiadomości rosnąco). `null` = brak dostępu / nie istnieje. */
export async function getConversationThread(
  conversationId: string,
): Promise<ConversationThread | null> {
  if (!isSupabaseConfigured()) {
    return buildDemo(routing.defaultLocale).threads.get(conversationId) ?? null;
  }

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const uid = await getAuthUserId(supabase);
    if (!uid) return null;

    const { data: convRow, error: convError } = await supabase
      .from('conversations')
      .select('id, subject, company_id')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle();
    if (convError) throw convError;

    const conv = asRecord(convRow);
    const cid = asStr(conv['id']);
    if (!cid) return null; // brak dostępu (RLS) lub nie istnieje

    const { data: msgData, error: msgError } = await supabase
      .from('messages')
      .select('id, body, sender_id, is_system, created_at')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (msgError) throw msgError;

    const messageRows = asArr(msgData);

    // Nazwy nadawców (profile widoczne pod RLS) + pozostali uczestnicy (druga strona).
    const senderIds = new Set<string>();
    for (const row of messageRows) {
      const sid = asStr(asRecord(row)['sender_id']);
      if (sid) senderIds.add(sid);
    }

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
    const [nameByProfile, companyNameById] = await Promise.all([
      fetchProfileNames(supabase, [...senderIds]),
      fetchCompanyNames(supabase, companyId ? [companyId] : []),
    ]);

    const messages: ThreadMessage[] = messageRows.map((row) => {
      const r = asRecord(row);
      const senderId = asStr(r['sender_id']);
      return {
        id: asStr(r['id']),
        body: asStr(r['body']),
        createdAt: asStr(r['created_at']),
        mine: senderId === uid,
        senderName: nameByProfile.get(senderId) ?? '',
        isSystem: Boolean(r['is_system']),
      };
    });

    return {
      id: cid,
      subject: asStr(conv['subject']),
      counterpartyName: resolveCounterparty(otherIds, companyId, nameByProfile, companyNameById),
      messages,
    };
  } catch (error) {
    captureError(error, { area: 'messages.getConversationThread' });
    return null;
  }
}

/** Liczba konwersacji z nieprzeczytanymi wiadomościami (np. do plakietki w nawigacji). */
export async function getUnreadConversationsCount(): Promise<number> {
  // Reużywa `getConversations` (obsługuje demo/env/błędy → nigdy nie rzuca).
  const conversations = await getConversations();
  return conversations.filter((c) => c.unread).length;
}
