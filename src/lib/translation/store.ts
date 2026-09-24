import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { TranslationFields } from '@/lib/translation/validate';

/**
 * Dostęp workera do kolejki tłumaczeń (0106). Każda metoda = jedno wywołanie RPC (osobna,
 * krótka transakcja w bazie) — wywołanie dostawcy odbywa się pomiędzy nimi, nigdy wewnątrz
 * transakcji. Interfejs pozwala testować worker bez bazy.
 */

export interface ClaimedTranslationJob {
  job_id: string;
  lease_id: string;
  lease_expires_at: string;
  attempt: number;
  entity_type: 'job' | 'candidate_profile';
  entity_id: string;
  revision_id: string;
  revision_no: number;
  source_locale: string;
  target_locale: string;
  pipeline_version: string;
  fields: TranslationFields;
}

export type CompleteOutcome = 'applied' | 'proposal' | 'superseded' | 'stale_lease' | 'not_found';
export type FailOutcome = 'retry' | 'failed' | 'superseded' | 'stale_lease' | 'not_found';

export interface TranslationQueueStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedTranslationJob[]>;
  complete(
    job: ClaimedTranslationJob,
    fields: TranslationFields,
    usage: { model: string; inputTokens: number; outputTokens: number },
  ): Promise<CompleteOutcome>;
  fail(
    job: ClaimedTranslationJob,
    code: string,
    retryable: boolean,
    retryAfterSeconds: number | null,
  ): Promise<FailOutcome>;
}

/** Kolejka przez klienta service-role (jak outbox e-mail); wywołania tylko z serwera. */
export function adminTranslationStore(): TranslationQueueStore {
  const admin = createAdminClient();
  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await admin.rpc('claim_translation_jobs', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error('translation_claim_failed');
      return (data ?? []) as ClaimedTranslationJob[];
    },
    async complete(job, fields, usage) {
      const { data, error } = await admin.rpc('complete_translation_job', {
        p_job_id: job.job_id,
        p_lease_id: job.lease_id,
        p_fields: fields,
        p_model: usage.model.slice(0, 64),
        p_input_tokens: usage.inputTokens,
        p_output_tokens: usage.outputTokens,
      });
      if (error) throw new Error('translation_complete_failed');
      return data as CompleteOutcome;
    },
    async fail(job, code, retryable, retryAfterSeconds) {
      const { data, error } = await admin.rpc('fail_translation_job', {
        p_job_id: job.job_id,
        p_lease_id: job.lease_id,
        p_error_code: code,
        p_retryable: retryable,
        p_retry_after_seconds: retryAfterSeconds,
      });
      if (error) throw new Error('translation_fail_failed');
      return data as FailOutcome;
    },
  };
}
