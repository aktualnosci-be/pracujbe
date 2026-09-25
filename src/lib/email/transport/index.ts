import { emailLabsTransport } from './emaillabs';
import { resendTransport } from './resend';
import { emailLabsConfigFromEnv, emailProviderFromEnv, envValue } from './select';
import type { MailTransport } from './types';

export { MailSendError } from './types';
export { emailLabsConfigFromEnv, emailProviderFromEnv } from './select';
export type { EmailProviderSelection } from './select';
export type { EmailProvider, MailErrorCode, MailMessage, MailSendOptions, MailTransport } from './types';

type Env = Record<string, string | undefined>;

/** Transport wybranego dostawcy albo `null`, gdy nie jest gotowy (worker pomija wysyłkę). */
export function mailTransportFromEnv(env: Env = process.env): MailTransport | null {
  const { provider, ready } = emailProviderFromEnv(env);
  if (!ready) return null;
  if (provider === 'emaillabs') {
    const config = emailLabsConfigFromEnv(env);
    return config ? emailLabsTransport(config) : null;
  }
  const apiKey = envValue(env, 'RESEND_API_KEY');
  return provider === 'resend' && apiKey ? resendTransport(apiKey) : null;
}
