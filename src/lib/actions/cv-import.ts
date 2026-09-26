'use server';

import {
  getPortalIdentity,
  isPortalDataConfigured,
  isServiceDatabaseConfigured,
} from '@/lib/db/portal';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { withAiBudget } from '@/lib/ai/budget';
import { withAiUsageLog, type AiUsageOutcome } from '@/lib/ai/usage-log';
import { ExtractorError, type ExtractionHooks } from '@/lib/ai-import/extract';
import { cvImportModel, cvImportProvider } from '@/lib/cv-import/config';
import { estimateCvImportCost } from '@/lib/cv-import/cost';
import { AnthropicCvExtractor, FixtureCvExtractor } from '@/lib/cv-import/extract';
import { applyApprovedProposals, type ApplyCvProposalsResult } from '@/lib/cv-import/apply';
import { prepareCvImport, proposeFromCv } from '@/lib/cv-import/run';
import type { CvTextProblem } from '@/lib/cv-import/text';
import type { CvProposal, CvRedactionSummary } from '@/lib/cv-import/types';
import { CV_MAX_BYTES } from '@/lib/validation/cv-file';

/**
 * Import CV przez AI (#487, #498) — trzy osobne akcje, żadna nie zapisuje nic bez decyzji
 * kandydata:
 *
 *   1. `prepareCvImportAction` — plik → tekst → minimalizacja LOKALNIE (bez modelu). Wraca
 *      zredagowany tekst i liczniki usuniętych fragmentów do podglądu.
 *   2. `proposeFromCvAction` — po potwierdzeniu zakresu przez kandydata: ponowna redakcja na
 *      serwerze, wywołanie modelu, walidacja → PROPOZYCJE (nic nie jest zapisywane).
 *   3. `applyCvProposals` — wyłącznie pozycje zaznaczone przez kandydata → jedno RPC
 *      `apply_candidate_cv_proposals` (0115: dopisanie w jednej transakcji, limity).
 *
 * Autoryzacja: zalogowane konto KANDYDATA z sesji serwera (`getPortalIdentity`, rola z bazy);
 * zapis pod RLS jako ten użytkownik (`withPortalTransaction`) — import dotyczy wyłącznie
 * własnego profilu, właściciela nie przyjmujemy od klienta.
 * Limit wywołań modelu per konto (fail-closed, bo każde wywołanie kosztuje).
 * Plik, tekst CV i propozycje nie są zapisywane, logowane ani wysyłane do telemetrii — przy
 * błędzie do kanału błędów trafia wyłącznie obszar/krok (`captureError` wysyła sam kod błędu, #508).
 * Przepływ nie tworzy rekordu `files` i nie udostępnia CV firmom.
 */

export type PrepareCvImportResult =
  | { ok: true; demo?: boolean; text: string; summary: CvRedactionSummary }
  | { ok: false; error: ErrorCode; reason?: CvTextProblem };

export type ProposeFromCvResult =
  | { ok: true; demo?: boolean; proposals: CvProposal[]; suspicious: boolean }
  | { ok: false; error: ErrorCode };

export type { ApplyCvProposalsResult };

const PROPOSE_HOURLY_MAX = 5;
const PROPOSE_DAILY_MAX = 10;

type Gate = { ok: true; userId: string | null } | { ok: false; error: ErrorCode };

/** Konto kandydata z sesji; w trybie demo (bez backendu) tylko z atrapą dostawcy. */
async function requireCandidate(provider: 'anthropic' | 'fixture'): Promise<Gate> {
  if (!isPortalDataConfigured()) {
    return provider === 'fixture' ? { ok: true, userId: null } : { ok: false, error: 'DEMO_UNAVAILABLE' };
  }
  const me = await getPortalIdentity();
  if (!me || me.role !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true, userId: me.id };
}

export async function prepareCvImportAction(formData: FormData): Promise<PrepareCvImportResult> {
  const provider = cvImportProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };
  if (!(formData instanceof FormData)) return { ok: false, error: 'VALIDATION_FAILED' };
  const file = formData.get('file');
  if (!file || typeof file === 'string') return { ok: false, error: 'CV_IMPORT_INVALID_FILE', reason: 'empty' };
  // Rozmiar przed wczytaniem treści — za duży plik nie jest nawet czytany.
  if (file.size > CV_MAX_BYTES) return { ok: false, error: 'CV_IMPORT_INVALID_FILE', reason: 'tooLarge' };

  try {
    const gate = await requireCandidate(provider);
    if (!gate.ok) return gate;
    if (gate.userId) {
      // Lokalne parsowanie jest tanie, ale ograniczamy nadużycia parsera.
      const allowed = await checkRateLimit('cv-import-parse', { identifier: gate.userId, max: 20, windowSeconds: 3600 });
      if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
    }
    const result = await prepareCvImport(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!result.ok) return result;
    return { ...result, ...(gate.userId ? {} : { demo: true }) };
  } catch (e) {
    captureError(e, { area: 'cv-import', step: 'prepare' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function proposeFromCvAction(text: unknown): Promise<ProposeFromCvResult> {
  const provider = cvImportProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };
  if (typeof text !== 'string') return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const gate = await requireCandidate(provider);
    if (!gate.ok) return gate;
    if (gate.userId) {
      for (const [action, max, windowSeconds] of [
        ['cv-import', PROPOSE_HOURLY_MAX, 3600],
        ['cv-import-day', PROPOSE_DAILY_MAX, 86_400],
      ] as const) {
        const allowed = await checkRateLimit(action, { identifier: gate.userId, perIp: false, max, windowSeconds });
        if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
      }
    }
    // Log użycia bez treści i PII (#489, src/lib/ai/usage-log.ts): wynik, rodzaj wejścia, model, czas.
    const base = provider === 'fixture' ? new FixtureCvExtractor() : new AnthropicCvExtractor();
    const model = provider === 'fixture' ? 'fixture' : cvImportModel();
    const classify = (r: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome =>
      r.ok
        ? 'ok'
        : r.error instanceof ExtractorError && r.error.reason === 'refused'
          ? 'refused'
          : r.error instanceof ExtractorError && r.error.reason === 'rateLimited'
            ? 'rate_limited'
            : 'failed';
    const logged = {
      extract: (minimized: string, hooks?: ExtractionHooks) =>
        withAiUsageLog(
          { feature: 'cv_profile_import' as const, inputKind: 'text' as const, model },
          () => base.extract(minimized, hooks),
          classify,
        ),
    };
    // Globalny budżet AI (#36): płatny dostawca ZAWSZE przez rezerwację (bez bazy zadań
    // serwerowych = odmowa); atrapa przez budżet tylko wtedy, gdy baza jest dostępna.
    const extractor =
      provider === 'fixture' && !isServiceDatabaseConfigured()
        ? logged
        : {
            extract: (minimized: string) =>
              withAiBudget(
                { feature: 'cv_profile_import', model, estimateMicroUsd: estimateCvImportCost(minimized, model) },
                (reportUsage) => logged.extract(minimized, { onUsage: reportUsage }),
                classify,
              ),
          };
    const result = await proposeFromCv(text, extractor);
    if (!result.ok) return result;
    return { ...result, ...(gate.userId ? {} : { demo: true }) };
  } catch (e) {
    captureError(e, { area: 'cv-import', step: 'propose' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function applyCvProposals(input: unknown): Promise<ApplyCvProposalsResult> {
  if (!cvImportProvider()) return { ok: false, error: 'NOT_FOUND' };
  return applyApprovedProposals(input, 'cv-import');
}
