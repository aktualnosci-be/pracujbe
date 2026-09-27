import 'server-only';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { cvApprovedProposalsSchema } from '@/lib/cv-import/approved';
import type { CvApprovedProposals } from '@/lib/cv-import/types';

/**
 * Zapis pozycji ZATWIERDZONYCH przez kandydata (#487 import CV, #37 asystent profilu) —
 * wspólny rdzeń obu akcji. Jedno RPC `apply_candidate_cv_proposals` (0115: dopisanie w jednej
 * transakcji, limity kreatora) pod sesją kandydata (`withPortalTransaction`, RLS). Wejście sprawdza
 * `cvApprovedProposalsSchema` (schematy kroków kreatora, także po edycji wartości). Brak
 * zatwierdzenia = `VALIDATION_FAILED` bez wywołania bazy. Flagę funkcji sprawdza akcja.
 */

export type ApplyCvProposalsResult =
  | {
      ok: true;
      demo?: boolean;
      added: { occupations: number; skills: number; languages: number; certificates: number; experienceYears: boolean };
    }
  | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('JWT')) return 'PERMISSION_DENIED';
  return 'INTERNAL';
}

export async function applyApprovedProposals(input: unknown, area: 'cv-import' | 'profile-assist'): Promise<ApplyCvProposalsResult> {
  const parsed = cvApprovedProposalsSchema.safeParse(input);
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
