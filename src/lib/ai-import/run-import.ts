import 'server-only';

import type { ErrorCode } from '@/lib/errors';
import { ExtractorError, type ExtractionInput, type JobExtractor } from '@/lib/ai-import/extract';
import { checkImportImageBytes, type ImportImageProblem } from '@/lib/ai-import/image';
import { mapExtraction, type MappedImport } from '@/lib/ai-import/map';
import { listingSourceLabel, minimizeListingText } from '@/lib/ai-import/minimize';
import {
  parsePublicUrl,
  safeFetchListing,
  SafeFetchError,
  type SafeFetchResult,
} from '@/lib/ai-import/safe-fetch';

/**
 * Rdzeń importu ogłoszenia (#465) bez autoryzacji i zapisu — te robi akcja serwerowa.
 * Zależności (ekstraktor, pobieranie) są wstrzykiwane, więc testy nie wykonują żadnych
 * prawdziwych wywołań sieci ani API.
 */

export type ImportSource =
  | { kind: 'image'; bytes: Uint8Array; declaredType: string }
  | { kind: 'url'; url: string };

export type RunImportResult =
  | { ok: true; mapped: MappedImport }
  | { ok: false; error: ErrorCode; reason?: ImportImageProblem };

export interface RunImportDeps {
  extractor: JobExtractor;
  fetchListing?: (url: string) => Promise<SafeFetchResult>;
}

/** Sprawdzenie źródła bez sieci (typ/rozmiar/sygnatura pliku, składnia i host adresu). */
export function precheckSource(source: ImportSource): { ok: true } | { ok: false; error: ErrorCode; reason?: ImportImageProblem } {
  if (source.kind === 'image') {
    const checked = checkImportImageBytes(source.bytes, source.declaredType);
    return checked.ok ? { ok: true } : { ok: false, error: 'JOB_IMPORT_INVALID_FILE', reason: checked.problem };
  }
  try {
    parsePublicUrl(source.url);
    return { ok: true };
  } catch {
    return { ok: false, error: 'JOB_IMPORT_INVALID_URL' };
  }
}

function fetchErrorCode(e: unknown): ErrorCode {
  if (e instanceof SafeFetchError) {
    return e.problem === 'invalidUrl' || e.problem === 'blockedAddress'
      ? 'JOB_IMPORT_INVALID_URL'
      : 'JOB_IMPORT_FETCH_FAILED';
  }
  return 'JOB_IMPORT_FETCH_FAILED';
}

export async function runJobImport(source: ImportSource, deps: RunImportDeps): Promise<RunImportResult> {
  const pre = precheckSource(source);
  if (!pre.ok) return pre;

  let input: ExtractionInput;
  if (source.kind === 'image') {
    const checked = checkImportImageBytes(source.bytes, source.declaredType);
    if (!checked.ok) return { ok: false, error: 'JOB_IMPORT_INVALID_FILE', reason: checked.problem };
    input = { kind: 'image', mediaType: checked.type, base64: Buffer.from(source.bytes).toString('base64') };
  } else {
    let fetched: SafeFetchResult;
    try {
      fetched = await (deps.fetchListing ?? safeFetchListing)(source.url);
    } catch (e) {
      return { ok: false, error: fetchErrorCode(e) };
    }
    if (fetched.kind === 'image') {
      const checked = checkImportImageBytes(fetched.bytes, fetched.mediaType);
      if (!checked.ok) return { ok: false, error: 'JOB_IMPORT_FETCH_FAILED' };
      input = { kind: 'image', mediaType: checked.type, base64: fetched.bytes.toString('base64') };
    } else {
      // #500/#495: e-maile, telefony i numery identyfikacyjne usuwamy PRZED wysłaniem do
      // dostawcy; w prompcie tylko nazwa hosta (bez ścieżki, parametrów i fragmentu).
      const minimized = minimizeListingText(fetched.text).text;
      if (minimized.trim().length < 40) return { ok: false, error: 'JOB_IMPORT_NOT_A_LISTING' };
      input = { kind: 'text', text: minimized, source: listingSourceLabel(fetched.url) };
    }
  }

  let raw: unknown;
  try {
    raw = await deps.extractor.extract(input);
  } catch (e) {
    if (e instanceof ExtractorError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'JOB_IMPORT_FAILED' };
  }

  const mapped = mapExtraction(raw);
  // #495: numer NISS/BIS, PESEL lub dokumentu w odpowiedzi (np. ze zrzutu, którego nie da się
  // zredagować lokalnie) — odmowa całego importu, nic nie trafia do formularza ani szkicu.
  if (mapped.sensitiveIdentifier) return { ok: false, error: 'JOB_IMPORT_SENSITIVE_DATA' };
  if (!mapped.isJobListing) return { ok: false, error: 'JOB_IMPORT_NOT_A_LISTING' };
  if (Object.keys(mapped.values).length === 0) return { ok: false, error: 'JOB_IMPORT_NOT_A_LISTING' };
  return { ok: true, mapped };
}
