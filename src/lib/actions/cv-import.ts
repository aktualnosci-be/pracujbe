'use server';

import { z } from 'zod/v3';

import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';
import { cvImportProvider } from '@/lib/cv-import/config';
import { AnthropicCvExtractor, FixtureCvExtractor } from '@/lib/cv-import/extract';
import { isDisallowedProposalText } from '@/lib/cv-import/minimize';
import { CV_PROPOSAL_LIMITS } from '@/lib/cv-import/proposals';
import { prepareCvImport, proposeFromCv } from '@/lib/cv-import/run';
import type { CvTextProblem } from '@/lib/cv-import/text';
import type { CvApprovedProposals, CvProposal, CvRedactionSummary } from '@/lib/cv-import/types';
import { CANDIDATE_ITEM_LIMITS, candidateLanguageSchema } from '@/lib/validation/candidate';
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
 *      `apply_candidate_cv_proposals` (0109: dopisanie w jednej transakcji, limity).
 *
 * Autoryzacja: zalogowane konto KANDYDATA (import dotyczy wyłącznie własnego profilu).
 * Limit wywołań modelu per konto (fail-closed, bo każde wywołanie kosztuje).
 * Plik, tekst CV i propozycje nie są zapisywane, logowane ani wysyłane do telemetrii — przy
 * błędzie do Sentry trafia wyłącznie obszar/krok (`captureError` wysyła sam kod błędu, #508).
 * Przepływ nie tworzy rekordu `files` i nie udostępnia CV firmom.
 */

export type PrepareCvImportResult =
  | { ok: true; demo?: boolean; text: string; summary: CvRedactionSummary }
  | { ok: false; error: ErrorCode; reason?: CvTextProblem };

export type ProposeFromCvResult =
  | { ok: true; demo?: boolean; proposals: CvProposal[]; suspicious: boolean }
  | { ok: false; error: ErrorCode };

export type ApplyCvProposalsResult =
  | {
      ok: true;
      demo?: boolean;
      added: { occupations: number; skills: number; languages: number; certificates: number; experienceYears: boolean };
    }
  | { ok: false; error: ErrorCode };

const PROPOSE_HOURLY_MAX = 5;
const PROPOSE_DAILY_MAX = 10;

type Gate = { ok: true; userId: string | null } | { ok: false; error: ErrorCode };

/** Konto kandydata z sesji; w trybie demo (bez Supabase) tylko z atrapą dostawcy. */
async function requireCandidate(provider: 'anthropic' | 'fixture'): Promise<Gate> {
  if (!isSupabaseConfigured()) {
    return provider === 'fixture' ? { ok: true, userId: null } : { ok: false, error: 'DEMO_UNAVAILABLE' };
  }
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'PERMISSION_DENIED' };
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (error) return { ok: false, error: 'INTERNAL' };
  if (profile?.role !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true, userId: user.id };
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
    const extractor = provider === 'fixture' ? new FixtureCvExtractor() : new AnthropicCvExtractor();
    const result = await proposeFromCv(text, extractor);
    if (!result.ok) return result;
    return { ...result, ...(gate.userId ? {} : { demo: true }) };
  } catch (e) {
    captureError(e, { area: 'cv-import', step: 'propose' });
    return { ok: false, error: 'INTERNAL' };
  }
}

const itemLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !isDisallowedProposalText(v));

/** Zatwierdzone pozycje — te same limity co kreator onboardingu i RPC 0109. */
const approvedSchema = z
  .object({
    occupations: z.array(itemLine(CANDIDATE_ITEM_LIMITS.occupation)).max(CV_PROPOSAL_LIMITS.occupations).default([]),
    skills: z.array(itemLine(CANDIDATE_ITEM_LIMITS.skill)).max(CV_PROPOSAL_LIMITS.skills).default([]),
    languages: z
      .array(candidateLanguageSchema.refine((l) => !isDisallowedProposalText(l.language)))
      .max(CV_PROPOSAL_LIMITS.languages)
      .default([]),
    certificates: z.array(itemLine(CANDIDATE_ITEM_LIMITS.certificate)).max(CV_PROPOSAL_LIMITS.certificates).default([]),
    experienceYears: z.number().int().min(0).max(60).nullable().default(null),
  })
  .strict();

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) return 'PERMISSION_DENIED';
  return 'INTERNAL';
}

export async function applyCvProposals(input: unknown): Promise<ApplyCvProposalsResult> {
  const provider = cvImportProvider();
  if (!provider) return { ok: false, error: 'NOT_FOUND' };
  const parsed = approvedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const v: CvApprovedProposals = parsed.data;
  const total = v.occupations.length + v.skills.length + v.languages.length + v.certificates.length;
  // Brak zatwierdzenia = brak zapisu (także brak wywołania bazy).
  if (total === 0 && v.experienceYears === null) return { ok: false, error: 'VALIDATION_FAILED' };

  const added = {
    occupations: v.occupations.length,
    skills: v.skills.length,
    languages: v.languages.length,
    certificates: v.certificates.length,
    experienceYears: v.experienceYears !== null,
  };
  if (!isSupabaseConfigured()) return { ok: true, demo: true, added };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('apply_candidate_cv_proposals', {
      p_occupations: v.occupations,
      p_skills: v.skills,
      p_languages: v.languages.map((l) => ({ language: l.language, level: l.level })),
      p_certificates: v.certificates,
      p_experience_years: v.experienceYears,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };
    const counts = (data ?? {}) as Partial<typeof added>;
    return {
      ok: true,
      added: {
        occupations: Number(counts.occupations ?? 0),
        skills: Number(counts.skills ?? 0),
        languages: Number(counts.languages ?? 0),
        certificates: Number(counts.certificates ?? 0),
        experienceYears: counts.experienceYears === true,
      },
    };
  } catch (e) {
    captureError(e, { area: 'cv-import', step: 'apply' });
    return { ok: false, error: 'INTERNAL' };
  }
}
