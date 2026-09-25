import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

const translations = { pl, nl, fr, en } as const;
type Loc = keyof typeof translations;

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/actions/messages', () => ({ loadOlderMessages: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ locale }: { locale: Loc }) =>
    (key: keyof (typeof translations)['pl']['messages']) =>
      translations[locale].messages[key],
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/messaging/ConversationOpenPending', () => ({ ConversationOpenPending: () => null }));

import { getConversationThread, getOlderThreadMessages } from '@/lib/data/messages';
import { resolveDemoJobs } from '@/lib/data/demo';
import { ThreadMessageList } from '@/components/messaging/ThreadMessageList';
import { ConversationList } from '@/components/messaging/ConversationList';
import type { ThreadMessageView } from '@/lib/messaging/thread-view';

afterEach(cleanup);

/**
 * Baza pod RLS w pamięci: profile widoczne tylko z `visibleProfiles`, członkowie firmy
 * widoczni tylko dla członka tej firmy (`company_members_select`).
 */
function fakeClient(opts: { uid: string; team: string[]; visibleProfiles: Record<string, string> }) {
  resetFakeDb({ id: opts.uid, role: opts.team.includes(opts.uid) ? 'employer' : 'candidate' } as unknown as PortalIdentity);
  const viewerIsMember = opts.team.includes(opts.uid);
  const conversation = { id: 'thread-1', subject: 'Magazynier', company_id: 'company-1' };
  const members = [{ profile_id: 'rec' }, { profile_id: 'cand' }, { profile_id: 'mate' }].filter(
    (row) => row.profile_id !== opts.uid,
  );
  fakeDb
    .rpc('get_message_attachments', [])
    .rows('messages.conversation', [conversation])
    .rows('messages.conversation-access', [conversation])
    .rows('messages.thread-page', [
      { id: 'm2', body: 'Od kandydata', sender_id: 'cand', is_system: false, created_at: '2026-09-23T12:01:00Z' },
      { id: 'm1', body: 'Od rekrutera', sender_id: 'rec', is_system: false, created_at: '2026-09-23T12:00:00Z' },
    ])
    .rows('messages.thread-other-members', members)
    .rows('messages.profile-names', ({ values }) =>
      (values[0] as string[])
        .filter((id) => opts.visibleProfiles[id])
        .map((id) => {
          const [first_name, last_name] = opts.visibleProfiles[id]!.split(' ');
          return { id, first_name, last_name };
        }),
    )
    .rows('messages.company-names', [{ id: 'company-1', name: 'Firma Logistyczna' }])
    .rows('messages.company-members', ({ values }) =>
      // Kandydat nie jest członkiem firmy, więc pod RLS nie widzi żadnego wiersza zespołu.
      viewerIsMember
        ? (values[1] as string[]).filter((id) => opts.team.includes(id)).map((profile_id) => ({ profile_id }))
        : [],
    );
}

describe('nadawca wiadomości pod RLS (#355)', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('kandydat: rekruter bez widocznego profilu → nazwa firmy, bez imienia rekrutera', async () => {
    fakeClient({ uid: 'cand', team: ['rec', 'mate'], visibleProfiles: {} });
    const result = await getConversationThread('thread-1');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const fromRecruiter = result.thread.messages.find((m) => m.id === 'm1')!;
    expect(fromRecruiter).toMatchObject({ mine: false, senderName: 'Firma Logistyczna', senderSide: 'company' });
    expect(result.thread.counterpartyName).toBe('Firma Logistyczna');
  });

  it('pracodawca: kolega z zespołu bez profilu → firma; kandydat bez profilu → strona kandydata', async () => {
    fakeClient({ uid: 'mate', team: ['rec', 'mate'], visibleProfiles: {} });
    const result = await getConversationThread('thread-1');
    if (result.status !== 'ready') throw new Error('expected ready');
    const byId = new Map(result.thread.messages.map((m) => [m.id, m]));
    expect(byId.get('m1')).toMatchObject({ senderName: 'Firma Logistyczna', senderSide: 'company' });
    expect(byId.get('m2')).toMatchObject({ senderName: '', senderSide: 'candidate' });
  });

  it('pracodawca: widoczny profil kandydata ma pierwszeństwo', async () => {
    fakeClient({ uid: 'rec', team: ['rec', 'mate'], visibleProfiles: { cand: 'Anna Nowak' } });
    const result = await getOlderThreadMessages('thread-1', { createdAt: '2026-09-24T00:00:00Z', id: 'x' });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.messages.find((m) => m.id === 'm2')).toMatchObject({ senderName: 'Anna Nowak', senderSide: 'candidate' });
    expect(result.messages.find((m) => m.id === 'm1')).toMatchObject({ mine: true, senderSide: 'company' });
  });
});

