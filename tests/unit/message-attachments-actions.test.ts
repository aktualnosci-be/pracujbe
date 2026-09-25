// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/files/message/[id]/route';
import {
  discardMessageAttachment,
  prepareMessageAttachmentDownload,
  uploadMessageAttachment,
} from '@/lib/actions/message-attachments';
import { getPortalIdentity } from '@/lib/db/portal';
import { isProductionMode } from '@/lib/env';
import {
  discardStagedAttachment,
  issueAttachmentDownloadLink,
  openAttachmentDownload,
  storeMessageAttachment,
} from '@/lib/files/message-attachments';
import { getAttachmentServiceDeps, readSessionUserId } from '@/lib/files/runtime';
import { checkRateLimit } from '@/lib/rate-limit';

/** Granica akcji i trasy pobrania załączników (0113): tożsamość tylko z sesji, odmowy bez szczegółów. */

vi.mock('@/lib/db/portal', () => ({ getPortalIdentity: vi.fn() }));
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/files/runtime', () => ({ getAttachmentServiceDeps: vi.fn(), readSessionUserId: vi.fn() }));
vi.mock('@/lib/files/message-attachments', async (original) => ({
  ...(await original<typeof import('@/lib/files/message-attachments')>()),
  storeMessageAttachment: vi.fn(),
  discardStagedAttachment: vi.fn(),
  issueAttachmentDownloadLink: vi.fn(),
  openAttachmentDownload: vi.fn(),
}));

const SELF = '11111111-1111-4111-8111-111111111111';
const CONV = '55555555-5555-4555-8555-555555555555';
const UPLOAD = '66666666-6666-4666-8666-666666666666';
const ATT = '77777777-7777-4777-8777-777777777777';
const deps = { pool: {}, store: {}, downloadSecret: 'x'.repeat(32) } as never;

function form(file: File | string = new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' }), fields: Record<string, string> = {}) {
  const data = new FormData();
  data.set('conversationId', fields.conversationId ?? CONV);
  data.set('clientUploadId', fields.clientUploadId ?? UPLOAD);
  data.set('file', file);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getAttachmentServiceDeps).mockResolvedValue(deps);
  vi.mocked(getPortalIdentity).mockResolvedValue({ id: SELF, role: 'employer' });
  vi.mocked(isProductionMode).mockReturnValue(false);
});

describe('uploadMessageAttachment', () => {
  it('przekazuje użytkownika z sesji, rozmowę i klucz operacji', async () => {
    vi.mocked(storeMessageAttachment).mockResolvedValue({ ok: true, id: ATT });
    expect(await uploadMessageAttachment(form())).toEqual({ ok: true, id: ATT });
    expect(storeMessageAttachment).toHaveBeenCalledWith(deps, SELF, CONV, UPLOAD, expect.any(File));
  });

  it('zły plik lub identyfikatory — bez sesji, limitu i bucketu', async () => {
    expect(await uploadMessageAttachment(form(new File([], 'a.png', { type: 'image/png' })))).toMatchObject({ reason: 'empty' });
    expect(await uploadMessageAttachment(form(new File(['x'], 'a.exe', { type: 'application/x-msdownload' })))).toMatchObject({ reason: 'type' });
    expect(await uploadMessageAttachment(form('tekst'))).toMatchObject({ reason: 'empty' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(await uploadMessageAttachment(form(undefined, { conversationId: 'x' }))).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(storeMessageAttachment).not.toHaveBeenCalled();
  });

  it('limit, brak sesji, brak bucketu (demo / produkcja fail-closed)', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await uploadMessageAttachment(form())).toEqual({ ok: false, error: 'RATE_LIMITED' });
    vi.mocked(getPortalIdentity).mockResolvedValueOnce(null);
    expect(await uploadMessageAttachment(form())).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    vi.mocked(getAttachmentServiceDeps).mockResolvedValue(null);
    expect(await uploadMessageAttachment(form())).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    vi.mocked(isProductionMode).mockReturnValue(true);
    expect(await uploadMessageAttachment(form())).toEqual({ ok: false, error: 'INTERNAL' });
    expect(storeMessageAttachment).not.toHaveBeenCalled();
  });
});

describe('discard / link', () => {
  it('niepoprawne ID → NOT_FOUND bez serwisu; poprawne → sesja', async () => {
    expect(await discardMessageAttachment('x')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await prepareMessageAttachmentDownload('x')).toEqual({ ok: false, error: 'NOT_FOUND' });
    vi.mocked(discardStagedAttachment).mockResolvedValue({ ok: true });
    vi.mocked(issueAttachmentDownloadLink).mockResolvedValue({ ok: true, url: '/api/files/message/x?t=y' });
    expect(await discardMessageAttachment(ATT)).toEqual({ ok: true });
    expect(await prepareMessageAttachmentDownload(ATT)).toEqual({ ok: true, url: '/api/files/message/x?t=y' });
    expect(discardStagedAttachment).toHaveBeenCalledWith(deps, SELF, ATT);
    expect(issueAttachmentDownloadLink).toHaveBeenCalledWith(deps, SELF, ATT);
  });
});

describe('GET /api/files/message/[id]', () => {
  const get = () =>
    GET(new Request(`https://pracuj.be/api/files/message/${ATT}?t=signed`), { params: Promise.resolve({ id: ATT }) });

  it('sesja z nagłówków żądania → serwis z tokenem', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(SELF);
    vi.mocked(openAttachmentDownload).mockResolvedValue(new Response('ok'));
    expect((await get()).status).toBe(200);
    expect(openAttachmentDownload).toHaveBeenCalledWith(deps, SELF, ATT, 'signed', expect.anything());
  });

  it('bez sesji albo bez bucketu → 404; awaria → 503 bez treści', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    vi.mocked(getAttachmentServiceDeps).mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    vi.mocked(readSessionUserId).mockRejectedValue(new Error('db down 10.0.0.1'));
    const failed = await get();
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('');
    expect(openAttachmentDownload).not.toHaveBeenCalled();
  });
});
