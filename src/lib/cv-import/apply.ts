import 'server-only';

import { z } from 'zod/v3';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import { isDisallowedProposalText } from '@/lib/cv-import/minimize';
import { CV_PROPOSAL_LIMITS } from '@/lib/cv-import/proposals';
import type { CvApprovedProposals } from '@/lib/cv-import/types';
import { CANDIDATE_ITEM_LIMITS, candidateLanguageSchema } from '@/lib/validation/candidate';

/**
 * Zapis pozycji ZATWIERDZONYCH przez kandydata (#487 import CV, #37 asystent profilu) —
 * wspólny rdzeń obu akcji. Jedno RPC `apply_candidate_cv_proposals` (0115: dopisanie w jednej
 * transakcji, limity kreatora) pod sesją kandydata (`withPortalTransaction`, RLS). Brak
 * zatwierdzenia = `VALIDATION_FAILED` bez wywołania bazy. Flagę funkcji sprawdza akcja.
 */

export type ApplyCvProposalsResult =
  | {
      ok: true;
      demo?: boolean;
      added: { occupations: number; skills: number; languages: number; certificates: number; experienceYears: boolean };
    }
  | { ok: false; error: ErrorCode };

const itemLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !isDisallowedProposalText(v));

/** Zatwierdzone pozycje — te same limity co kreator onboardingu i RPC 0115. */
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

export async function applyApprovedProposals(input: unknown, area: 'cv-import' | 'profile-assist'): Promise<ApplyCvProposalsResult> {
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
  if (!isPortalDataConfigured()) return { ok: true, demo: true, added };

  try {
    const me = await getPortalIdentity();
    if (!me || me.role !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) =>
      rpc<Partial<typeof added>>(tx, 'apply_candidate_cv_proposals', {
        p_occupations: v.occupations,
        p_skills: v.skills,
        p_languages: jsonArg(v.languages.map((l) => ({ language: l.language, level: l.level }))),
        p_certificates: v.certificates,
        p_experience_years: v.experienceYears,
      }),
    );
    const counts = data ?? {};
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
    if (isDatabaseError(e)) return { ok: false, error: mapPgError(databaseErrorMessage(e)) };
    captureError(e, { area, step: 'apply' });
    return { ok: false, error: 'INTERNAL' };
  }
}
