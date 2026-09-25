import 'server-only';

import type { ErrorCode } from '@/lib/errors';
import { AiBudgetError } from '@/lib/ai/budget-error';
import { ExtractorError } from '@/lib/ai-import/extract';
import type { CvExtractor } from '@/lib/cv-import/extract';
import { minimizeCvText } from '@/lib/cv-import/minimize';
import { mapCvExtraction } from '@/lib/cv-import/proposals';
import { CV_TEXT_MAX_CHARS, extractCvText, type CvTextProblem } from '@/lib/cv-import/text';
import type { CvProposal, CvRedactionSummary } from '@/lib/cv-import/types';

/**
 * Rdzeń importu CV (#487, #498) bez autoryzacji i zapisu — te robi akcja serwerowa.
 * Dwa etapy, żeby kandydat widział i potwierdził zakres danych, ZANIM cokolwiek wyjdzie
 * do dostawcy AI:
 *
 *   1. `prepareCvImport` — lokalnie: plik → tekst → minimalizacja. Bez modelu i bez kosztu.
 *      Wynik (zredagowany tekst + liczniki) wraca do przeglądarki kandydata jako podgląd.
 *   2. `proposeFromCv` — po potwierdzeniu: tekst jest PONOWNIE minimalizowany na serwerze
 *      (wejście z przeglądarki jest niezaufane; redakcja jest idempotentna), dopiero wtedy
 *      trafia do modelu, a odpowiedź jest walidowana (`mapCvExtraction`).
 *
 * Żaden etap nie zapisuje pliku, tekstu ani propozycji.
 */

export type PrepareCvResult =
  | { ok: true; text: string; summary: CvRedactionSummary }
  | { ok: false; error: ErrorCode; reason?: CvTextProblem };

export type ProposeCvResult =
  | { ok: true; proposals: CvProposal[]; suspicious: boolean }
  | { ok: false; error: ErrorCode };

export async function prepareCvImport(bytes: Uint8Array, declaredType: string): Promise<PrepareCvResult> {
  const extracted = await extractCvText(bytes, declaredType);
  if (!extracted.ok) {
    const noText = extracted.problem === 'noText' || extracted.problem === 'unsupported' || extracted.problem === 'unreadable';
    return { ok: false, error: noText ? 'CV_IMPORT_NO_TEXT' : 'CV_IMPORT_INVALID_FILE', reason: extracted.problem };
  }
  return minimizeForModel(extracted.text);
}

function minimizeForModel(text: string): PrepareCvResult {
  const minimized = minimizeCvText(text);
  if (!minimized.ok) {
    if (minimized.reason === 'identifier') return { ok: false, error: 'CV_IMPORT_SENSITIVE_DATA' };
    if (minimized.reason === 'uncertain') return { ok: false, error: 'CV_IMPORT_UNCERTAIN' };
    return { ok: false, error: 'CV_IMPORT_NO_TEXT' };
  }
  if (minimized.text.replace(/\s/g, '').length < 40) return { ok: false, error: 'CV_IMPORT_NO_TEXT' };
  return { ok: true, text: minimized.text, summary: minimized.counts };
}

export async function proposeFromCv(text: string, extractor: CvExtractor): Promise<ProposeCvResult> {
  if (typeof text !== 'string' || text.length === 0 || text.length > CV_TEXT_MAX_CHARS) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const prepared = minimizeForModel(text);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  let raw: unknown;
  try {
    raw = await extractor.extract(prepared.text);
  } catch (e) {
    // #36: budżet przekroczony lub niedostępny — model nie został wywołany (fail-closed).
    if (e instanceof AiBudgetError) return { ok: false, error: 'AI_BUDGET_EXCEEDED' };
    if (e instanceof ExtractorError && e.reason === 'rateLimited') return { ok: false, error: 'RATE_LIMITED' };
    return { ok: false, error: 'CV_IMPORT_FAILED' };
  }

  const mapped = mapCvExtraction(raw, prepared.text);
  if (mapped.sensitiveIdentifier) return { ok: false, error: 'CV_IMPORT_SENSITIVE_DATA' };
  if (!mapped.isCv) return { ok: false, error: 'CV_IMPORT_NOT_A_CV' };
  if (mapped.proposals.length === 0) return { ok: false, error: 'CV_IMPORT_NO_PROPOSALS' };
  return { ok: true, proposals: mapped.proposals, suspicious: mapped.suspicious };
}
