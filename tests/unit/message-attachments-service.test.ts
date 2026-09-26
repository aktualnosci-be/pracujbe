// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rpc, rpcRows } from '@/lib/db/sql';
import {
  issueAttachmentDownloadLink,
  isValidAttachmentContent,
  openAttachmentDownload,
  storeMessageAttachment,
  type AttachmentObjectStore,
  type AttachmentServiceDeps,
} from '@/lib/files/message-attachments';
import { createPrivateDownloadToken } from '@/lib/storage/private-download-token';
import { pgError } from '../helpers/fake-db';

/**
 * Serwis załączników wiadomości (0119). Transakcja i RPC zastąpione — dostęp, blokadę firmy,
 * kwarantannę i idempotencję w bazie sprawdza `supabase/tests/rls.sql` (sekcja MA). Tu:
 * walidacja bajtów przed bucketem, brak zapisu bez dostępu, sprzątanie obiektu, podpis linku
 * związany z domeną załączników i ponowna kontrola bazy przy pobraniu.
 */

vi.mock('@/lib/db/transaction', () => ({
  withUserTransaction: vi.fn(async (_pool: unknown, _uid: unknown, action: (tx: unknown) => unknown) => action({})),
}));
vi.mock('@/lib/db/sql', () => ({ rpc: vi.fn(), rpcRows: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const SELF = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CONV = '55555555-5555-4555-8555-555555555555';
const UPLOAD = '66666666-6666-4666-8666-666666666666';
const ATT = '77777777-7777-4777-8777-777777777777';
const SECRET = 'download-secret-for-tests-0123456789abcdef';
const NOW = 1_800_000_000_000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const KEY = `${CONV}/att-88888888-8888-4888-8888-888888888888.png`;

function memoryStore() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const store = {
    put: vi.fn(async ({ key, bytes, contentType }: { key: string; bytes: Uint8Array; contentType: string }) => {
      objects.set(key, { bytes, type: contentType });
      return { ok: true as const, value: { key, sizeBytes: bytes.byteLength, sha256: 'a'.repeat(64) } };
    }),
    delete: vi.fn(async ({ key }: { key: string }) => {
      objects.delete(key);
      return { ok: true as const, value: { deleted: true as const } };
    }),
    openStream: vi.fn(async ({ key }: { key: string }) => {
      const object = objects.get(key);
      if (!object) return { ok: false as const, error: 'NOT_FOUND' as const, retryable: false };
      return {
        ok: true as const,
        value: {
          body: new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(object.bytes); c.close(); } }),
          contentLength: object.bytes.byteLength,
          contentType: object.type,
          close: vi.fn(async () => undefined),
        },
      };
    }),
  };
  return { store, objects };
}

function file(bytes: Uint8Array, type = 'image/png', name = 'zdjęcie.png') {
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
}

let deps: AttachmentServiceDeps;
let objects: Map<string, { bytes: Uint8Array; type: string }>;
let store: ReturnType<typeof memoryStore>['store'];

beforeEach(() => {
  vi.clearAllMocks();
  ({ store, objects } = memoryStore());
  deps = { pool: {} as never, store: store as unknown as AttachmentObjectStore, downloadSecret: SECRET, now: () => NOW };
  vi.mocked(rpc).mockImplementation(async (_tx, fn) => (fn === 'can_attach_in_conversation' ? true : null));
  vi.mocked(rpcRows).mockImplementation(async (_tx, fn) =>
    fn === 'stage_message_attachment' ? [{ attachment_id: ATT, created: true }] : []);
});

