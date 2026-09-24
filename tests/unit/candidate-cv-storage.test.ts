// @vitest-environment node
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOwnCandidateCv,
  deleteOwnCandidateCv,
  getOwnDownloadableCv,
  type CandidateCvMetadata,
} from '@/lib/db/candidate-files';
import { AppError } from '@/lib/errors';
import {
  issueCvDownloadLink,
  openCvDownload,
  removeCandidateCv,
  storeCandidateCv,
  type CvServiceDeps,
} from '@/lib/files/candidate-cv';
import { createPrivateDownloadToken } from '@/lib/storage/private-download-token';
import { createRailwayBucket } from '@/lib/storage/railway-bucket';

/**
 * Serwis CV na prywatnym buckecie (#26). Bucket = rzeczywisty adapter i SDK S3 z transportem
 * w pamięci (bez sieci), repozytorium metadanych zastąpione — jego RLS/własność/kwarantannę
 * sprawdza `tests/integration/candidate-files.test.ts` na PostgreSQL.
 */

vi.mock('@/lib/db/candidate-files', () => ({
  createOwnCandidateCv: vi.fn(),
  deleteOwnCandidateCv: vi.fn(),
  getOwnDownloadableCv: vi.fn(),
  listOwnCandidateFiles: vi.fn(),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const SELF = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = 'download-secret-for-tests-0123456789abcdef';
const NOW = 1_800_000_000_000;

interface S3Request { method: string; path: string; headers: Record<string, string>; body?: unknown }

/** Minimalny S3 w pamięci: PUT (z If-None-Match), GET, DELETE; opcjonalne awarie per metoda. */
function memoryS3() {
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const fail: Partial<Record<string, number>> = {};
  const calls: string[] = [];
  const xml = (status: number, code: string) => ({
    response: {
      statusCode: status,
      headers: { 'content-type': 'application/xml' },
      body: Readable.from([`<Error><Code>${code}</Code></Error>`]),
    },
  });
  const handle = vi.fn(async (request: S3Request) => {
    const key = decodeURIComponent(request.path.replace(/^\//, ''));
    calls.push(`${request.method} ${key}`);
    const status = fail[request.method];
    if (status) return xml(status, status === 503 ? 'ServiceUnavailable' : 'AccessDenied');
    if (request.method === 'PUT') {
      if (objects.has(key) && request.headers['if-none-match'] === '*') return xml(412, 'PreconditionFailed');
      const body = request.body as Uint8Array;
      objects.set(key, { bytes: Buffer.from(body), type: request.headers['content-type'] ?? '' });
      return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
    }
    if (request.method === 'GET') {
      const object = objects.get(key);
      if (!object) return xml(404, 'NoSuchKey');
      return {
        response: {
          statusCode: 200,
          headers: { 'content-length': String(object.bytes.length), 'content-type': object.type },
          body: Readable.from([object.bytes]),
        },
      };
    }
    if (request.method === 'DELETE') {
      objects.delete(key);
      return { response: { statusCode: 204, headers: {}, body: Readable.from([]) } };
    }
    return xml(400, 'BadRequest');
  });
  const store = createRailwayBucket({
    endpoint: 'https://storage.example.com',
    bucket: 'private-cvs',
    region: 'auto',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    requestHandler: { handle } as never,
  });
  return { objects, fail, calls, store };
}

function pdfFile(name = 'Moje CV.pdf', bytes = Buffer.from('%PDF-1.7\nfixture'), declared?: number) {
  return {
    name,
    type: 'application/pdf',
    size: declared ?? bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function metadata(key: string, overrides: Partial<CandidateCvMetadata> = {}): CandidateCvMetadata {
  return {
    id: FILE_ID,
    ownerId: SELF,
    bucket: 'candidate-files',
    key,
    fileName: 'Żółć CV.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 16,
    scanStatus: 'skipped',
    checksumSha256: null,
    ...overrides,
  };
}

let s3: ReturnType<typeof memoryS3>;
let deps: CvServiceDeps;
beforeEach(() => {
  vi.clearAllMocks();
  s3 = memoryS3();
  deps = { pool: {} as never, store: s3.store, downloadSecret: SECRET, now: () => NOW };
});

describe('upload CV do prywatnego bucketu', () => {
  it('zapisuje bajty pod kluczem właściciela z sesji i metadane z checksumą', async () => {
    const bytes = Buffer.from('%PDF-1.7\nfixture');
    vi.mocked(createOwnCandidateCv).mockImplementation(async (_pool, _user, input) =>
      metadata(input.key, { sizeBytes: input.sizeBytes }),
    );
    await expect(storeCandidateCv(deps, SELF, pdfFile('Moje\u0007 CV.pdf', bytes))).resolves.toEqual({
      ok: true,
      id: FILE_ID,
    });
    const input = vi.mocked(createOwnCandidateCv).mock.calls[0]![2];
    expect(vi.mocked(createOwnCandidateCv).mock.calls[0]![1]).toBe(SELF);
    expect(input).toMatchObject({
      fileName: 'Moje CV.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      scanStatus: 'skipped',
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(input.key.startsWith(`${SELF}/cv-`)).toBe(true);
    expect(input.key).not.toContain('Moje');
    expect(s3.objects.get(input.key)?.bytes.equals(bytes)).toBe(true);
  });

  it.each([
    ['PNG udający PDF', pdfFile('cv.pdf', Buffer.from('\x89PNG....'))],
    ['ZIP udający DOCX', {
      name: 'cv.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 20,
      arrayBuffer: async () => new TextEncoder().encode('PK\x03\x04 random.txt').buffer,
    }],
  ])('%s: odrzucony przed zapisem w buckecie', async (_label, file) => {
    await expect(storeCandidateCv(deps, SELF, file)).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'type',
    });
    expect(s3.calls).toEqual([]);
    expect(createOwnCandidateCv).not.toHaveBeenCalled();
  });

  it('rozmiar liczy z bajtów, nie z deklaracji klienta', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
    big.write('%PDF');
    await expect(storeCandidateCv(deps, SELF, pdfFile('cv.pdf', big, 1024))).resolves.toMatchObject({
      ok: false,
      reason: 'tooLarge',
    });
    expect(s3.calls).toEqual([]);
  });

  it('awaria bucketu: brak metadanych i błąd bez szczegółów; niepewny PUT jest sprzątany', async () => {
    s3.fail.PUT = 503;
    await expect(storeCandidateCv(deps, SELF, pdfFile())).resolves.toEqual({ ok: false, error: 'INTERNAL' });
    expect(createOwnCandidateCv).not.toHaveBeenCalled();
    expect(s3.calls.map((call) => call.split(' ')[0])).toEqual(['PUT', 'DELETE']);
  });

  it.each([
    [new AppError('PERMISSION_DENIED'), 'PERMISSION_DENIED'],
    [new Error('pg: duplicate key "Moje CV.pdf"'), 'INTERNAL'],
  ] as const)('błąd INSERT metadanych usuwa zapisany obiekt (sierota) → %s', async (error, code) => {
    vi.mocked(createOwnCandidateCv).mockRejectedValue(error);
    await expect(storeCandidateCv(deps, SELF, pdfFile())).resolves.toEqual({ ok: false, error: code });
    expect(s3.objects.size).toBe(0);
  });

  it('klucza nie da się zbudować dla nie-UUID (tożsamość tylko z sesji)', async () => {
    await expect(storeCandidateCv(deps, '../other', pdfFile())).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(s3.calls).toEqual([]);
  });
});

describe('usuwanie CV', () => {
  const key = `${SELF}/cv-22222222-2222-4222-8222-222222222222.pdf`;

  it('najpierw rekord pod RLS, potem obiekt w buckecie', async () => {
    s3.objects.set(key, { bytes: Buffer.from('%PDF'), type: 'application/pdf' });
    vi.mocked(deleteOwnCandidateCv).mockResolvedValue(metadata(key));
    await expect(removeCandidateCv(deps, SELF, FILE_ID)).resolves.toEqual({ ok: true });
    expect(deleteOwnCandidateCv).toHaveBeenCalledWith(deps.pool, SELF, FILE_ID);
    expect(s3.objects.has(key)).toBe(false);
  });

  it('cudzy/usunięty rekord → NOT_FOUND bez operacji na buckecie', async () => {
    vi.mocked(deleteOwnCandidateCv).mockResolvedValue(null);
    await expect(removeCandidateCv(deps, SELF, FILE_ID)).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    await expect(removeCandidateCv(deps, SELF, 'not-a-uuid')).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(s3.calls).toEqual([]);
  });

  it('awaria usunięcia obiektu nie cofa sukcesu (rekord już usunięty, obiekt niedostępny)', async () => {
    vi.mocked(deleteOwnCandidateCv).mockResolvedValue(metadata(key));
    s3.fail.DELETE = 503;
    await expect(removeCandidateCv(deps, SELF, FILE_ID)).resolves.toEqual({ ok: true });
    expect(s3.calls.filter((call) => call.startsWith('DELETE'))).toHaveLength(2);
  });
});

describe('pobranie CV przez podpisany link aplikacji', () => {
  const key = `${SELF}/cv-22222222-2222-4222-8222-222222222222.pdf`;
  const bytes = Buffer.from('%PDF-1.7\nfixture');

  beforeEach(() => {
    s3.objects.set(key, { bytes, type: 'application/pdf' });
    vi.mocked(getOwnDownloadableCv).mockResolvedValue(metadata(key, { sizeBytes: bytes.length }));
  });

  function token(fileId = FILE_ID, userId = SELF, now = NOW) {
    return createPrivateDownloadToken(fileId, userId, { secret: SECRET, now: () => now });
  }

  it('link nie zawiera adresu S3 ani klucza, a jego podpis przyjmuje trasa', async () => {
    const link = await issueCvDownloadLink(deps, SELF, FILE_ID);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.url).toMatch(new RegExp(`^/api/files/cv/${FILE_ID}\\?t=v1\\.`));
    expect(link.url).not.toContain('storage.example.com');
    expect(link.url).not.toContain(key);
    const t = new URL(link.url, 'https://pracuj.be').searchParams.get('t')!;
    const response = await openCvDownload(deps, SELF, FILE_ID, t);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="____ CV.pdf"; filename*=UTF-8''%C5%BB%C3%B3%C5%82%C4%87%20CV.pdf`,
    );
  });

  it('plik niedopuszczony (kwarantanna/cudzy/usunięty) nie dostaje linku', async () => {
    vi.mocked(getOwnDownloadableCv).mockResolvedValue(null);
    await expect(issueCvDownloadLink(deps, SELF, FILE_ID)).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it.each([
    ['podpis innego użytkownika', () => token(FILE_ID, OTHER)],
    ['podpis innego pliku', () => token('55555555-5555-4555-8555-555555555555')],
    ['wygasły podpis', () => token(FILE_ID, SELF, NOW - 61_000)],
    ['podpis innym sekretem', () => createPrivateDownloadToken(FILE_ID, SELF, { secret: 'x'.repeat(40), now: () => NOW })],
    ['brak podpisu', () => ''],
  ])('%s → 404 bez odczytu bazy i bucketu', async (_label, make) => {
    const response = await openCvDownload(deps, SELF, FILE_ID, make());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(getOwnDownloadableCv).not.toHaveBeenCalled();
    expect(s3.calls).toEqual([]);
  });

  it('usunięcie rekordu lub kwarantanna unieważnia wcześniej wystawiony link', async () => {
    const valid = token();
    vi.mocked(getOwnDownloadableCv).mockResolvedValue(null);
    expect((await openCvDownload(deps, SELF, FILE_ID, valid)).status).toBe(404);
    expect(s3.calls).toEqual([]);
  });

  it('obiekt niezgodny z metadanymi (rozmiar) → 503, bez treści', async () => {
    vi.mocked(getOwnDownloadableCv).mockResolvedValue(metadata(key, { sizeBytes: bytes.length + 1 }));
    const response = await openCvDownload(deps, SELF, FILE_ID, token());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('brak obiektu → 404; odmowa bucketu → 503', async () => {
    s3.objects.clear();
    expect((await openCvDownload(deps, SELF, FILE_ID, token())).status).toBe(404);
    s3.fail.GET = 403;
    expect((await openCvDownload(deps, SELF, FILE_ID, token())).status).toBe(503);
  });

  it('awaria bazy → 503; odmowa konta → 404', async () => {
    vi.mocked(getOwnDownloadableCv).mockRejectedValueOnce(new AppError('INTERNAL'));
    expect((await openCvDownload(deps, SELF, FILE_ID, token())).status).toBe(503);
    vi.mocked(getOwnDownloadableCv).mockRejectedValueOnce(new AppError('PERMISSION_DENIED'));
    expect((await openCvDownload(deps, SELF, FILE_ID, token())).status).toBe(404);
  });
});
