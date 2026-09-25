import { EMAIL_PROVIDERS, type EmailProvider } from './types';
import type { EmailLabsConfig } from './emaillabs';

/**
 * Wybór dostawcy poczty bez importu SDK (używane też przez `src/lib/env.ts` i `/api/health`).
 */

type Env = Record<string, string | undefined>;

export interface EmailProviderSelection {
  /** Wybrany dostawca; `null` = nic nie skonfigurowano albo nieznana wartość `EMAIL_PROVIDER`. */
  provider: EmailProvider | null;
  /** Wybrany dostawca ma komplet kluczy (bez tego worker nie wysyła). */
  ready: boolean;
}

export function envValue(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

export function emailLabsConfigFromEnv(env: Env = process.env): EmailLabsConfig | null {
  const appKey = envValue(env, 'EMAILLABS_APP_KEY');
  const secretKey = envValue(env, 'EMAILLABS_SECRET_KEY');
  const smtpAccount = envValue(env, 'EMAILLABS_SMTP_ACCOUNT');
  return appKey && secretKey && smtpAccount ? { appKey, secretKey, smtpAccount } : null;
}

/**
 * Wybór dostawcy poczty:
 * - `EMAIL_PROVIDER=emaillabs|resend` — jawnie (brak kluczy wybranego = nie gotowy, BEZ
 *   cichego przełączenia na drugiego dostawcę);
 * - brak zmiennej → EmailLabs, gdy ma komplet kluczy, inaczej Resend, gdy jest `RESEND_API_KEY`;
 * - inna wartość → brak dostawcy (fail-closed, literówka nie wysyła przez „coś”).
 */
export function emailProviderFromEnv(env: Env = process.env): EmailProviderSelection {
  const explicit = envValue(env, 'EMAIL_PROVIDER')?.toLowerCase() ?? null;
  const emaillabsReady = emailLabsConfigFromEnv(env) !== null;
  const resendReady = envValue(env, 'RESEND_API_KEY') !== null;
  if (explicit !== null) {
    if (!(EMAIL_PROVIDERS as readonly string[]).includes(explicit)) return { provider: null, ready: false };
    const provider = explicit as EmailProvider;
    return { provider, ready: provider === 'emaillabs' ? emaillabsReady : resendReady };
  }
  if (emaillabsReady) return { provider: 'emaillabs', ready: true };
  if (resendReady) return { provider: 'resend', ready: true };
  return { provider: null, ready: false };
}

