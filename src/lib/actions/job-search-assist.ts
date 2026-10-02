'use server';

import { getTranslations } from 'next-intl/server';

import { databaseBudgetStore } from '@/lib/ai/budget';
import { FIXTURE_MODEL } from '@/lib/ai/pricing';
import { jobSearchAssistModel, jobSearchAssistProvider } from '@/lib/ai-search/config';
import { FixtureSearchInterpreter, OpenAiSearchInterpreter } from '@/lib/ai-search/interpret';
import type { JobSearchProposal } from '@/lib/ai-search/proposal';
import { precheckSearchAssist, runJobSearchAssist } from '@/lib/ai-search/run';
import { SEARCH_ASSIST_SCHEMA_VERSION, searchAssistRequestSchema } from '@/lib/ai-search/schema';
import { isServiceDatabaseConfigured } from '@/lib/db/portal';
import { captureError } from '@/lib/error-report';
import type { ErrorCode } from '@/lib/errors';
import { describeJobListFilters } from '@/lib/job-filter-summary';
import { parseJobListQuery } from '@/lib/job-list-query';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Wyszukiwanie opisem (#711): opis potrzeby kandydata → PROPOZYCJA filtrów listy ofert.
 *
 * Kolejność: flaga + dostawca → walidacja wejścia (ścisły schemat, polecenia dla AI, bez sieci)
 * → limit per adres (fail-closed, płatne API) → budżet (#36) → model → bramki słowników.
 *
 * Akcja NIC nie zapisuje i niczego nie stosuje: zwraca parametry listy i etykiety, a lista
 * zmienia się dopiero po kliknięciu „Zastosuj filtry” w przeglądarce. Nie czyta sesji ani
 * profilu — wejściem jest wyłącznie wpisany tekst (po redakcji danych kontaktowych), bez
 * identyfikatora osoby. Tekst nie jest przechowywany ani logowany (log użycia bez treści).
 */

export type JobSearchAssistResult = { ok: true; proposal: JobSearchProposal } | { ok: false; error: ErrorCode };

/** Limity per adres — każde wywołanie to płatne zapytanie do modelu. */
const SEARCH_ASSIST_HOURLY_MAX = 10;
const SEARCH_ASSIST_DAILY_MAX = 30;

export async function suggestJobSearchFilters(input: unknown): Promise<JobSearchAssistResult> {
  const provider = jobSearchAssistProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };

  const parsed = searchAssistRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const request = parsed.data;
  const pre = precheckSearchAssist(request);
  if (!pre.ok) return pre;

  const serviceDb = isServiceDatabaseConfigured();
  // Bez bazy zadań serwerowych (demo) tylko atrapa — anonimowy ruch nie może generować kosztów
  // poza budżetem.
  if (!serviceDb && provider !== 'fixture') return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    for (const [action, max, windowSeconds] of [
      ['job-search-assist', SEARCH_ASSIST_HOURLY_MAX, 3600],
      ['job-search-assist-day', SEARCH_ASSIST_DAILY_MAX, 86_400],
    ] as const) {
      const allowed = await checkRateLimit(action, { max, windowSeconds });
      if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
    }

    const model = provider === 'fixture' ? FIXTURE_MODEL : jobSearchAssistModel();
    const result = await runJobSearchAssist(request, {
      interpreter: provider === 'fixture' ? new FixtureSearchInterpreter() : new OpenAiSearchInterpreter(),
      model,
      // Płatny dostawca zawsze przez budżet; atrapa bez bazy (demo/E2E) — bez rezerwacji.
      budgetStore: provider === 'fixture' && !serviceDb ? null : databaseBudgetStore,
    });
    if (!result.ok) return result;

    const { mapped } = result;
    const locale = request.locale;
    const [filters, categories, contractTypes, languageNames] = await Promise.all([
      getTranslations({ locale, namespace: 'filters' }),
      getTranslations({ locale, namespace: 'categories' }),
      getTranslations({ locale, namespace: 'contractTypes' }),
      getTranslations({ locale, namespace: 'languageNames' }),
    ]);
    const items = describeJobListFilters(parseJobListQuery(mapped.params, locale), locale, {
      filters,
      categories,
      contractTypes,
      languageNames,
    });
    return {
      ok: true,
      proposal: {
        schemaVersion: SEARCH_ASSIST_SCHEMA_VERSION,
        model,
        params: mapped.params,
        items,
        places: mapped.places,
        uncertain: mapped.uncertain,
        droppedCount: mapped.droppedCount,
      },
    };
  } catch (e) {
    captureError(e, { area: 'job-search-assist' });
    return { ok: false, error: 'INTERNAL' };
  }
}
