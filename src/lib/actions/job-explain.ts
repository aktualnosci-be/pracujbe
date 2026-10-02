'use server';

import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { routing, type Locale } from '@/i18n/routing';
import { isServiceDatabaseConfigured, isPortalDataConfigured } from '@/lib/db/portal';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { FIXTURE_MODEL } from '@/lib/ai/pricing';
import { explainCacheKey, readExplainCache, writeExplainCache } from '@/lib/ai-explain/cache';
import { jobExplainModel, jobExplainProvider } from '@/lib/ai-explain/config';
import { FixtureJobExplainer, OpenAiJobExplainer } from '@/lib/ai-explain/explain';
import type { GuardedExplanation } from '@/lib/ai-explain/guard';
import { runJobExplain } from '@/lib/ai-explain/run';
import type { ExplainGapKind, ExplainTopic } from '@/lib/ai-explain/schema';
import {
  buildExplainSources,
  type ExplainDisplayValues,
  type ExplainSource,
  type ExplainSourceField,
} from '@/lib/ai-explain/sources';
import { formatEuro } from '@/lib/job-costs';
import { jobStartDateInstant, jobStartInfo } from '@/lib/job-start';
import { getJobBySlug, type JobDetail } from '@/lib/jobs';
import { languageDisplayName } from '@/lib/languages';
import { checkRateLimit } from '@/lib/rate-limit';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import { formatSalaryRange } from '@/lib/salary';
import { salaryLabelsFor } from '@/lib/salary-labels';

/**
 * „Wyjaśnij ofertę” (#773) — objaśnienie warunków JEDNEJ aktywnej, publicznej oferty prostym
 * językiem, na żądanie odwiedzającego, w wybranym języku.
 *
 * Kolejność: flaga + dostawca → walidacja wejścia → Turnstile (`job_explain`, fail-closed) → odczyt oferty (`getJobBySlug` = tylko oferta
 * publiczna; treść oryginału, nie przekładu maszynowego) → pamięć podręczna (ta sama treść
 * i język = bez nowego wywołania) → limity per adres (fail-closed) → budżet AI (#36) → model →
 * bramki faktów. Do modelu trafia wyłącznie treść oferty i język odpowiedzi — bez CV, profilu,
 * sesji ani innych danych osoby pytającej. Akcja NIC nie zapisuje i nie zmienia oferty.
 */

export interface ExplainSourceView {
  id: string;
  field: ExplainSourceField;
  text: string;
  lang: Locale;
}

export interface ExplainItemView {
  topic: ExplainTopic;
  explanation: string;
  sources: ExplainSourceView[];
}

export interface ExplainGapView {
  topic: ExplainTopic;
  kind: ExplainGapKind;
  note: string;
  sources: ExplainSourceView[];
}

export type JobExplainResult =
  | {
      ok: true;
      demo?: boolean;
      targetLocale: Locale;
      items: ExplainItemView[];
      gaps: ExplainGapView[];
      dropped: number;
    }
  | { ok: false; error: ErrorCode };

const LOCALES = routing.locales as unknown as [Locale, ...Locale[]];
const inputSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9][a-z0-9-]*$/),
  locale: z.enum(LOCALES),
  targetLocale: z.enum(LOCALES),
  /** Token Cloudflare Turnstile (`job_explain`); bez kluczy poza produkcją weryfikacja pominięta. */
  botCheckToken: z.string().max(4096).nullable().optional(),
});

/** Limity per adres — wywołanie bez konta to płatne zapytanie do modelu. */
const EXPLAIN_HOURLY_MAX = 10;
const EXPLAIN_DAILY_MAX = 30;

async function displayValues(job: JobDetail, locale: Locale): Promise<ExplainDisplayValues> {
  const [tContract, tJob, tCommon, tLang, tExplain] = await Promise.all([
    getTranslations({ locale, namespace: 'contractTypes' }),
    getTranslations({ locale, namespace: 'job' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'languageNames' }),
    getTranslations({ locale, namespace: 'jobExplain' }),
  ]);
  const start = jobStartInfo(job);
  const startDate = start.date
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(jobStartDateInstant(start.date))
    : null;
  const costs = job.costs;
  const accommodation = costs?.accommodationKind
    ? [
        tJob(`costs.kind.${costs.accommodationKind}`),
        costs.accommodationCost === undefined
          ? null
          : costs.accommodationCost === 0
            ? tJob('costs.free')
            : tJob('costs.cost', {
                amount: formatEuro(costs.accommodationCost, locale),
                period: costs.accommodationCostPeriod ?? 'month',
              }),
        costs.accommodationDeducted === undefined
          ? null
          : tJob(costs.accommodationDeducted ? 'costs.deductedYes' : 'costs.deductedNo'),
      ]
        .filter(Boolean)
        .join(' · ')
    : job.accommodation
      ? tCommon('yes')
      : null;
  const transport =
    costs?.transportShuttle || costs?.transportReimbursed
      ? [costs.transportShuttle ? tJob('costs.shuttle') : null, costs.transportReimbursed ? tJob('costs.reimbursed') : null]
          .filter(Boolean)
          .join(' · ')
      : job.transport
        ? tCommon('yes')
        : null;
  return {
    salary: formatSalaryRange(job, locale, salaryLabelsFor(locale)),
    contract: tContract(job.contractType),
    location: [job.city, job.region].filter(Boolean).join(', '),
    start: [start.immediate ? tJob('startImmediate') : null, startDate].filter(Boolean).join(' · ') || null,
    workTime: job.workTime ? tJob(`workTimeValues.${job.workTime}`) : null,
    accommodation,
    transport,
    mealVouchers:
      costs?.mealVoucherDaily === undefined
        ? null
        : tJob('costs.mealPerDay', { amount: formatEuro(costs.mealVoucherDaily, locale) }),
    languages:
      job.languages.length > 0
        ? job.languages.map((l) => languageDisplayName(l, (code) => tLang(code))).join(', ')
        : job.noLanguageRequired
          ? tExplain('noLanguageRequired')
          : null,
  };
}

