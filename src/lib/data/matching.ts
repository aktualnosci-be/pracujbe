import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { scoreMatch, type MatchCandidate, type MatchJob, type MatchResult } from '@/lib/matching/score';

/**
 * Warstwa danych dla dopasowania kandydat↔oferta (Etap 5).
 *
 * Liczy dopasowanie NA ŻYWO z realnego profilu zalogowanego kandydata i znormalizowanych
 * wymagań oferty (RPC `get_job_match_profile`, 0024) — deterministycznym silnikiem
 * `scoreMatch` (bez AI, te same wejścia → ten sam wynik). Zwraca `null`, gdy: brak env
 * (demo), brak sesji, brak profilu kandydata lub oferta niedostępna publicznie.
 *
 * Prywatność: profil kandydata czytany pod RLS (własny wiersz); oferta przez SECURITY
 * DEFINER RPC ograniczone do ofert active+verified i bezpiecznych kolumn.
 */

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function asNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
/** Tablica stringów (odfiltrowane puste) — dla kolumn text[]/enum[] i wyników zapytań. */
function asStrArr(value: unknown): string[] {
  return asArr(value).map((v) => asStr(v)).filter((v) => v.length > 0);
}
/** Etykiety z relacji (np. candidate_skills.skill_label) po podanym polu. */
function labelsFrom(rows: unknown, field: string): string[] {
  return asArr(rows)
    .map((r) => asStr(asRecord(r)[field]))
    .filter((v) => v.length > 0);
}

async function getAuthUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Dopasowanie zalogowanego kandydata do konkretnej oferty (lub `null`).
 * Bezpieczne do wołania także dla anonimów/pracodawców — wtedy zwraca `null`.
 */
export async function getMyJobMatch(jobId: string): Promise<MatchResult | null> {
  if (!isSupabaseConfigured()) return null;
  if (!jobId) return null;

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const userId = await getAuthUserId(supabase);
    if (!userId) return null;

    // Profil kandydata (własny wiersz pod RLS). Brak → użytkownik nie jest kandydatem.
    const { data: cpData } = await supabase
      .from('candidate_profiles')
      .select(
        'id, occupations, categories, preferred_contract_types, city, region, radius_km, ' +
          'has_driving_license, has_car, experience_years, availability',
      )
      .eq('profile_id', userId)
      .maybeSingle();
    if (!cpData) return null;
    const cp = asRecord(cpData);
    const profileId = asStr(cp['id']);
    if (!profileId) return null;

    const [skillsRes, langsRes, certsRes, jobRes] = await Promise.all([
      supabase.from('candidate_skills').select('skill_label').eq('candidate_profile_id', profileId),
      supabase.from('candidate_languages').select('language_label').eq('candidate_profile_id', profileId),
      supabase.from('candidate_certificates').select('certificate_label').eq('candidate_profile_id', profileId),
      supabase.rpc('get_job_match_profile', { p_job_id: jobId }),
    ]);

    const jobRow = asArr(jobRes.data)[0];
    if (!jobRow) return null; // oferta niedostępna publicznie (nie active/verified) lub nie istnieje
    const jr = asRecord(jobRow);

    const candidate: MatchCandidate = {
      occupations: asStrArr(cp['occupations']),
      categories: asStrArr(cp['categories']),
      skills: labelsFrom(skillsRes.data, 'skill_label'),
      city: asStr(cp['city']) || undefined,
      region: asStr(cp['region']) || undefined,
      radiusKm: asNum(cp['radius_km']),
      experienceYears: asNum(cp['experience_years']),
      availability: asStr(cp['availability']) || undefined,
      languages: labelsFrom(langsRes.data, 'language_label'),
      certificates: labelsFrom(certsRes.data, 'certificate_label'),
      hasDrivingLicense: cp['has_driving_license'] === true,
      hasCar: cp['has_car'] === true,
      preferredContractTypes: asStrArr(cp['preferred_contract_types']),
    };

    const job: MatchJob = {
      occupation: asStr(jr['occupation']) || undefined,
      category: asStr(jr['category']) || undefined,
      skills: asStrArr(jr['skills']),
      mandatorySkills: asStrArr(jr['mandatory_skills']),
      city: asStr(jr['city']) || undefined,
      region: asStr(jr['region']) || undefined,
      minExperienceYears: asNum(jr['min_experience_years']),
      // Realne wymagania językowe/certyfikatowe oferty (relacje 0030, RPC get_job_match_profile).
      requiredLanguages: asStrArr(jr['languages']),
      requiredCertificates: asStrArr(jr['certificates']),
      requiresDrivingLicense: jr['requires_driving_license'] === true,
      contractType: asStr(jr['contract_type']) || undefined,
      startImmediately: jr['start_immediately'] === true,
    };

    return scoreMatch(candidate, job);
  } catch (error) {
    captureError(error, { area: 'matching.getMyJobMatch' });
    return null;
  }
}
