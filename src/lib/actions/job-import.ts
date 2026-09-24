'use server';

import { getActiveCompany } from '@/lib/company-context';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { jobImportProvider } from '@/lib/ai-import/config';
import { AnthropicJobExtractor, FixtureJobExtractor } from '@/lib/ai-import/extract';
import { IMPORT_IMAGE_MAX_BYTES, type ImportImageProblem } from '@/lib/ai-import/image';
import { buildImportDraftContent, type ImportedWizardValues } from '@/lib/ai-import/map';
import { precheckSource, runJobImport, type ImportSource } from '@/lib/ai-import/run-import';
import type { ImportableField } from '@/lib/ai-import/schema';
import { createJobDraft } from '@/lib/actions/jobs';

/**
 * Import ogłoszenia przez AI (#465) — zrzut ekranu albo link → WSTĘPNIE wypełniony szkic.
 *
 * Kolejność: flaga + dostawca → walidacja źródła (bez sieci) → sesja, aktywna firma, rola
 * recruiter+ → limit per firma (fail-safe) → pobranie/ekstrakcja → walidacja schematami kroków
 * kreatora → zapis WYŁĄCZNIE do szkicu: `createJobDraft` + jedno RPC `save_job_draft` (#192).
 * Publikacja nigdy nie jest wywoływana — robi ją pracodawca w kreatorze (`publish_job`).
 *
 * Zapis i kontekst firmy pod SESJĄ użytkownika (`withPortalTransaction`, RLS — nigdy service-role).
 *
 * Tryb demo (bez backendu) działa tylko z atrapą dostawcy: płatne API wymaga zalogowanego
 * rekrutera, więc anonimowy ruch nie może generować kosztów.
 *
 * Plik ani treść strony nie są zapisywane — żyją wyłącznie w pamięci na czas żądania.
 */

export type JobImportResult =
  | {
      ok: true;
      jobId: string | null;
      demo?: boolean;
      values: ImportedWizardValues;
      review: ImportableField[];
      suspicious: boolean;
      sourceLanguage: string | null;
      savedSteps: number[];
    }
  | { ok: false; error: ErrorCode; reason?: ImportImageProblem };

/** Rola w firmie uprawniająca do tworzenia ofert (jak `can_manage_jobs` w bazie). */
const JOB_MANAGER_ROLES = new Set(['owner', 'admin', 'recruiter']);

/** Limity per firma — każde wywołanie to płatne zapytanie do modelu (docs/AI_JOB_IMPORT.md). */
const IMPORT_HOURLY_MAX = 10;
const IMPORT_DAILY_MAX = 30;

/** Źródło z formularza: plik obrazu (`mode=image`) albo adres (`mode=url`). */
async function readSource(formData: FormData): Promise<ImportSource | 'tooLarge' | null> {
  const mode = formData.get('mode');
  if (mode === 'image') {
    const file = formData.get('file');
    if (!file || typeof file === 'string') return null;
    // Rozmiar przed wczytaniem treści — za duży plik nie jest nawet czytany.
    if (file.size > IMPORT_IMAGE_MAX_BYTES) return 'tooLarge';
    return { kind: 'image', bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type };
  }
  if (mode === 'url') {
    const url = formData.get('url');
    return typeof url === 'string' ? { kind: 'url', url } : null;
  }
  return null;
}

export async function importJobListing(formData: FormData, locale?: string): Promise<JobImportResult> {
  const provider = jobImportProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };
  if (!(formData instanceof FormData)) return { ok: false, error: 'VALIDATION_FAILED' };

  const source = await readSource(formData);
  if (source === 'tooLarge') return { ok: false, error: 'JOB_IMPORT_INVALID_FILE', reason: 'tooLarge' };
  if (!source) return { ok: false, error: 'VALIDATION_FAILED' };
  const pre = precheckSource(source);
  if (!pre.ok) return pre;

  const configured = isPortalDataConfigured();
  if (!configured && provider !== 'fixture') return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    if (configured) {
      const me = await getPortalIdentity();
      if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

      const company = await withPortalTransaction(me, (tx) => getActiveCompany(tx, me.id));
      if (!company.activeId || !JOB_MANAGER_ROLES.has(company.activeRole)) {
        return { ok: false, error: 'PERMISSION_DENIED' };
      }

      for (const [action, max, windowSeconds] of [
        ['job-import', IMPORT_HOURLY_MAX, 3600],
        ['job-import-day', IMPORT_DAILY_MAX, 86_400],
      ] as const) {
        const allowed = await checkRateLimit(action, {
          identifier: company.activeId,
          perIp: false,
          max,
          windowSeconds,
        });
        if (!allowed) return { ok: false, error: 'RATE_LIMITED' };
      }
    }

    const extractor = provider === 'fixture' ? new FixtureJobExtractor() : new AnthropicJobExtractor();
    const result = await runJobImport(source, { extractor });
    if (!result.ok) return result;
    const { mapped } = result;

    const base = {
      ok: true as const,
      values: mapped.values,
      review: mapped.review,
      suspicious: mapped.suspicious,
      sourceLanguage: mapped.sourceLanguage,
    };

    const content = buildImportDraftContent(mapped.validSteps);
    if (!content) return { ...base, jobId: null, savedSteps: [] };

    const created = await createJobDraft(locale);
    if (!created.ok) return { ...base, jobId: null, savedSteps: [] };
    if (created.demo) {
      return { ...base, jobId: created.id, demo: true, savedSteps: mapped.validSteps.map((s) => s.step) };
    }

    try {
      const me = await getPortalIdentity();
      if (!me) throw new Error('Session lost after draft creation');
      await withPortalTransaction(me, (tx) =>
        rpc(tx, 'save_job_draft', { p_job_id: created.id, p_content: jsonArg(content) }),
      );
    } catch (error) {
      // Szkic istnieje, ale bez treści — kreator zapisze kroki przy „Dalej".
      captureError(error, { area: 'job-import', step: 'save_job_draft' });
      return { ...base, jobId: created.id, savedSteps: [] };
    }
    return { ...base, jobId: created.id, savedSteps: mapped.validSteps.map((s) => s.step) };
  } catch (e) {
    captureError(e, { area: 'job-import' });
    return { ok: false, error: 'INTERNAL' };
  }
}
