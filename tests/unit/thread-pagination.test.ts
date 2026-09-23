import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClient, captureError } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient }));
vi.mock('@/lib/sentry', () => ({ captureError }));

import {
  THREAD_PAGE_SIZE,
  getConversationThread,
  getOlderThreadMessages,
  type ThreadCursor,
  type ThreadMessage,
} from '@/lib/data/messages';
import { mergeThreadMessages, toMessageViews } from '@/lib/messaging/thread-view';

interface Row {
  id: string;
  body: string;
  sender_id: string;
  is_system: boolean;
  created_at: string;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Wiadomości co sekundę, ale co trzecia para ma IDENTYCZNY `created_at` (remisy rozstrzyga `id`).
 * Mikrosekundy jak w odpowiedzi PostgREST.
 */
function longThread(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const second = index - (index % 3 === 1 ? 1 : 0);
    const time = new Date(Date.UTC(2026, 8, 1) + second * 1000).toISOString().replace('Z', '');
    return {
      id: uuid(index + 1),
      body: `wiadomość ${index + 1}`,
      sender_id: index % 2 ? 'me' : 'other',
      is_system: false,
      created_at: `${time}123+00:00`,
    };
  });
}

/**
 * Minimalny PostgREST w pamięci: sortowanie malejące po (created_at, id), filtr kursora `.or()`
 * w dokładnie tej postaci, jaką buduje warstwa danych, oraz `.limit()`. Bez sortowania
 * rosnącego — gdyby kod wrócił do `ascending: true`, test zobaczy najstarsze wiadomości.
 */
function fakeSupabase(store: { rows: Row[]; conversation: boolean; failMessages?: boolean }) {
  const calls = { limit: [] as number[], orders: [] as Array<[string, boolean]>, or: [] as string[] };
  const from = vi.fn((table: string) => {
    let rows: unknown = null;
    let orders: Array<[string, boolean]> = [];
    let orFilter: string | null = null;
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      neq: () => Promise.resolve({ data: [{ profile_id: 'other' }], error: null }),
      in: () =>
        Promise.resolve({
          data:
            table === 'profiles'
              ? [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }]
              : [{ id: 'company-1', name: 'Firma' }],
          error: null,
        }),
      maybeSingle: () =>
        Promise.resolve({
          data: store.conversation ? { id: 'thread-1', subject: 'Praca', company_id: 'company-1' } : null,
          error: null,
        }),
      order: (column: string, opts: { ascending: boolean }) => {
        orders.push([column, opts.ascending]);
        calls.orders.push([column, opts.ascending]);
        return query;
      },
      or: (filter: string) => {
        orFilter = filter;
        calls.or.push(filter);
        return query;
      },
      limit: (n: number) => {
        calls.limit.push(n);
        if (store.failMessages) return Promise.resolve({ data: null, error: new Error('private detail') });
        let list = [...store.rows];
        if (orFilter) {
          const match = /^created_at\.lt\."(.+)",and\(created_at\.eq\."(.+)",id\.lt\.(.+)\)$/.exec(orFilter);
          if (!match) throw new Error(`nieobsługiwany filtr ${orFilter}`);
          const [, lt, eq, id] = match;
          list = list.filter((row) => row.created_at < lt! || (row.created_at === eq && row.id < id!));
        }
        const descending = orders.length === 2 && orders.every(([, ascending]) => !ascending);
        list.sort((a, b) =>
          a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
        );
        if (descending) list.reverse();
        rows = list.slice(0, n);
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return query;
  });
  createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me' } }, error: null }) },
    from,
  });
  return calls;
}

function ids(messages: ThreadMessage[]): string[] {
  return messages.map((message) => message.id);
}

