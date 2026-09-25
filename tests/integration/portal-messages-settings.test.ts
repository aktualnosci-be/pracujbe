import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest-it' }),
  cookies: async () => ({
    get: (name: string) => (name === 'pracujbe_visitor' ? { value: 'visitor-it' } : undefined),
  }),
}));

const messagesData = await import('../../src/lib/data/messages');
const messagesActions = await import('../../src/lib/actions/messages');
const savedData = await import('../../src/lib/data/saved-searches');
const savedActions = await import('../../src/lib/actions/saved-searches');
const blocksData = await import('../../src/lib/data/company-blocks');
const blocksActions = await import('../../src/lib/actions/company-blocks');
const visibilityData = await import('../../src/lib/data/profile-visibility');
const visibilityActions = await import('../../src/lib/actions/profile-visibility');
const { recordConsent } = await import('../../src/lib/actions/consent');

// #25: wiadomości (obie strony) i ustawienia kandydata na PostgreSQL 16 pod RLS —
// widoczność tylko dla stron rozmowy (kandydat + aktywny recruiter+), idempotentne
// send_message, stronicowanie wątku kursorem, zapisane wyszukiwania, blokady firm,
// widoczność profilu i receipt zgód (gość/sesja).
let anna: PortalIdentity; // kandydatka z aplikacją
let bartek: PortalIdentity; // inny kandydat
let recruiter: PortalIdentity; // recruiter firmy X
let member: PortalIdentity; // zwykły member firmy X (bez praw rekrutacyjnych)
let outsider: PortalIdentity; // owner firmy Y
let companyX: string;
let jobX: string;
let application: string;
let conversation: string;

function pg() {
  return realSession.db!;
}

beforeAll(async () => {
  const db = await startPortalDb();
  realSession.db = db;
  const make = async (role: 'candidate' | 'employer', locale: string, first: string, last: string) => {
    const id = await db.createUser(role, locale);
    await db.admin.query('UPDATE public.profiles SET first_name = $2, last_name = $3 WHERE id = $1', [id, first, last]);
    return { id, role } as PortalIdentity;
  };
  anna = await make('candidate', 'pl', 'Anna', 'Kandydat');
  bartek = await make('candidate', 'nl', 'Bartek', 'Obcy');
  recruiter = await make('employer', 'fr', 'Rafał', 'Rekruter');
  member = await make('employer', 'en', 'Maja', 'Member');
  outsider = await make('employer', 'pl', 'Olaf', 'Obcy');

  companyX = (await db.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma X IT', 'verified') RETURNING id`)).rows[0].id;
  const companyY = (await db.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma Y IT', 'verified') RETURNING id`)).rows[0].id;
  await db.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active) VALUES
    ($1, $2, 'owner', true), ($1, $3, 'member', true), ($4, $5, 'owner', true)`,
    [companyX, recruiter.id, member.id, companyY, outsider.id]);
  jobX = (await db.admin.query(`INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at, expires_at)
    VALUES ($1, 'magazynier-it', 'Magazynier IT', 'active', 'warehouse', 'permanent', 'Antwerp', 'Flandria', now(), now() + interval '30 days')
    RETURNING id`, [companyX])).rows[0].id;
  application = (await db.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status, locale)
    VALUES ($1, $2, $3, 'submitted', 'pl') RETURNING id`, [jobX, anna.id, companyX])).rows[0].id;
});

afterAll(async () => { await realSession.db?.stop(); });

