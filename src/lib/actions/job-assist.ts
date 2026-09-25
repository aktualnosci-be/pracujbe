'use server';

import { getActiveCompany } from '@/lib/company-context';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { AnthropicJobAssistor, FixtureJobAssistor } from '@/lib/ai-assist/assist';
import { aiBudgetGate } from '@/lib/ai-assist/budget';
import { jobAssistModel, jobAssistProvider } from '@/lib/ai-assist/config';
import type { AssistDropped, AssistSuggestion } from '@/lib/ai-assist/fields';
import { precheckAssist, runJobAssist } from '@/lib/ai-assist/run-assist';
import { assistRequestSchema } from '@/lib/ai-assist/schema';

/**
 * Asystent redagowania treści oferty (#37, część pracodawcy) — propozycja lepszego brzmienia
 * opisu, obowiązków i wymagań w języku oferty.
 *
 * Kolejność: flaga + dostawca → walidacja wejścia (ścisły schemat, bez sieci) → sesja,
 * aktywna firma, rola recruiter+ → limit per firma (fail-closed) → budżet (#36) → model →
 * bramki deterministyczne (nowe fakty, dane kontaktowe, limity kreatora).
 *
 * Akcja NIC nie zapisuje: zwraca propozycje, a pole w formularzu zmienia pracodawca kliknięciem
 * „Użyj propozycji”. Zapis szkicu robi kreator („Dalej”), publikację — wyłącznie przycisk
 * „Opublikuj” (strażnik: `tests/unit/ai-inventory.test.ts`). Wejście to tylko tekst oferty — żadnych danych
 * kandydatów. Tekst nie jest przechowywany ani logowany (log użycia bez treści, #489).
 */

export type JobAssistResult =
  | { ok: true; demo?: boolean; suggestions: AssistSuggestion[]; dropped: AssistDropped[] }
  | { ok: false; error: ErrorCode };

/** Rola w firmie uprawniająca do redagowania ofert (jak `can_manage_jobs` w bazie). */
const JOB_MANAGER_ROLES = new Set(['owner', 'admin', 'recruiter']);

/** Limity per firma — każde wywołanie to płatne zapytanie do modelu (docs/AI_JOB_ASSIST.md). */
const ASSIST_HOURLY_MAX = 20;
const ASSIST_DAILY_MAX = 60;

export async function suggestJobText(input: unknown): Promise<JobAssistResult> {
  const provider = jobAssistProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };

  const parsed = assistRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const request = parsed.data;
  const pre = precheckAssist(request);
  if (!pre.ok) return pre;

  const configured = isPortalDataConfigured();
  // Bez bazy (demo) tylko atrapa — anonimowy ruch nie może generować kosztów.
  if (!configured && provider !== 'fixture') return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    let companyId: string | null = null;
    if (configured) {
      const me = await getPortalIdentity();
      if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
      const company = await withPortalTransaction(me, (tx) => getActiveCompany(tx, me.id));
      if (!company.activeId || !JOB_MANAGER_ROLES.has(company.activeRole)) {
        return { ok: false, error: 'PERMISSION_DENIED' };
      }
      companyId = company.activeId;

      for (const [action, max, windowSeconds] of [
        ['job-assist', ASSIST_HOURLY_MAX, 3600],
        ['job-assist-day', ASSIST_DAILY_MAX, 86_400],
      ] as const) {
        const allowed = await checkRateLimit(action, { identifier: companyId, perIp: false, max, windowSeconds });
        if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
      }
    }

    const model = provider === 'fixture' ? 'fixture' : jobAssistModel();
    const budget = aiBudgetGate();
    const budgetRequest = { feature: 'job_offer_assist' as const, companyId, model };
    if (!(await budget.reserve(budgetRequest))) return { ok: false, error: 'AI_BUDGET_EXCEEDED' };

    const result = await runJobAssist(request, {
      assistor: provider === 'fixture' ? new FixtureJobAssistor() : new AnthropicJobAssistor(),
      model,
      onUsage: (usage) => budget.settle({ ...budgetRequest, ...usage }),
    });
    if (!result.ok) return result;
    return { ...result, ...(configured ? {} : { demo: true }) };
  } catch (e) {
    captureError(e, { area: 'job-assist' });
    return { ok: false, error: 'INTERNAL' };
  }
}