describe('treść pliku (magic bytes)', () => {
  it('JPG/PNG po sygnaturze; PDF/DOCX jak CV; zmieniony typ odrzucony', () => {
    expect(isValidAttachmentContent(PNG, 'png')).toBe(true);
    expect(isValidAttachmentContent(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg')).toBe(true);
    expect(isValidAttachmentContent(new TextEncoder().encode('%PDF-1.7'), 'pdf')).toBe(true);
    // Kontrola ujemna: PDF podpisany jako PNG i ZIP bez struktury OOXML jako DOCX.
    expect(isValidAttachmentContent(new TextEncoder().encode('%PDF-1.7'), 'png')).toBe(false);
    expect(isValidAttachmentContent(Uint8Array.from([0x50, 0x4b, 3, 4]), 'docx')).toBe(false);
  });
});

describe('storeMessageAttachment', () => {
  it('zapisuje obiekt pod kluczem rozmowy i metadane przez RPC (scan_status=skipped)', async () => {
    const result = await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG));
    expect(result).toEqual({ ok: true, id: ATT });
    const key = store.put.mock.calls[0]![0].key;
    expect(key).toMatch(new RegExp(`^${CONV}/att-[0-9a-f-]{36}\\.png$`));
    expect(vi.mocked(rpcRows).mock.calls[0]![2]).toMatchObject({
      p_conversation_id: CONV,
      p_client_upload_id: UPLOAD,
      p_path: key,
      p_file_name: 'zdjęcie.png',
      p_mime_type: 'image/png',
      p_size_bytes: PNG.byteLength,
      p_scan_status: 'skipped',
    });
    expect(objects.has(key)).toBe(true);
  });

  it('zła sygnatura, zbyt duży plik i obcy typ — bez zapisu w buckecie', async () => {
    const pdfAsPng = new TextEncoder().encode('%PDF-1.7');
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(pdfAsPng))).toEqual({
      ok: false, error: 'VALIDATION_FAILED', reason: 'type',
    });
    const big = { ...file(PNG), size: 5 * 1024 * 1024 + 1 };
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, big)).toMatchObject({ reason: 'tooLarge' });
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG, 'image/gif'))).toMatchObject({ reason: 'type' });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('nazwa pliku z numerem PESEL/eID (#495) — bez kontroli dostępu i zapisu w buckecie', async () => {
    for (const name of ['skan_44051401359.png', 'eid 591-2345678-29.png']) {
      expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG, 'image/png', name))).toEqual({
        ok: false, error: 'VALIDATION_FAILED', reason: 'sensitiveId',
      });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    // Kontrola ujemna: ta sama treść pod zwykłą nazwą trafia do bucketu.
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG, 'image/png', 'skan.png'))).toEqual({ ok: true, id: ATT });
    expect(store.put).toHaveBeenCalledOnce();
  });

  it('bez dostępu do rozmowy (np. blokada firmy) nic nie trafia do bucketu', async () => {
    vi.mocked(rpc).mockResolvedValue(false);
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG))).toEqual({
      ok: false, error: 'PERMISSION_DENIED',
    });
    expect(store.put).not.toHaveBeenCalled();
    expect(rpcRows).not.toHaveBeenCalled();
  });

  it('ponowienie tego samego uploadu zwraca istniejący załącznik i usuwa zbędny obiekt', async () => {
    vi.mocked(rpcRows).mockResolvedValue([{ attachment_id: ATT, created: false }]);
    expect(await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG))).toEqual({ ok: true, id: ATT });
    expect(store.delete).toHaveBeenCalledWith({ key: store.put.mock.calls[0]![0].key });
    expect(objects.size).toBe(0);
  });

  it('odrzucenie metadanych przez bazę usuwa obiekt i zwraca kod bez szczegółów', async () => {
    vi.mocked(rpcRows).mockRejectedValue(pgError('22023', 'VALIDATION_FAILED: limit przygotowanych załączników'));
    const result = await storeMessageAttachment(deps, SELF, CONV, UPLOAD, file(PNG));
    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(objects.size).toBe(0);
  });

  it('niepoprawne identyfikatory — bez bazy i bucketu', async () => {
    expect(await storeMessageAttachment(deps, SELF, 'x', UPLOAD, file(PNG))).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('link i pobranie', () => {
  const record = { id: ATT, conversation_id: CONV, path: KEY, file_name: 'zdjęcie.png', mime_type: 'image/png', size_bytes: PNG.byteLength };

  beforeEach(() => {
    objects.set(KEY, { bytes: PNG, type: 'image/png' });
    vi.mocked(rpcRows).mockImplementation(async (_tx, fn) => (fn === 'get_message_attachment_download' ? [record] : []));
  });

  it('link → trasa strumieniuje plik jako załącznik z sandbox CSP', async () => {
    const link = await issueAttachmentDownloadLink(deps, SELF, ATT);
    expect(link.ok).toBe(true);
    const url = new URL((link as { url: string }).url, 'https://pracuj.be');
    expect(url.pathname).toBe(`/api/files/message/${ATT}`);
    const response = await openAttachmentDownload(deps, SELF, ATT, url.searchParams.get('t')!);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('podpis innego użytkownika albo z domeny CV (ten sam sekret) nie otwiera załącznika', async () => {
    const other = createPrivateDownloadToken(ATT, OTHER, { secret: `${SECRET}:message-attachment`, now: () => NOW });
    expect((await openAttachmentDownload(deps, SELF, ATT, other)).status).toBe(404);
    const cvToken = createPrivateDownloadToken(ATT, SELF, { secret: SECRET, now: () => NOW });
    expect((await openAttachmentDownload(deps, SELF, ATT, cvToken)).status).toBe(404);
    expect(store.openStream).not.toHaveBeenCalled();
  });

  it('utrata dostępu po wystawieniu linku (kwarantanna/blokada/usunięcie) → 404', async () => {
    const link = await issueAttachmentDownloadLink(deps, SELF, ATT);
    const token = new URL((link as { url: string }).url, 'https://x').searchParams.get('t')!;
    vi.mocked(rpcRows).mockResolvedValue([]);
    expect((await openAttachmentDownload(deps, SELF, ATT, token)).status).toBe(404);
    expect(store.openStream).not.toHaveBeenCalled();
  });

  it('niespójny rekord (klucz spoza rozmowy albo MIME ≠ rozszerzenie) → brak pobrania', async () => {
    const link = await issueAttachmentDownloadLink(deps, SELF, ATT);
    const token = new URL((link as { url: string }).url, 'https://x').searchParams.get('t')!;
    vi.mocked(rpcRows).mockResolvedValue([{ ...record, path: `${OTHER}/cv-88888888-8888-4888-8888-888888888888.pdf`, mime_type: 'application/pdf' }]);
    expect((await openAttachmentDownload(deps, SELF, ATT, token)).status).toBe(503);
    vi.mocked(rpcRows).mockResolvedValue([{ ...record, mime_type: 'application/pdf' }]);
    expect((await openAttachmentDownload(deps, SELF, ATT, token)).status).toBe(503);
    expect(store.openStream).not.toHaveBeenCalled();
  });

  it('obiekt niezgodny z metadanymi (rozmiar) → 503 bez treści', async () => {
    vi.mocked(rpcRows).mockResolvedValue([{ ...record, size_bytes: PNG.byteLength + 1 }]);
    const link = await issueAttachmentDownloadLink(deps, SELF, ATT);
    const token = new URL((link as { url: string }).url, 'https://x').searchParams.get('t')!;
    const response = await openAttachmentDownload(deps, SELF, ATT, token);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('niewidoczny załącznik → brak linku', async () => {
    vi.mocked(rpcRows).mockResolvedValue([]);
    expect(await issueAttachmentDownloadLink(deps, SELF, ATT)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