function view(result: GuardedExplanation, sources: readonly ExplainSource[]): Pick<
  Extract<JobExplainResult, { ok: true }>,
  'items' | 'gaps' | 'dropped'
> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const resolve = (ids: readonly string[]): ExplainSourceView[] =>
    ids.flatMap((id) => {
      const s = byId.get(id);
      return s ? [{ id: s.id, field: s.field, text: s.display, lang: s.displayLocale }] : [];
    });
  return {
    items: result.items.map((i) => ({ topic: i.topic, explanation: i.explanation, sources: resolve(i.sourceIds) })),
    gaps: result.gaps.map((g) => ({ topic: g.topic, kind: g.kind, note: g.note, sources: resolve(g.sourceIds) })),
    dropped: result.dropped,
  };
}

export async function explainJobOffer(input: unknown): Promise<JobExplainResult> {
  const provider = jobExplainProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const { slug, locale, targetLocale, botCheckToken } = parsed.data;

  const configured = isPortalDataConfigured();
  // Bez bazy (demo) tylko atrapa — anonimowy ruch nie może generować kosztów.
  if (!configured && provider !== 'fixture') return { ok: false, error: 'DEMO_UNAVAILABLE' };

  // Decyzja właściciela (#773): Turnstile PRZED odczytem oferty, pamięcią podręczną, limitem
  // i modelem. Polityka `closed` — w produkcji brak kluczy albo awaria dostawcy = odmowa.
  const botCheck = await enforceTurnstile('jobExplain', botCheckToken);
  if (botCheck) return { ok: false, error: botCheck };

  try {
    let job = await getJobBySlug(slug, locale);
    if (!job) return { ok: false, error: 'NOT_FOUND' };
    // Wyjaśniamy oryginał, nie przekład maszynowy (#33) — fakty porównujemy ze źródłem.
    if (job.machineTranslation) {
      const original = await getJobBySlug(slug, job.machineTranslation.sourceLocale);
      if (!original) return { ok: false, error: 'NOT_FOUND' };
      job = original;
    }
    if (job.isDemo && provider !== 'fixture') return { ok: false, error: 'DEMO_UNAVAILABLE' };

    const contentLocale = job.machineTranslation?.sourceLocale ?? job.contentLocale ?? locale;
    const sources = buildExplainSources(job, contentLocale, locale, await displayValues(job, locale));
    const key = explainCacheKey(job.id, targetLocale, sources);
    const cached = readExplainCache(key);
    const demo = configured ? {} : { demo: true as const };
    if (cached) return { ok: true, ...demo, targetLocale, ...view(cached, sources) };

    if (configured) {
      for (const [action, max, windowSeconds] of [
        ['job-explain', EXPLAIN_HOURLY_MAX, 3600],
        ['job-explain-day', EXPLAIN_DAILY_MAX, 86_400],
      ] as const) {
        const allowed = await checkRateLimit(action, { max, windowSeconds });
        if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
      }
    }

    const fixture = provider === 'fixture';
    const result = await runJobExplain(sources, targetLocale, {
      explainer: fixture ? new FixtureJobExplainer() : new OpenAiJobExplainer(),
      model: fixture ? FIXTURE_MODEL : jobExplainModel(),
      // Płatny dostawca zawsze przez budżet; wyjątek tylko dla atrapy bez bazy zadań.
      budgeted: !(fixture && !isServiceDatabaseConfigured()),
    });
    if (!result.ok) return result;
    const guarded: GuardedExplanation = { items: result.items, gaps: result.gaps, dropped: result.dropped };
    writeExplainCache(key, guarded);
    return { ok: true, ...demo, targetLocale, ...view(guarded, sources) };
  } catch (e) {
    captureError(e, { area: 'job-explain' });
    return { ok: false, error: 'INTERNAL' };
  }
}