describe('wiadomości na PostgreSQL (#25)', () => {
  it('get_or_create_conversation: strona aplikacji otwiera rozmowę, ponowienie = ta sama', async () => {
    actAs(anna);
    const first = await messagesActions.openConversation({ applicationId: application });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    conversation = first.id;
    expect(await messagesActions.openConversation({ applicationId: application })).toEqual({ ok: true, id: conversation });
    actAs(recruiter);
    expect(await messagesActions.openConversation({ applicationId: application })).toEqual({ ok: true, id: conversation });
    actAs(bartek);
    expect(await messagesActions.openConversation({ applicationId: application })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(null);
    expect(await messagesActions.openConversation({ applicationId: application })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('send_message: retry z tym samym client_message_id = jedna wiadomość, jedno powiadomienie', async () => {
    actAs(anna);
    const key = randomUUID();
    const first = await messagesActions.sendMessage(conversation, 'Dzień dobry, kiedy mogę przyjść?', key);
    const retry = await messagesActions.sendMessage(conversation, 'Dzień dobry, kiedy mogę przyjść?', key);
    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
    const count = await pg().admin.query('SELECT count(*)::int AS n FROM public.messages WHERE conversation_id = $1', [conversation]);
    expect(count.rows[0].n).toBe(1);
    const alerts = await pg().admin.query(
      `SELECT profile_id FROM public.notifications WHERE type = 'message_received' AND entity_id = $1`, [conversation]);
    // Odbiorca = recruiter+ firmy; member bez praw rekrutacyjnych nie dostaje powiadomienia.
    expect(alerts.rows.map((r) => r.profile_id)).toEqual([recruiter.id]);
  });

  it('lista i wątek: kandydatka nie widzi imienia rekrutera, recruiter widzi kandydatkę', async () => {
    actAs(recruiter);
    const reply = await messagesActions.sendMessage(conversation, 'Zapraszamy w czwartek.', randomUUID());
    expect(reply.ok).toBe(true);

    actAs(anna);
    // Od 0014 kandydat nie czyta tabeli `companies` (brak polityki publicznej) — nazwa firmy
    // pod RLS jest niedostępna, więc UI pokazuje neutralną etykietę (tak samo jak przy PostgREST).
    // Imię rekrutera (profil pod RLS) nigdy nie trafia do kandydatki (0023).
    const annaList = await messagesData.getConversationsResult('pl');
    expect(annaList).toMatchObject({ status: 'ready', items: [{ id: conversation, counterpartyName: '', unreadCount: 1, lastPreview: 'Zapraszamy w czwartek.' }] });
    const annaThread = await messagesData.getConversationThread(conversation, 'pl');
    if (annaThread.status !== 'ready') throw new Error(annaThread.status);
    expect(annaThread.thread.messages.map((m) => [m.body, m.mine, m.senderSide, m.senderName])).toEqual([
      ['Dzień dobry, kiedy mogę przyjść?', true, 'candidate', 'Anna Kandydat'],
      ['Zapraszamy w czwartek.', false, 'company', ''],
    ]);

    actAs(recruiter);
    const recruiterThread = await messagesData.getConversationThread(conversation, 'fr');
    if (recruiterThread.status !== 'ready') throw new Error(recruiterThread.status);
    expect(recruiterThread.thread.messages.map((m) => [m.mine, m.senderSide, m.senderName])).toEqual([
      [false, 'candidate', 'Anna Kandydat'],
      [true, 'company', 'Rafał Rekruter'],
    ]);
    const recruiterList = await messagesData.getConversationsResult('fr');
    expect(recruiterList).toMatchObject({ status: 'ready', items: [{ id: conversation, counterpartyName: 'Anna Kandydat', unreadCount: 1 }] });
    expect(await messagesActions.markConversationRead(conversation)).toEqual({ ok: true });
    expect(await messagesData.getConversationsResult('fr')).toMatchObject({ items: [{ unread: false, unreadCount: 0 }] });
  });

  it('obcy kandydat, obca firma, member bez praw i gość nie widzą rozmowy ani nie piszą', async () => {
    for (const who of [bartek, outsider, member]) {
      actAs(who);
      expect(await messagesData.getConversationsResult('pl')).toEqual({ status: 'ready', items: [] });
      expect(await messagesData.getConversationThread(conversation, 'pl')).toEqual({ status: 'not-found' });
      expect(await messagesData.getOlderThreadMessages(conversation, { createdAt: new Date().toISOString(), id: randomUUID() }))
        .toEqual({ status: 'not-found' });
      expect(await messagesActions.sendMessage(conversation, 'Wtrącam się', randomUUID())).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
      expect(await messagesActions.markConversationRead(conversation)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    }
    actAs(null);
    expect(await messagesData.getConversationThread(conversation, 'pl')).toEqual({ status: 'not-found' });
    expect(await messagesData.getConversationsResult('pl')).toEqual({ status: 'ready', items: [] });
  });

  it('stronicowanie wątku: najnowsze najpierw, starsze strony bez luk i duplikatów przy remisach czasu', async () => {
    // 130 wiadomości, parami z identycznym created_at (remis rozstrzyga id).
    await pg().admin.query(`INSERT INTO public.messages(conversation_id, sender_id, body, created_at)
      SELECT $1, CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END, 'seria ' || g,
             timestamptz '2026-01-01 10:00:00.123456+00' + ((g / 2) || ' seconds')::interval
        FROM generate_series(1, 130) g`, [conversation, anna.id, recruiter.id]);
    const expected = (await pg().admin.query(
      `SELECT id FROM public.messages WHERE conversation_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
      [conversation])).rows.map((r) => r.id as string);
    expect(expected).toHaveLength(132);

    actAs(anna);
    const first = await messagesData.getConversationThread(conversation, 'pl');
    if (first.status !== 'ready') throw new Error(first.status);
    expect(first.thread.messages).toHaveLength(messagesData.THREAD_PAGE_SIZE);
    expect(first.thread.messages.map((m) => m.id)).toEqual(expected.slice(-messagesData.THREAD_PAGE_SIZE));
    let loaded = first.thread.messages.map((m) => m.id);
    let cursor = first.thread.olderCursor;
    let pages = 0;
    while (cursor) {
      const page = await messagesData.getOlderThreadMessages(conversation, cursor);
      if (page.status !== 'ready') throw new Error(page.status);
      loaded = [...page.messages.map((m) => m.id), ...loaded];
      cursor = page.olderCursor;
      pages += 1;
    }
    expect(pages).toBe(2);
    expect(loaded).toEqual(expected);
  });
});

describe('zapisane wyszukiwania (#100)', () => {
  const input = {
    name: 'Magazynier · Antwerpia',
    locale: 'pl',
    filters: { keyword: 'magazynier', categories: ['warehouse'] },
    query: '?keyword=magazynier&category=warehouse',
  };
  let savedId: string;

  it('zapis pod sesją kandydata, ponowienie tych samych filtrów = ten sam wiersz', async () => {
    actAs(anna);
    const first = await savedActions.saveSearchAction(input);
    expect(first).toMatchObject({ ok: true, created: true });
    if (!first.ok) return;
    savedId = first.id;
    expect(await savedActions.saveSearchAction(input)).toEqual({ ok: true, id: savedId, created: false });
    expect(await savedData.loadMySavedSearches()).toMatchObject({
      status: 'ready', demo: false, searches: [{ id: savedId, name: input.name, query: input.query }],
    });
  });

  it('tylko własne: inny kandydat nie widzi, nie zmienia i nie usuwa; pracodawca i gość nie zapisują', async () => {
    actAs(bartek);
    expect(await savedData.loadMySavedSearches()).toEqual({ status: 'ready', searches: [], demo: false });
    expect(await savedActions.setSavedSearchAlertsAction(savedId, true, 'weekly')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await savedActions.deleteSavedSearchAction(savedId)).toEqual({ ok: false, error: 'NOT_FOUND' });
    actAs(recruiter);
    expect(await savedActions.saveSearchAction(input)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(null);
    expect(await savedActions.saveSearchAction(input)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('alert i usunięcie przez właściciela', async () => {
    actAs(anna);
    expect(await savedActions.setSavedSearchAlertsAction(savedId, true, 'weekly')).toEqual({ ok: true });
    expect(await savedData.loadMySavedSearches()).toMatchObject({ searches: [{ alertsEnabled: true, frequency: 'weekly' }] });
    expect(await savedActions.deleteSavedSearchAction(savedId)).toEqual({ ok: true });
    expect(await savedData.loadMySavedSearches()).toEqual({ status: 'ready', searches: [], demo: false });
  });
});

describe('blokada firmy (#97)', () => {
  it('kandydatka blokuje firmę: lista, szczegół oferty, blokada wiadomości firmy; inny kandydat bez zmian', async () => {
    actAs(anna);
    expect(await blocksActions.setCompanyBlockAction(companyX, true)).toEqual({ ok: true, blocked: true });
    expect(await blocksData.loadMyCompanyBlocks()).toMatchObject({
      status: 'ready', demo: false, blocks: [{ companyId: companyX, companyName: 'Firma X IT' }],
    });
    expect(await blocksData.getJobCompanyBlock(jobX)).toEqual({ status: 'ready', companyId: companyX, companyName: 'Firma X IT', blocked: true });

    actAs(bartek);
    expect(await blocksData.loadMyCompanyBlocks()).toEqual({ status: 'ready', blocks: [], demo: false });
    expect(await blocksData.getJobCompanyBlock(jobX)).toMatchObject({ status: 'ready', blocked: false });

    // Firma nie pisze do kandydatki, która ją zablokowała; kandydatka nadal może.
    actAs(recruiter);
    expect(await messagesActions.sendMessage(conversation, 'Czy jest Pani dostępna?', randomUUID()))
      .toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await blocksActions.setCompanyBlockAction(companyX, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(anna);
    expect((await messagesActions.sendMessage(conversation, 'Jednak rezygnuję.', randomUUID())).ok).toBe(true);

    expect(await blocksActions.setCompanyBlockAction(companyX, false)).toEqual({ ok: true, blocked: false });
    expect(await blocksData.loadMyCompanyBlocks()).toEqual({ status: 'ready', blocks: [], demo: false });
    actAs(null);
    expect(await blocksData.getJobCompanyBlock(jobX)).toEqual({ status: 'none' });
  });
});

describe('widoczność profilu (#494)', () => {
  it('niekompletny profil nie włączy widoczności; kompletny — tak, stan z bazy, tylko własny', async () => {
    actAs(anna);
    expect(await visibilityData.loadProfileVisibility()).toEqual({
      status: 'ready', demo: false, searchable: false, completed: false, changedAt: null,
    });
    expect(await visibilityActions.setProfileVisibilityAction(true)).toEqual({ ok: false, error: 'ONBOARDING_INCOMPLETE' });

    await pg().admin.query(`INSERT INTO public.candidate_profiles(profile_id, profile_completed) VALUES ($1, true)
      ON CONFLICT (profile_id) DO UPDATE SET profile_completed = true`, [anna.id]);
    const on = await visibilityActions.setProfileVisibilityAction(true);
    expect(on).toMatchObject({ ok: true, searchable: true });
    expect(on.ok && on.changedAt).toBeTruthy();
    expect(await visibilityData.loadProfileVisibility()).toMatchObject({ searchable: true, completed: true });

    actAs(bartek);
    expect(await visibilityData.loadProfileVisibility()).toMatchObject({ status: 'ready', searchable: false });

    actAs(anna);
    expect(await visibilityActions.setProfileVisibilityAction(false)).toMatchObject({ ok: true, searchable: false });
    actAs(recruiter);
    expect(await visibilityActions.setProfileVisibilityAction(false)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(null);
    expect(await visibilityData.loadProfileVisibility()).toEqual({ status: 'error' });
  });
});

describe('receipt zgód (record_consent)', () => {
  it('gość zapisuje jako anon (profil NULL), zalogowany z własnym profilem', async () => {
    const categories = { necessary: true, preferences: false, analytics: true, marketing: false };
    actAs(null);
    expect(await recordConsent(categories, 'cookie_banner')).toEqual({ ok: true });
    actAs(anna);
    expect(await recordConsent(categories, 'cookie_settings')).toEqual({ ok: true });
    const rows = (await pg().admin.query(
      `SELECT profile_id, source, category::text AS category, granted, host(ip_address) AS ip, visitor_id
         FROM public.consents WHERE visitor_id = 'visitor-it' ORDER BY created_at, category`)).rows;
    expect(rows).toHaveLength(8);
    const guest = rows.filter((r) => r.profile_id === null);
    const own = rows.filter((r) => r.profile_id === anna.id);
    expect(guest.map((r) => r.source)).toEqual(Array(4).fill('cookie_banner'));
    expect(own.map((r) => r.source)).toEqual(Array(4).fill('cookie_settings'));
    expect(own.find((r) => r.category === 'analytics')?.granted).toBe(true);
    expect(own.find((r) => r.category === 'marketing')?.granted).toBe(false);
    expect(own[0]!.ip).toBe('203.0.113.9');
  });
});
