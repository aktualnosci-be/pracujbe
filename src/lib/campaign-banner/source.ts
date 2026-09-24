import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';

import { isLocale, type Locale } from '@/i18n/routing';
import type { SalaryPeriod } from '@/lib/jobs';
import { formatSalaryRange } from '@/lib/salary';
import { salaryLabelsFor } from '@/lib/salary-labels';

import { cleanBannerText } from './text';
import type { BannerJob, BannerTexts } from './render';

/**
 * Dane baneru kampanii (#175) z zaufanego odczytu `get_managed_campaign_job` (0105) pod sesją
 * wywołującego: baza zwraca wiersz tylko dla aktywnej, niewygasłej, niedemonstracyjnej oferty
 * zweryfikowanej firmy i tylko recruiter+ tej firmy albo administratorowi. Wszystkie inne
 * przypadki (także obca oferta) = `unavailable` — jednakowo, bez ujawniania powodu.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTRACT_TYPES = ['permanent', 'temporary', 'interim', 'freelance', 'internship', 'seasonal'] as const;
type ContractType = (typeof CONTRACT_TYPES)[number];

export interface CampaignJob extends BannerJob {
  contractType: ContractType | null;
  accommodation: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  salaryPeriod: SalaryPeriod | null;
}

export type CampaignJobLoad = { status: 'ok'; job: CampaignJob } | { status: 'unavailable' } | { status: 'error' };

export function isCampaignJobId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Mapuje wiersz RPC na pola grafiki; pola spoza kontraktu są pomijane. */
export function toCampaignJob(row: unknown): CampaignJob | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const slug = text(r['slug']);
  const title = cleanBannerText(text(r['title']));
  const companyName = cleanBannerText(text(r['company_name']));
  if (!slug || !title || !companyName) return null;
  const contract = text(r['contract_type']);
  const period = text(r['salary_period']);
  return {
    slug,
    title,
    companyName,
    city: cleanBannerText(text(r['city'])),
    contractType: (CONTRACT_TYPES as readonly string[]).includes(contract) ? (contract as ContractType) : null,
    accommodation: r['accommodation'] === true,
    salaryMin: amount(r['salary_min']),
    salaryMax: amount(r['salary_max']),
    currency: text(r['currency']) || null,
    salaryPeriod: period === 'hour' || period === 'month' || period === 'year' ? period : null,
  };
}

export async function loadManagedCampaignJob(
  supabase: SupabaseClient,
  jobId: string,
  locale: Locale,
): Promise<CampaignJobLoad> {
  if (!isCampaignJobId(jobId)) return { status: 'unavailable' };
  const { data, error } = await supabase.rpc('get_managed_campaign_job', { p_job_id: jobId, p_locale: locale });
  if (error) return { status: 'error' };
  const rows = Array.isArray(data) ? data : [];
  const job = rows.length === 1 ? toCampaignJob(rows[0]) : null;
  return job ? { status: 'ok', job } : { status: 'unavailable' };
}

/** Teksty baneru w języku baneru (`src/messages`), nie w języku sesji. */
export async function campaignBannerTexts(job: CampaignJob, locale: string): Promise<BannerTexts> {
  const lang: Locale = isLocale(locale) ? locale : 'pl';
  const [t, tc, tj] = await Promise.all([
    getTranslations({ locale: lang, namespace: 'campaignBanner' }),
    getTranslations({ locale: lang, namespace: 'contractTypes' }),
    getTranslations({ locale: lang, namespace: 'jobs' }),
  ]);
  const salary = formatSalaryRange(
    { salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency, salaryPeriod: job.salaryPeriod },
    lang,
    salaryLabelsFor(lang),
  );
  const conditions = [job.contractType ? tc(job.contractType) : null, job.accommodation ? tj('accommodation') : null]
    .filter(Boolean)
    .join(' · ');
  return {
    eyebrow: t('eyebrow'),
    cta: t('cta'),
    salary,
    conditions: conditions || null,
    accessibleName: t('accessibleName', { title: job.title }),
  };
}
