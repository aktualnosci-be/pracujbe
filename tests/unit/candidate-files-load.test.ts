import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCandidateFiles } from '@/lib/data/candidate-files';
import { isFileStorageConfigured, isProductionMode } from '@/lib/env';
import { getCvServiceDeps, readCandidateSession } from '@/lib/files/runtime';
import { listCandidateCvs } from '@/lib/files/candidate-cv';

vi.mock('@/lib/env', () => ({ isFileStorageConfigured: vi.fn(), isProductionMode: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/files/runtime', () => ({ getCvServiceDeps: vi.fn(), readCandidateSession: vi.fn() }));
vi.mock('@/lib/files/candidate-cv', () => ({ listCandidateCvs: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const deps = { pool: {}, store: {}, downloadSecret: 'x'.repeat(32) } as never;
const SELF = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFileStorageConfigured).mockReturnValue(true);
  vi.mocked(isProductionMode).mockReturnValue(true);
  vi.mocked(getCvServiceDeps).mockResolvedValue(deps);
  vi.mocked(readCandidateSession).mockResolvedValue({ status: 'candidate', id: SELF });
});

describe('loadCandidateFiles (#331, #26)', () => {
  it('błąd repozytorium to stan błędu, a nie pusta lista', async () => {
    vi.mocked(listCandidateCvs).mockRejectedValue(new Error('boom'));
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'error' });
  });

  it.each(['anonymous', 'forbidden'] as const)('sesja %s to stan błędu', async (status) => {
    vi.mocked(readCandidateSession).mockResolvedValue({ status });
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'error' });
    expect(listCandidateCvs).not.toHaveBeenCalled();
  });

  it('czyta listę dla kandydata z sesji, bez URL i klucza obiektu', async () => {
    const items = [
      { id: 'a', fileName: 'a.pdf', downloadable: true },
      { id: 'b', fileName: 'b.pdf', downloadable: false },
    ];
    vi.mocked(listCandidateCvs).mockResolvedValue(items);
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'ready', items });
    expect(listCandidateCvs).toHaveBeenCalledExactlyOnceWith(deps, SELF);
  });

  it('bez bucketu poza produkcją: gotowa pusta lista (tryb demo)', async () => {
    vi.mocked(isFileStorageConfigured).mockReturnValue(false);
    vi.mocked(isProductionMode).mockReturnValue(false);
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'ready', items: [] });
  });

  it('bez bucketu w produkcji: błąd (fail-closed), bez odczytu sesji', async () => {
    vi.mocked(isFileStorageConfigured).mockReturnValue(false);
    await expect(loadCandidateFiles()).resolves.toEqual({ status: 'error' });
    expect(readCandidateSession).not.toHaveBeenCalled();
  });
});
