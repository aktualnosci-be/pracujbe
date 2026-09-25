import 'server-only';

/**
 * Polityka wieku kandydatów (#492) — odczyty.
 *
 * `getCandidateMinAge` — bieżący próg z `public.candidate_min_age()` (0126). Odczyt jako gość
 * przez pulę ograniczonego loginu (`DATABASE_APP_URL`, rola anon) — bez cookies, więc strony
 * ISR (szczegół oferty) zostają statyczne. Bez puli albo po błędzie odczytu → wartość
 * awaryjna 18 (górna granica zakresu), więc formularz nigdy nie pokaże progu niższego niż
 * obowiązujący; baza i tak porównuje deklarację z bieżącym progiem.
 *
 * `loadMyAgeAttestation` — stan deklaracji zalogowanego kandydata (`get_my_age_attestation`,
 * w transakcji sesji pod RLS). Tryb demo: deklaracja spełniona (`demo: true`, Invariant #12).
 */

import { CANDIDATE_MIN_AGE_FALLBACK, normalizeCandidateMinAge } from '@/lib/age-policy/constants';
import { isDatabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { isBuildPhase } from '@/lib/static-rendering';

export async function getCandidateMinAge(): Promise<number> {
  try {
    // `next build` nie łączy się z bazą (#534) — wartość awaryjna, ISR odświeży po starcie.
    if (isDatabaseConfigured() && !isBuildPhase()) {
      const [{ getDomainPool }, { withUserTransaction }] = await Promise.all([
        import('@/lib/db/runtime'),
        import('@/lib/db/transaction'),
      ]);
      const value = await withUserTransaction(await getDomainPool(), null, async (transaction) => {
        const result = (await transaction.query('SELECT public.candidate_min_age() AS min_age')) as {
          rows: { min_age: unknown }[];
        };
        return result.rows[0]?.min_age;
      });
      return normalizeCandidateMinAge(value);
    }
  } catch (error) {
    captureError(error, { area: 'age-policy.minAge' });
  }
  return CANDIDATE_MIN_AGE_FALLBACK;
}

export interface AgeAttestationState {
  requiredMinAge: number;
  /** Najwyższy zadeklarowany próg; `null` = brak deklaracji. */
  attestedMinAge: number | null;
  meetsPolicy: boolean;
}

export type AgeAttestationLoad =
  | ({ status: 'ready'; demo: boolean } & AgeAttestationState)
  | { status: 'error' };

export async function loadMyAgeAttestation(): Promise<AgeAttestationLoad> {
  const [{ getPortalIdentity, isPortalDataConfigured, withPortalTransaction }, { rpc }] = await Promise.all([
    import('@/lib/db/portal'),
    import('@/lib/db/sql'),
  ]);
  if (!isPortalDataConfigured()) {
    return {
      status: 'ready',
      demo: true,
      requiredMinAge: CANDIDATE_MIN_AGE_FALLBACK,
      attestedMinAge: CANDIDATE_MIN_AGE_FALLBACK,
      meetsPolicy: true,
    };
  }
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };
    const row = await withPortalTransaction(me, (tx) =>
      rpc<Record<string, unknown>>(tx, 'get_my_age_attestation'),
    );
    if (!row) return { status: 'error' };
    const attested = row['attested_min_age'];
    return {
      status: 'ready',
      demo: false,
      requiredMinAge: normalizeCandidateMinAge(row['required_min_age']),
      attestedMinAge: typeof attested === 'number' ? attested : null,
      meetsPolicy: row['meets_policy'] === true,
    };
  } catch (error) {
    captureError(error, { area: 'age-policy.myAttestation' });
    return { status: 'error' };
  }
}
