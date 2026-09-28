// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { withClassifiedsMode } from '../helpers/portal-mode';

/**
 * #1134 / #1138 — decyzja produktowa: portal ogłoszeniowy. W trybie ogłoszeniowym (domyślnym):
 * - akcje wiadomości i załączników zwracają `RECRUITMENT_DISABLED` bez bazy, limitera i bucketu;
 * - loadery rozmów nie pytają bazy (lista pusta, licznik 0, wątek = brak);
 * - `/api/files/message/<id>` = 404 także z ważnym tokenem (bez sesji i bucketu);
 * - upload CV nie robi PUT ani INSERT (akcja i serwis), a pobranie/usunięcie własnego CV działa;
 * - import CV przez AI: brak dostawcy mimo `AI_CV_IMPORT_ENABLED`, akcje bez modelu i budżetu.
 * Każdy blok ma kontrolę ujemną w trybie `RECRUITMENT` (ta sama ścieżka dochodzi do atrapy).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (original) => ({
  ...(await original<typeof import('@/lib/env')>()),
  isProductionMode: vi.fn(() => false),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ cookie: 'session=fixture' })) }));
vi.mock('@/lib/files/runtime', () => ({
  getAttachmentServiceDeps: vi.fn(async () => null),
  getCvServiceDeps: vi.fn(async () => null),
  readSessionUserId: vi.fn(async () => null),
  readCandidateSession: vi.fn(async () => ({ status: 'anonymous' })),
}));
vi.mock('@/lib/ai/budget', async (original) => ({
  ...(await original<typeof import('@/lib/ai/budget')>()),
  withAiBudget: vi.fn(),
}));

const { checkRateLimit } = await import('@/lib/rate-limit');
const runtime = await import('@/lib/files/runtime');
const { withAiBudget } = await import('@/lib/ai/budget');
const messages = await import('@/lib/actions/messages');
const attachments = await import('@/lib/actions/message-attachments');
const data = await import('@/lib/data/messages');
const { GET: attachmentRoute } = await import('@/app/api/files/message/[id]/route');
const files = await import('@/lib/actions/files');
const { storeCandidateCv } = await import('@/lib/files/candidate-cv');
const cvImport = await import('@/lib/actions/cv-import');
const cvConfig = await import('@/lib/cv-import/config');
const { emailTargetPath } = await import('@/lib/email/delivery-data');

const USER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const APPLICATION = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT = '77777777-7777-4777-8777-777777777777';

const recruitment = () => vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
const DISABLED = { ok: false, error: 'RECRUITMENT_DISABLED' };

function pdfForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('file', new File(['%PDF-1.7 test'], 'cv.pdf', { type: 'application/pdf' }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

withClassifiedsMode();

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  for (const fn of ['get_or_create_conversation', 'send_message']) fakeDb.rpc(fn, 'row-1');
  fakeDb.rpc('mark_conversation_read', null);
  process.env.AI_CV_IMPORT_ENABLED = '1';
  process.env.AI_CV_IMPORT_PROVIDER = 'fixture';
});
afterEach(() => {
  delete process.env.AI_CV_IMPORT_ENABLED;
  delete process.env.AI_CV_IMPORT_PROVIDER;
});

describe('#1134: akcje wiadomości', () => {
  it('tryb ogłoszeniowy: RECRUITMENT_DISABLED bez bazy i limitera', async () => {
    await expect(messages.openConversation({ applicationId: APPLICATION })).resolves.toEqual(DISABLED);
    await expect(messages.sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_ID)).resolves.toEqual(DISABLED);
    await expect(messages.markConversationRead(CONVERSATION)).resolves.toEqual(DISABLED);
    await expect(
      messages.loadOlderMessages('pl', CONVERSATION, { createdAt: '2026-09-28T10:00:00Z', id: CLIENT_ID }),
    ).resolves.toEqual({ status: 'not-found' });
    expect(fakeDb.calls).toEqual([]);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: tryb RECRUITMENT dochodzi do RPC pod sesją', async () => {
    recruitment();
    await expect(messages.openConversation({ applicationId: APPLICATION })).resolves.toEqual({ ok: true, id: 'row-1' });
    await expect(messages.sendMessage(CONVERSATION, 'Dzień dobry', CLIENT_ID)).resolves.toEqual({ ok: true, id: 'row-1' });
    expect(fakeDb.callsTo('get_or_create_conversation')).toHaveLength(1);
    expect(fakeDb.callsTo('send_message')).toHaveLength(1);
  });
});

describe('#1134: załączniki wiadomości', () => {
  it('tryb ogłoszeniowy: upload/usunięcie/link = RECRUITMENT_DISABLED bez bucketu i bazy', async () => {
    const fd = pdfForm({ conversationId: CONVERSATION, clientUploadId: CLIENT_ID });
    await expect(attachments.uploadMessageAttachment(fd)).resolves.toEqual(DISABLED);
    await expect(attachments.discardMessageAttachment(ATTACHMENT)).resolves.toEqual(DISABLED);
    await expect(attachments.prepareMessageAttachmentDownload(ATTACHMENT)).resolves.toEqual(DISABLED);
    expect(runtime.getAttachmentServiceDeps).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT sięga po zależności bucketu', async () => {
    recruitment();
    await attachments.uploadMessageAttachment(pdfForm({ conversationId: CONVERSATION, clientUploadId: CLIENT_ID }));
    expect(runtime.getAttachmentServiceDeps).toHaveBeenCalledTimes(1);
  });

  it('/api/files/message/<id> z tokenem = 404 bez sesji i bucketu', async () => {
    const res = await attachmentRoute(new Request(`https://pracuj.be/api/files/message/${ATTACHMENT}?t=signed`), {
      params: Promise.resolve({ id: ATTACHMENT }),
    });
    expect(res.status).toBe(404);
    expect(runtime.getAttachmentServiceDeps).not.toHaveBeenCalled();
    expect(runtime.readSessionUserId).not.toHaveBeenCalled();
  });

  it('kontrola ujemna trasy: tryb RECRUITMENT sprawdza zależności', async () => {
    recruitment();
    await attachmentRoute(new Request(`https://pracuj.be/api/files/message/${ATTACHMENT}?t=signed`), {
      params: Promise.resolve({ id: ATTACHMENT }),
    });
    expect(runtime.getAttachmentServiceDeps).toHaveBeenCalledTimes(1);
  });
});

describe('#1134: loadery rozmów', () => {
  it('tryb ogłoszeniowy: bez zapytań — lista pusta, licznik 0, wątek niedostępny', async () => {
    await expect(data.getConversationsResult('pl')).resolves.toEqual({ status: 'ready', items: [] });
    await expect(data.getUnreadConversationsCount('pl')).resolves.toBe(0);
    await expect(data.getConversationThread(CONVERSATION, 'pl')).resolves.toEqual({ status: 'not-found' });
    await expect(data.getOlderThreadMessages(CONVERSATION, { createdAt: '2026-09-28T10:00:00Z', id: CLIENT_ID }))
      .resolves.toEqual({ status: 'not-found' });
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT czyta członkostwa z bazy', async () => {
    recruitment();
    await data.getConversationsResult('pl');
    expect(fakeDb.calls.length).toBeGreaterThan(0);
  });

  it('linki z e-maila i powiadomień nie prowadzą do 404', async () => {
    const { resolveHref } = await import('@/lib/data/notifications');
    expect(resolveHref('conversation', 'candidate', CONVERSATION)).toBe('/candidate');
    expect(resolveHref('conversation', 'employer', CONVERSATION)).toBe('/employer');
    expect(emailTargetPath('newMessage', { panel: 'employer', conversationId: CONVERSATION })).toBe('/employer');
  });
});

describe('#1138: CV kandydata', () => {
  const store = { put: vi.fn(), delete: vi.fn(), openStream: vi.fn() };
  const deps = { pool: {}, store, downloadSecret: 'x'.repeat(32) } as never;
  const PDF = new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF\n');
  const cv = { name: 'cv.pdf', type: 'application/pdf', size: PDF.byteLength, arrayBuffer: async () => PDF.slice().buffer } as never;

  it('tryb ogłoszeniowy: upload bez limitera, sesji, PUT i INSERT (akcja i serwis)', async () => {
    await expect(files.uploadCandidateCv(pdfForm())).resolves.toEqual(DISABLED);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(runtime.getCvServiceDeps).not.toHaveBeenCalled();
    await expect(storeCandidateCv(deps, USER, cv)).resolves.toEqual(DISABLED);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: tryb RECRUITMENT — serwis zapisuje obiekt w buckecie', async () => {
    recruitment();
    store.put.mockResolvedValue({ ok: false, error: 'FORBIDDEN' });
    await storeCandidateCv(deps, USER, cv);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('pobranie i usunięcie własnego CV nadal przechodzą do serwisu (prawa do danych)', async () => {
    await files.prepareCvDownload('44444444-4444-4444-8444-444444444444');
    await files.deleteCandidateFile('44444444-4444-4444-8444-444444444444');
    expect(runtime.getCvServiceDeps).toHaveBeenCalledTimes(2);
  });
});

describe('#1138: import CV przez AI', () => {
  it('tryb ogłoszeniowy: brak dostawcy mimo AI_CV_IMPORT_ENABLED; akcje bez modelu i budżetu', async () => {
    expect(cvConfig.cvImportProvider()).toBeNull();
    expect(cvConfig.isCvImportEnabled()).toBe(false);
    await expect(cvImport.prepareCvImportAction(pdfForm())).resolves.toEqual(DISABLED);
    await expect(cvImport.proposeFromCvAction('Magazynier, 5 lat')).resolves.toEqual(DISABLED);
    await expect(cvImport.applyCvProposals({ occupations: ['Magazynier'], skills: [], languages: [], certificates: [], experienceYears: null }))
      .resolves.toEqual(DISABLED);
    expect(withAiBudget).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT + flaga = dostawca aktywny', () => {
    recruitment();
    expect(cvConfig.cvImportProvider()).toBe('fixture');
  });
});
