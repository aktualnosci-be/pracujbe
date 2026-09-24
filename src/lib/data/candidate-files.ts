/**
 * Dokumenty kandydata (CV) z jawnym wynikiem odczytu (#331), z prywatnego bucketu Railway (#26).
 *
 * Błąd odczytu listy NIE jest pustą listą: kandydat uznałby, że CV zniknęło, i wgrał je ponownie
 * (duplikaty w `files` i buckecie). Loader zwraca `ready` z pozycjami albo `error`.
 * Lista nie zawiera URL ani klucza obiektu: pobranie wystawia na kliknięcie akcja
 * `prepareCvDownload` (krótki podpisany link, Invariant #10). `downloadable=false` = plik
 * w kwarantannie (`pending`/`infected`/nieznany stan skanu).
 */

import { isFileStorageConfigured, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';

export interface CandidateFileItem {
  id: string;
  fileName: string;
  downloadable: boolean;
}

export type CandidateFilesLoad =
  | { status: 'ready'; items: CandidateFileItem[] }
  | { status: 'error' };

export async function loadCandidateFiles(): Promise<CandidateFilesLoad> {
  // Poza produkcją bez bucketu: panel demo bez dokumentów. Produkcja bez konfiguracji = błąd.
  if (!isFileStorageConfigured()) {
    return isProductionMode() ? { status: 'error' } : { status: 'ready', items: [] };
  }
  try {
    const [{ headers }, { getCvServiceDeps, readCandidateSession }, { listCandidateCvs }] =
      await Promise.all([
        import('next/headers'),
        import('@/lib/files/runtime'),
        import('@/lib/files/candidate-cv'),
      ]);
    const deps = await getCvServiceDeps();
    if (!deps) return { status: 'error' };
    const session = await readCandidateSession(deps.pool, new Headers(await headers()));
    if (session.status !== 'candidate') return { status: 'error' };
    return { status: 'ready', items: await listCandidateCvs(deps, session.id) };
  } catch (error) {
    captureError(error, { area: 'candidate-files.loadCandidateFiles' });
    return { status: 'error' };
  }
}
