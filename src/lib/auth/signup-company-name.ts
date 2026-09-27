import 'server-only';

import { captureError } from '@/lib/error-report';
import { getAuthRuntime } from './runtime';
import type { PortalIdentity } from './session';

/**
 * Nazwa firmy z prywatnych metadanych rejestracji (`raw_user_meta_data.company_name`,
 * zapisane serwerowo przez `signupMetadataForUser` — `src/lib/auth/signup-context.ts`).
 * Wspólna z `confirmEmail` (bootstrap firmy) i formularzem zakładania firmy (#365).
 */
export function companyNameFromMetadata(user: Record<string, unknown>): string | null {
  const meta = user['raw_user_meta_data'];
  if (!meta || typeof meta !== 'object') return null;
  const name = (meta as Record<string, unknown>)['company_name'];
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

/**
 * Domyślna nazwa firmy podana przy rejestracji WŁASNEGO konta (#365) — wypełnia formularz
 * zakładania firmy, gdy automatyczny bootstrap po potwierdzeniu e-maila się nie udał.
 * Czyta metadane WYŁĄCZNIE konta wskazanego przez `identity.id` (z sesji, nigdy z URL/formularza).
 * Błąd odczytu lub brak metadanych → pusty string (formularz zostaje pusty, nie blokuje zakładania firmy).
 */
export async function readSignupCompanyName(identity: PortalIdentity): Promise<string> {
  try {
    const auth = await getAuthRuntime();
    const context = await auth.$context;
    const found = await context.internalAdapter.findUserById(identity.id);
    if (!found) return '';
    return companyNameFromMetadata(found as unknown as Record<string, unknown>) ?? '';
  } catch (error) {
    captureError(error, { area: 'auth.readSignupCompanyName' });
    return '';
  }
}
