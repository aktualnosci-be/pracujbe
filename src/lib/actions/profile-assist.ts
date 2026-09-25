'use server';

import { getPortalIdentity, isPortalDataConfigured, isServiceDatabaseConfigured } from '@/lib/db/portal';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { withAiBudget } from '@/lib/ai/budget';
import { withAiUsageLog, type AiUsageOutcome } from '@/lib/ai/usage-log';
import { ExtractorError, type ExtractionHooks } from '@/lib/ai-import/extract';
import { applyApprovedProposals, type ApplyCvProposalsResult } from '@/lib/cv-import/apply';
import type { CvRedactionCounts } from '@/lib/cv-import/minimize';
import type { CvProposal } from '@/lib/cv-import/types';
import { profileAssistModel, profileAssistProvider } from '@/lib/profile-assist/config';
import { estimateProfileAssistCost } from '@/lib/profile-assist/cost';
import { AnthropicProfileAssistor, FixtureProfileAssistor, type ProfileAssistor } from '@/lib/profile-assist/extract';
import { checkProfileAnswers, proposeFromAnswers } from '@/lib/profile-assist/run';

/**
 * Asystent budowania profilu kandydata (#37, „profil z odpowiedzi”) — dwie akcje, żadna nie
 * zapisuje nic bez decyzji kandydata:
 *
 *   1. `proposeProfileFromAnswers` — odpowiedzi kandydata (własnymi słowami) → minimalizacja
 *      → globalny budżet AI (#36) → model → walidacja → PROPOZYCJE. Nic nie jest zapisywane.
 *   2. `applyProfileAssistProposals` — wyłącznie pozycje zaznaczone przez kandydata → wspólny
 *      zapis z importem CV (`apply_candidate_cv_proposals`, dopisanie pod RLS).
 *
 * Autoryzacja: konto KANDYDATA z sesji serwera; właściciela nie przyjmujemy od klienta.
 * Limit wywołań modelu per konto (fail-closed). Odpowiedzi i propozycje nie są zapisywane,
 * logowane ani wysyłane do telemetrii. Wynik nie wpływa na dopasowanie, status ani widoczność
 * kandydata (strażnik `tests/unit/ai-inventory.test.ts`).
 */

export type ProposeProfileResult =
  | { ok: true; demo?: boolean; proposals: CvProposal[]; removed: CvRedactionCounts }
  | { ok: false; error: ErrorCode };

export type { ApplyCvProposalsResult };

const PROPOSE_HOURLY_MAX = 10;
const PROPOSE_DAILY_MAX = 30;

type Gate = { ok: true; userId: string | null } | { ok: false; error: ErrorCode };

async function requireCandidate(provider: 'anthropic' | 'fixture'): Promise<Gate> {
  if (!isPortalDataConfigured()) {
    return provider === 'fixture' ? { ok: true, userId: null } : { ok: false, error: 'DEMO_UNAVAILABLE' };
  }
  const me = await getPortalIdentity();
  if (!me || me.role !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true, userId: me.id };
}

const classify = (r: { ok: true } | { ok: false; error: unknown }): AiUsageOutcome =>
  r.ok
    ? 'ok'
    : r.error instanceof ExtractorError && r.error.reason === 'refused'
      ? 'refused'
      : r.error instanceof ExtractorError && r.error.reason === 'rateLimited'
        ? 'rate_limited'
        : 'failed';

export async function proposeProfileFromAnswers(answers: unknown): Promise<ProposeProfileResult> {
  const provider = profileAssistProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };

  try {
    const gate = await requireCandidate(provider);
    if (!gate.ok) return gate;
    // Walidacja i minimalizacja PRZED limiterem i budżetem: odrzucone wejście nic nie kosztuje.
    const checked = checkProfileAnswers(answers);
    if (!checked.ok) return checked;
    if (gate.userId) {
      for (const [action, max, windowSeconds] of [
        ['profile-assist', PROPOSE_HOURLY_MAX, 3600],
        ['profile-assist-day', PROPOSE_DAILY_MAX, 86_400],
      ] as const) {
        const allowed = await checkRateLimit(action, { identifier: gate.userId, perIp: false, max, windowSeconds });
        if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
      }
    }

    const base = provider === 'fixture' ? new FixtureProfileAssistor() : new AnthropicProfileAssistor();
    const model = provider === 'fixture' ? 'fixture' : profileAssistModel();
    // Log użycia bez treści i PII (#489): wynik, rodzaj wejścia, model, czas.
    const logged: ProfileAssistor = {
      extract: (text: string, hooks?: ExtractionHooks) =>
        withAiUsageLog(
          { feature: 'profile_answers_assist', inputKind: 'text', model },
          () => base.extract(text, hooks),
          classify,
        ),
    };
    // Globalny budżet AI (#36): płatny dostawca ZAWSZE przez rezerwację (bez bazy zadań
    // serwerowych = odmowa); atrapa przez budżet tylko wtedy, gdy baza jest dostępna.
    const assistor: ProfileAssistor =
      provider === 'fixture' && !isServiceDatabaseConfigured()
        ? logged
        : {
            extract: (text: string) =>
              withAiBudget(
                { feature: 'profile_answers_assist', model, estimateMicroUsd: estimateProfileAssistCost(text, model) },
                (reportUsage) => logged.extract(text, { onUsage: reportUsage }),
                classify,
              ),
          };

    const result = await proposeFromAnswers(answers, assistor);
    if (!result.ok) return result;
    return { ok: true, proposals: result.proposals, removed: result.removed, ...(gate.userId ? {} : { demo: true }) };
  } catch (e) {
    captureError(e, { area: 'profile-assist', step: 'propose' });
    return { ok: false, error: 'INTERNAL' };
  }
}

export async function applyProfileAssistProposals(input: unknown): Promise<ApplyCvProposalsResult> {
  if (!profileAssistProvider()) return { ok: false, error: 'NOT_FOUND' };
  return applyApprovedProposals(input, 'profile-assist');
}