describe('stronicowanie wątku od najnowszych (#146)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pierwsze otwarcie wątku z 1001 wiadomościami pokazuje NAJNOWSZE, chronologicznie', async () => {
    const rows = longThread(1001);
    const calls = fakeSupabase({ rows, conversation: true });

    const result = await getConversationThread('thread-1');
    if (result.status !== 'ready') throw new Error(result.status);
    const { messages, olderCursor } = result.thread;

    expect(calls.limit).toEqual([THREAD_PAGE_SIZE + 1]);
    expect(calls.orders).toEqual([['created_at', false], ['id', false]]);
    expect(messages).toHaveLength(THREAD_PAGE_SIZE);
    expect(messages.at(-1)?.id).toBe(uuid(1001));
    expect(ids(messages)).toEqual(rows.slice(-THREAD_PAGE_SIZE).map((row) => row.id));
    expect(olderCursor).toEqual({ createdAt: rows[1001 - THREAD_PAGE_SIZE]!.created_at, id: uuid(1001 - THREAD_PAGE_SIZE + 1) });
  });

  it('kolejne strony dają całą historię bez luk i duplikatów, także przy remisach i wstawce', async () => {
    const store = { rows: longThread(1001), conversation: true };
    fakeSupabase(store);
    const first = await getConversationThread('thread-1');
    if (first.status !== 'ready') throw new Error(first.status);

    let loaded = toMessageViews(first.thread.messages, 'pl');
    let cursor: ThreadCursor | null = first.thread.olderCursor;
    let pages = 0;
    while (cursor) {
      if (pages === 3) {
        // Ktoś odpisał między pobraniami — nowsza od kursora nie przesuwa starszych stron.
        store.rows.push({ id: uuid(5000), body: 'nowa', sender_id: 'other', is_system: false, created_at: '2026-09-23T10:00:00.000001+00:00' });
      }
      const page = await getOlderThreadMessages('thread-1', cursor);
      if (page.status !== 'ready') throw new Error(page.status);
      loaded = mergeThreadMessages(loaded, toMessageViews(page.messages, 'pl'));
      cursor = page.olderCursor;
      pages += 1;
    }

    expect(pages).toBe(Math.ceil(1001 / THREAD_PAGE_SIZE) - 1);
    expect(ids(loaded)).toEqual(longThread(1001).map((row) => row.id));
    expect(new Set(ids(loaded)).size).toBe(1001);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('krótki wątek nie ma kursora starszych', async () => {
    fakeSupabase({ rows: longThread(THREAD_PAGE_SIZE), conversation: true });
    const result = await getConversationThread('thread-1');
    expect(result).toMatchObject({ status: 'ready', thread: { olderCursor: null } });
  });

  it('awaria starszej strony to jawny błąd, nie pusta strona (koniec historii)', async () => {
    fakeSupabase({ rows: longThread(120), conversation: true, failMessages: true });
    const result = await getOlderThreadMessages('thread-1', { createdAt: '2026-09-01T00:01:00.123+00:00', id: uuid(60) });
    expect(result).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { area: 'messages.getOlderThreadMessages' });
  });

  it('starsza strona niedostępnej rozmowy nie odczytuje wiadomości', async () => {
    const calls = fakeSupabase({ rows: longThread(120), conversation: false });
    const result = await getOlderThreadMessages('thread-1', { createdAt: '2026-09-01T00:01:00.123+00:00', id: uuid(60) });
    expect(result).toEqual({ status: 'not-found' });
    expect(calls.limit).toEqual([]);
  });
});

describe('mergeThreadMessages', () => {
  it('scala bez duplikatów w stabilnej kolejności (created_at, id)', () => {
    const at = '2026-09-01T00:00:00.000001+00:00';
    const later = '2026-09-01T00:00:00.000002+00:00';
    const view = (id: string, createdAt: string) => ({
      id, createdAt, body: id, mine: false, senderName: '', isSystem: false, timeLabel: '',
    });
    const merged = mergeThreadMessages(
      [view('b', at), view('c', later)],
      [view('a', at), view('b', at), view('d', later)],
    );
    expect(merged.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
