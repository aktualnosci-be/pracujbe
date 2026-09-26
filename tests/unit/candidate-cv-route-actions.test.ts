// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/files/cv/[id]/route';
import { deleteCandidateFile, prepareCvDownload, uploadCandidateCv } from '@/lib/actions/files';
import { isProductionMode } from '@/lib/env';
import {
  issueCvDownloadLink,
  openCvDownload,
  removeCandidateCv,
  storeCandidateCv,
} from '@/lib/files/candidate-cv';
import { getCvServiceDeps, readCandidateSession } from '@/lib/files/runtime';
import { checkRateLimit } from '@/lib/rate-limit';

/** Granica akcji i trasy pobrania CV (#26): tożsamość tylko z sesji, odmowy bez szczegółów. */

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ cookie: 'session=fixture' })) }));
vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/files/runtime', () => ({ getCvServiceDeps: vi.fn(), readCandidateSession: vi.fn() }));
vi.mock('@/lib/files/candidate-cv', async (original) => ({
  ...(await original<typeof import('@/lib/files/candidate-cv')>()),
  storeCandidateCv: vi.fn(),
  removeCandidateCv: vi.fn(),
  issueCvDownloadLink: vi.fn(),
  openCvDownload: vi.fn(),
}));

const SELF = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const deps = { pool: {}, store: {}, downloadSecret: 'x'.repeat(32) } as never;

function form(file: File | string = new File(['%PDF-1.7'], 'cv.pdf', { type: 'application/pdf' })) {
  const data = new FormData();
  data.append('file', file);
  return data;
}

function get(url = `https://pracuj.be/api/files/cv/${FILE_ID}?t=signed`) {
  return GET(new Request(url, { headers: { cookie: 'session=fixture' } }), {
    params: Promise.resolve({ id: FILE_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isProductionMode).mockReturnValue(false);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getCvServiceDeps).mockResolvedValue(deps);
  vi.mocked(readCandidateSession).mockResolvedValue({ status: 'candidate', id: SELF });
});

describe('akcje CV', () => {
  it('upload przekazuje plik i kandydata z sesji do serwisu', async () => {
    vi.mocked(storeCandidateCv).mockResolvedValue({ ok: true, id: FILE_ID });
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: true, id: FILE_ID });
    expect(vi.mocked(storeCandidateCv).mock.calls[0]![1]).toBe(SELF);
    expect(vi.mocked(readCandidateSession).mock.calls[0]![1].get('cookie')).toBe('session=fixture');
  });

  it('bez bucketu: poza produkcją DEMO_UNAVAILABLE (bez fikcyjnego sukcesu), w produkcji INTERNAL', async () => {
    vi.mocked(getCvServiceDeps).mockResolvedValue(null);
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    vi.mocked(isProductionMode).mockReturnValue(true);
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: false, error: 'INTERNAL' });
    await expect(prepareCvDownload(FILE_ID)).resolves.toEqual({ ok: false, error: 'INTERNAL' });
    await expect(deleteCandidateFile(FILE_ID)).resolves.toEqual({ ok: false, error: 'INTERNAL' });
    expect(storeCandidateCv).not.toHaveBeenCalled();
  });

  it.each(['anonymous', 'forbidden'] as const)('sesja %s → PERMISSION_DENIED bez operacji', async (status) => {
    vi.mocked(readCandidateSession).mockResolvedValue({ status });
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    await expect(prepareCvDownload(FILE_ID)).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    await expect(deleteCandidateFile(FILE_ID)).resolves.toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(storeCandidateCv).not.toHaveBeenCalled();
    expect(issueCvDownloadLink).not.toHaveBeenCalled();
    expect(removeCandidateCv).not.toHaveBeenCalled();
  });

  it('limit i walidacja metadanych przed sesją', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: false, error: 'RATE_LIMITED' });
    await expect(uploadCandidateCv(form('text'))).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'empty',
    });
    expect(readCandidateSession).not.toHaveBeenCalled();
  });

  it('awaria sesji/bazy → INTERNAL, bez rzucania do UI', async () => {
    vi.mocked(readCandidateSession).mockRejectedValue(new Error('pg: connection to 10.0.0.1 failed'));
    await expect(uploadCandidateCv(form())).resolves.toEqual({ ok: false, error: 'INTERNAL' });
    await expect(deleteCandidateFile(FILE_ID)).resolves.toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('pobranie i usunięcie przekazują ID pliku i kandydata z sesji', async () => {
    vi.mocked(issueCvDownloadLink).mockResolvedValue({ ok: true, url: '/api/files/cv/x?t=y' });
    vi.mocked(removeCandidateCv).mockResolvedValue({ ok: true });
    await expect(prepareCvDownload(FILE_ID)).resolves.toEqual({ ok: true, url: '/api/files/cv/x?t=y' });
    await expect(deleteCandidateFile(FILE_ID)).resolves.toEqual({ ok: true });
    expect(issueCvDownloadLink).toHaveBeenCalledWith(deps, SELF, FILE_ID);
    expect(removeCandidateCv).toHaveBeenCalledWith(deps, SELF, FILE_ID);
  });
});

describe('GET /api/files/cv/[id]', () => {
  it('kandydat z sesji: przekazuje ID, podpis i sygnał żądania', async () => {
    vi.mocked(openCvDownload).mockResolvedValue(new Response('pdf', { status: 200 }));
    const response = await get();
    expect(response.status).toBe(200);
    const [passedDeps, user, id, token, signal] = vi.mocked(openCvDownload).mock.calls[0]!;
    expect([passedDeps, user, id, token]).toEqual([deps, SELF, FILE_ID, 'signed']);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['anonymous', 'forbidden'] as const)('sesja %s → 404 bez treści, nawet z podpisem', async (status) => {
    vi.mocked(readCandidateSession).mockResolvedValue({ status });
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(openCvDownload).not.toHaveBeenCalled();
  });

  it('bez konfiguracji → 404; awaria → 503 bez szczegółów', async () => {
    vi.mocked(getCvServiceDeps).mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    vi.mocked(readCandidateSession).mockRejectedValueOnce(new Error('secret-in-error'));
    const failed = await get();
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('');
  });
});
