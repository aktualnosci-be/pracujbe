import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError }));

import {
  THREAD_PAGE_SIZE,
  getConversationThread,
  getOlderThreadMessages,
  type ThreadCursor,
  type ThreadMessage,
} from '@/lib/data/messages';
import { mergeThreadMessages, toMessageViews } from '@/lib/messaging/thread-view';

const ME = 'me';

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
 * Mikrosekundy jak w wyniku `json_agg` z PostgreSQL.
 */
function longThread(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const second = index - (index % 3 === 1 ? 1 : 0);
    const time = new Date(Date.UTC(2026, 8, 1) + second * 1000).toISOString().replace('Z', '');
    return {
      id: uuid(index + 1),
      body: `wiadomość ${index + 1}`,
      sender_id: index % 2 ? ME : 'other',
      is_system: false,
      created_at: `${time}123+00:00`,
    };
  });
}

/**
 * Strona wątku w pamięci — semantyka zapytania `messages.thread-page` (kursor `$2`/`$3`,
 * limit `$4`, sortowanie `(created_at, id)` malejąco). Tekst SQL sprawdzamy osobno; semantykę
 * na prawdziwym PostgreSQL pokrywa `tests/integration/portal-messages-settings.test.ts`.
 * Znaczniki mają stałą długość, więc porównanie napisów = porównanie czasu.
 */
function fakeThread(store: { rows: Row[]; conversation: boolean; failMessages?: boolean }) {
  resetFakeDb({ id: ME, role: 'candidate' } as unknown as PortalIdentity);
  const calls = { limit: [] as number[], texts: [] as string[] };
  fakeDb
    .rpc('get_message_attachments', [])
    .rows('messages.conversation', store.conversation ? [{ id: 'thread-1', subject: 'Praca', company_id: 'company-1' }] : [])
    .rows('messages.conversation-access', store.conversation ? [{ id: 'thread-1', company_id: 'company-1' }] : [])
    .rows('messages.thread-other-members', [{ profile_id: 'other' }])
    .rows('messages.profile-names', [{ id: 'other', first_name: 'Anna', last_name: 'Nowak' }])
    .rows('messages.company-names', [{ id: 'company-1', name: 'Firma' }])
    .rows('messages.company-members', [])
    .rows('messages.thread-page', ({ values, text }) => {
      const [, lt, id, limit] = values as [string, string | null, string | null, number];
      calls.limit.push(limit);
      calls.texts.push(text);
      if (store.failMessages) throw pgError('XX000', 'private detail');
      const list = store.rows
        .filter((row) => lt === null || row.created_at < lt || (row.created_at === lt && row.id < id!))
        .sort((a, b) =>
          a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
        );
      return list.slice(0, limit);
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
    const calls = fakeThread({ rows, conversation: true });

    const result = await getConversationThread('thread-1');
    if (result.status !== 'ready') throw new Error(result.status);
    const { messages, olderCursor } = result.thread;

    expect(calls.limit).toEqual([THREAD_PAGE_SIZE + 1]);
    expect(calls.texts[0]).toMatch(/ORDER BY m\.created_at DESC, m\.id DESC\s+LIMIT \$4/);
    expect(messages).toHaveLength(THREAD_PAGE_SIZE);
    expect(messages.at(-1)?.id).toBe(uuid(1001));
    expect(ids(messages)).toEqual(rows.slice(-THREAD_PAGE_SIZE).map((row) => row.id));
    expect(olderCursor).toEqual({ createdAt: rows[1001 - THREAD_PAGE_SIZE]!.created_at, id: uuid(1001 - THREAD_PAGE_SIZE + 1) });
  });

  it('kolejne strony dają całą historię bez luk i duplikatów, także przy remisach i wstawce', async () => {
    const store = { rows: longThread(1001), conversation: true };
    fakeThread(store);
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
    fakeThread({ rows: longThread(THREAD_PAGE_SIZE), conversation: true });
    const result = await getConversationThread('thread-1');
    expect(result).toMatchObject({ status: 'ready', thread: { olderCursor: null } });
  });

  it('awaria starszej strony to jawny błąd, nie pusta strona (koniec historii)', async () => {
    fakeThread({ rows: longThread(120), conversation: true, failMessages: true });
    const result = await getOlderThreadMessages('thread-1', { createdAt: '2026-09-01T00:01:00.123+00:00', id: uuid(60) });
    expect(result).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(expect.objectContaining({ code: 'XX000' }), { area: 'messages.getOlderThreadMessages' });
  });

  it('starsza strona niedostępnej rozmowy nie odczytuje wiadomości', async () => {
    const calls = fakeThread({ rows: longThread(120), conversation: false });
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
      id, createdAt, body: id, mine: false, senderName: '', senderSide: 'company' as const, isSystem: false, timeLabel: '',
    });
    const merged = mergeThreadMessages(
      [view('b', at), view('c', later)],
      [view('a', at), view('b', at), view('d', later)],
    );
    expect(merged.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
