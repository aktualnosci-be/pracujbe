import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { jsonArg, rpc, rpcRows } from '@/lib/db/sql';
import type { TranslationFields } from '@/lib/translation/validate';

/**
 * Dostęp workera do kolejki tłumaczeń (0145). Każda metoda = jedno wywołanie RPC (osobna,
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
export type DeferOutcome = 'deferred' | 'superseded' | 'stale_lease' | 'not_found';

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
  /** Odroczenie bez zużycia próby — model nie został wywołany (budżet AI, #36). */
  defer(job: ClaimedTranslationJob, code: string, delaySeconds: number): Promise<DeferOutcome>;
}

/**
 * Kolejka przez pulę zadań serwerowych (service_role, jak outbox e-mail). Każde wywołanie to
 * osobna, krótka transakcja `withServiceRole` — dostawca jest wołany pomiędzy nimi.
 */
export function serviceTranslationStore(): TranslationQueueStore {
  return {
    async claim(limit, leaseSeconds) {
      try {
        return await withServiceRole((tx) =>
          rpcRows<ClaimedTranslationJob>(tx, 'claim_translation_jobs', {
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        );
      } catch {
        throw new Error('translation_claim_failed');
      }
    },
    async complete(job, fields, usage) {
      try {
        const out = await withServiceRole((tx) =>
          rpc<CompleteOutcome>(tx, 'complete_translation_job', {
            p_job_id: job.job_id,
            p_lease_id: job.lease_id,
            p_fields: jsonArg(fields),
            p_model: usage.model.slice(0, 64),
            p_input_tokens: usage.inputTokens,
            p_output_tokens: usage.outputTokens,
          }),
        );
        return out ?? 'not_found';
      } catch {
        throw new Error('translation_complete_failed');
      }
    },
    async fail(job, code, retryable, retryAfterSeconds) {
      try {
        const out = await withServiceRole((tx) =>
          rpc<FailOutcome>(tx, 'fail_translation_job', {
            p_job_id: job.job_id,
            p_lease_id: job.lease_id,
            p_error_code: code,
            p_retryable: retryable,
            p_retry_after_seconds: retryAfterSeconds,
          }),
        );
        return out ?? 'not_found';
      } catch {
        throw new Error('translation_fail_failed');
      }
    },
    async defer(job, code, delaySeconds) {
      try {
        const out = await withServiceRole((tx) =>
          rpc<DeferOutcome>(tx, 'defer_translation_job', {
            p_job_id: job.job_id,
            p_lease_id: job.lease_id,
            p_error_code: code,
            p_delay_seconds: delaySeconds,
          }),
        );
        return out ?? 'not_found';
      } catch {
        throw new Error('translation_defer_failed');
      }
    },
  };
}
