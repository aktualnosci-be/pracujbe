import 'server-only';

import { registerEmployerSchema } from '../validation/auth';

/**
 * Nazwa firmy podana przy rejestracji pracodawcy — w prywatnych metadanych konta
 * (`auth.users.raw_user_meta_data.company_name`, zapisanych serwerowo przez adapter; trigger 0059
 * usuwa z metadanych tylko IP/UA receiptu, nazwa zostaje).
 *
 * Źródło nazwy dla automatycznego bootstrapu firmy (`confirmEmail`) i podpowiedź w formularzu
 * zakładania firmy, gdy bootstrap się nie udał. Wartość przechodzi tę samą regułę co pole
 * rejestracji, więc podpowiedź zawsze da się zapisać bez poprawek.
 */
export function companyNameFromMetadata(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const meta = (user as Record<string, unknown>)['raw_user_meta_data'];
  if (!meta || typeof meta !== 'object') return null;
  const name = (meta as Record<string, unknown>)['company_name'];
  if (typeof name !== 'string') return null;
  const parsed = registerEmployerSchema.innerType().shape.companyName.safeParse(name.trim());
  return parsed.success ? parsed.data : null;
}

/** Minimalny kontrakt adaptera Better Auth potrzebny do odczytu (`auth.$context`). */
export interface SignupNameAuth {
  $context: Promise<{ internalAdapter: { findUserById(id: string): Promise<unknown> } }>;
}

/**
 * Podpowiedź nazwy firmy dla zalogowanego pracodawcy bez firmy. UUID wyłącznie z tożsamości sesji
 * (`getCurrentIdentity`). Każdy błąd odczytu = pusta podpowiedź: formularz nadal działa, a awaria
 * adaptera nie blokuje zakładania firmy.
 */
export async function readSignupCompanyName(
  userId: string,
  loadAuth?: () => Promise<SignupNameAuth>,
): Promise<string> {
  try {
    const auth = loadAuth
      ? await loadAuth()
      : ((await (await import('./runtime')).getAuthRuntime()) as unknown as SignupNameAuth);
    const context = await auth.$context;
    return companyNameFromMetadata(await context.internalAdapter.findUserById(userId)) ?? '';
  } catch {
    return '';
  }
}