function view(message: Partial<ThreadMessageView>): ThreadMessageView {
  return {
    id: 'm1',
    body: 'Treść',
    createdAt: '2026-09-23T12:00:00Z',
    mine: false,
    senderName: '',
    senderSide: 'company',
    isSystem: false,
    timeLabel: '23-09, 14:00',
    ...message,
  };
}

function renderList(locale: Loc, messages: ThreadMessageView[]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <ThreadMessageList
        locale={locale}
        conversationId="thread-1"
        displayName="Magazynier"
        initialMessages={messages}
        initialOlderCursor={null}
      />
    </NextIntlClientProvider>,
  );
}

describe('podpis wiadomości w wątku (#355)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('bez nazwy nadawcy pokazuje neutralną etykietę strony (%s)', (locale) => {
    renderList(locale, [
      view({ id: 'a', senderSide: 'company' }),
      view({ id: 'b', senderSide: 'candidate' }),
      view({ id: 'c', senderName: 'Firma Logistyczna' }),
    ]);
    const items = screen.getAllByRole('listitem');
    const m = translations[locale].messages;
    expect(items[0]).toHaveTextContent(`${m.senderCompanyFallback} · 23-09, 14:00`);
    expect(items[1]).toHaveTextContent(`${m.senderCandidateFallback} · 23-09, 14:00`);
    expect(items[2]).toHaveTextContent('Firma Logistyczna · 23-09, 14:00');
    // Temat rozmowy nie udaje nadawcy.
    for (const item of items) expect(item).not.toHaveTextContent('Magazynier');
  });

  it('nigdy nie zostawia wiszącego separatora', () => {
    renderList('pl', [view({ senderName: 'Firma', timeLabel: '' })]);
    const line = screen.getByText('Firma');
    expect(line.textContent).toBe('Firma');
    expect(screen.getByRole('listitem').textContent).not.toMatch(/(^|\s)·\s*$|^\s*·/);
  });
});

describe('lista rozmów bez nazwy drugiej strony (#355)', () => {
  it('temat wyświetlony raz', async () => {
    render(
      await ConversationList({
        items: [
          {
            id: 'c1',
            subject: 'Kierowca C+E',
            counterpartyName: '',
            lastPreview: 'Dzień dobry',
            lastMessageAt: '2026-09-23T12:00:00Z',
            unread: false,
            unreadCount: 0,
          },
        ],
        basePath: '/candidate/wiadomosci',
        locale: 'pl',
      }),
    );
    expect(screen.getAllByText('Kierowca C+E')).toHaveLength(1);
  });
});

describe('tryb demo w języku strony (#359)', () => {
  beforeEach(() => {
    resetFakeDb();
    fakeSession.configured = false;
  });

  it.each(['nl', 'fr', 'en'] as const)('wątek demo-conv-0 bez polskich fraz (%s)', async (locale) => {
    const result = await getConversationThread('demo-conv-0', locale);
    if (result.status !== 'ready') throw new Error('expected ready');
    const text = result.thread.messages.map((m) => m.body).join(' ');
    expect(text).not.toMatch(/Dzień dobry|Świetnie/);
    expect(result.thread.subject).toBe(resolveDemoJobs(locale)[0]!.title);
    expect(result.thread.subject).not.toMatch(/Magazynier/);
  });

  it('lista demo w języku strony', async () => {
    const { getConversationsResult } = await import('@/lib/data/messages');
    const result = await getConversationsResult('fr');
    expect(result.items[0]!.subject).toBe(resolveDemoJobs('fr')[0]!.title);
    expect(result.items.map((i) => i.lastPreview).join(' ')).not.toMatch(/Dzień dobry|Świetnie/);
  });
});
