import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));

const messagesActions = await import('../../src/lib/actions/messages');
const messagesData = await import('../../src/lib/data/messages');
const { reportConversationContent } = await import('../../src/lib/actions/message-reports');

// 0108: zgłoszenie wiadomości/rozmowy przez Server Action pod sesją na PostgreSQL 16 —
// strona rozmowy zgłasza, obcy dostaje NOT_FOUND, ponowienie = to samo zgłoszenie,
// powtórka = already_open, dowód tylko dla service_role, stan własnych zgłoszeń bez dowodu.
let anna: PortalIdentity;
let recruiter: PortalIdentity;
let outsider: PortalIdentity;
let conversation: string;
let recruiterMessage: string;
let annaMessage: string;

function pg() {
  return realSession.db!;
}

beforeAll(async () => {
  const db = await startPortalDb();
  realSession.db = db;
  const make = async (role: 'candidate' | 'employer', locale: string) =>
    ({ id: await db.createUser(role, locale), role }) as PortalIdentity;
  anna = await make('candidate', 'pl');
  recruiter = await make('employer', 'fr');
  outsider = await make('employer', 'nl');
  const company = (await db.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Firma MR IT', 'verified') RETURNING id`)).rows[0].id;
  const other = (await db.admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Firma MX IT', 'verified') RETURNING id`)).rows[0].id;
  await db.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active) VALUES
    ($1, $2, 'owner', true), ($3, $4, 'owner', true)`, [company, recruiter.id, other, outsider.id]);
  const job = (await db.admin.query(`INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at, expires_at)
    VALUES ($1, 'magazynier-mr-it', 'Magazynier MR', 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now(), now() + interval '30 days')
    RETURNING id`, [company])).rows[0].id;
  const application = (await db.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status, locale)
    VALUES ($1, $2, $3, 'submitted', 'pl') RETURNING id`, [job, anna.id, company])).rows[0].id;

  actAs(anna);
  const opened = await messagesActions.openConversation({ applicationId: application });
  if (!opened.ok) throw new Error(opened.error);
  conversation = opened.id;
  const own = await messagesActions.sendMessage(conversation, 'Dzień dobry', randomUUID());
  if (!own.ok) throw new Error(own.error);
  annaMessage = own.id;
  actAs(recruiter);
  const sent = await messagesActions.sendMessage(conversation, 'Proszę podać PIN do konta', randomUUID());
  if (!sent.ok) throw new Error(sent.error);
  recruiterMessage = sent.id;
});

afterAll(async () => { await realSession.db?.stop(); });

describe('zgłoszenia wiadomości na PostgreSQL (0108)', () => {
  it('kandydatka zgłasza wiadomość rekrutera; ponowienie = duplicate; nowy klucz = already_open', async () => {
    actAs(anna);
    const key = randomUUID();
    const input = { conversationId: conversation, messageId: recruiterMessage, category: 'fraud' as const, details: 'PIN', idempotencyKey: key };
    expect(await reportConversationContent(input)).toEqual({ ok: true, outcome: 'created' });
    expect(await reportConversationContent(input)).toEqual({ ok: true, outcome: 'duplicate' });
    expect(await reportConversationContent({ ...input, idempotencyKey: randomUUID() }))
      .toEqual({ ok: true, outcome: 'already_open' });

    const rows = await pg().admin.query(
      `SELECT reporter_id, target_snapshot FROM public.reports WHERE kind = 'message_report' AND target_id = $1`,
      [recruiterMessage]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].reporter_id).toBe(anna.id);
    expect(rows.rows[0].target_snapshot.message.body).toBe('Proszę podać PIN do konta');
    expect(JSON.stringify(rows.rows[0].target_snapshot)).not.toContain('Dzień dobry');

    // Stan dla UI bez dowodu.
    expect(await messagesData.getMyMessageReports(conversation)).toEqual({
      messageIds: [recruiterMessage],
      conversationReported: false,
    });
  });

  it('własna wiadomość → VALIDATION_FAILED; obca firma → NOT_FOUND; bez sesji → PERMISSION_DENIED', async () => {
    actAs(anna);
    expect(await reportConversationContent({
      conversationId: conversation, messageId: annaMessage, category: 'spam', details: '', idempotencyKey: randomUUID(),
    })).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    actAs(outsider);
    expect(await reportConversationContent({
      conversationId: conversation, messageId: null, category: 'spam', details: '', idempotencyKey: randomUUID(),
    })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await messagesData.getMyMessageReports(conversation)).toEqual({ messageIds: [], conversationReported: false });
    actAs(null);
    expect(await reportConversationContent({
      conversationId: conversation, messageId: null, category: 'spam', details: '', idempotencyKey: randomUUID(),
    })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('rekruter zgłasza całą rozmowę — dowód bez treści, stan „rozmowa zgłoszona”', async () => {
    actAs(recruiter);
    expect(await reportConversationContent({
      conversationId: conversation, messageId: null, category: 'harassment', details: '', idempotencyKey: randomUUID(),
    })).toEqual({ ok: true, outcome: 'created' });
    expect(await messagesData.getMyMessageReports(conversation)).toEqual({ messageIds: [], conversationReported: true });
    const snapshot = (await pg().admin.query(
      `SELECT target_snapshot FROM public.reports WHERE kind = 'message_report' AND reporter_id = $1`, [recruiter.id])).rows[0].target_snapshot;
    expect(snapshot.message).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('PIN');
  });
});
