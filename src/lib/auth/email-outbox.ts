import 'server-only';

import { getCurrentAdapter, getCurrentAuthEndpointContext, runWithTransaction } from '@better-auth/core/context';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, requestPasswordReset } from 'better-auth/api';
import { verifyJWT } from 'better-auth/crypto';
import type { Pool } from 'pg';
import { z } from 'zod/v3';
import { routing } from '@/i18n/routing';

type VerificationSender = NonNullable<NonNullable<BetterAuthOptions['emailVerification']>['sendVerificationEmail']>;
type ResetSender = NonNullable<NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']>;

/** Model komendy SQL i transakcyjne opakowanie istniejącego endpointu resetu. */
export const authEmailOutboxPlugin = {
  id: 'pracujbe-auth-email-outbox',
  init: () => ({ context: {
    // Zlecenie e-maila jest częścią zapisu konta. Domyślny helper SDK połyka
    // błędy „background”; tutaj awaria musi dotrzeć do rollbacku transakcji.
    runInBackgroundOrAwait: async (promise: Promise<unknown> | void) => { await promise; },
  } }),
  endpoints: {
    // Transakcja powstaje WEWNĄTRZ endpointu: handler HTTP SDK ustawia swój
    // kontekst adaptera i zastępuje transakcję otwartą wokół auth.handler().
    // Zachowujemy pełną walidację i middleware oryginalnego endpointu.
    requestPasswordReset: createAuthEndpoint(requestPasswordReset.path, requestPasswordReset.options,
      context => runWithTransaction(context.context.adapter, () => requestPasswordReset({
        ...context, asResponse: false, returnHeaders: false, returnStatus: false,
      }))),
  },
  schema: {
    authEmailEnqueue: {
      modelName: 'email_enqueue',
      disableMigration: true,
      fields: {
        userId: { type: 'string', fieldName: 'user_id', required: true, input: false, returned: false },
        kind: { type: 'string', required: true, input: false, returned: false },
        token: { type: 'string', required: true, input: false, returned: false },
        expiresAt: { type: 'date', fieldName: 'expires_at', required: true, input: false, returned: false },
      },
    },
  },
} satisfies BetterAuthPlugin;

function queueFailed(): never {
  // Przyczyna z pg może zawierać treść SQL lub poświadczenie. Nie dołączamy jej do SDK.
  throw new APIError('INTERNAL_SERVER_ERROR', {
    code: 'AUTH_EMAIL_QUEUE_FAILED', message: 'Nie udało się zapisać zlecenia wiadomości.',
  });
}

/** Callback czeka na INSERT. W signup jest to ten sam COMMIT co konto i receipty. */
export function createAuthEmailSenders(secret: string): {
  sendVerificationEmail: VerificationSender;
  sendResetPassword: ResetSender;
} {
  const enqueue = async (userId: string, kind: 'verification' | 'password_reset', token: string, expiresAt: Date) => {
    const context = getCurrentAuthEndpointContext();
    const adapter = await getCurrentAdapter(context.context.adapter);
    const receipt = await adapter.create<{ id: string }>({
      model: 'authEmailEnqueue', data: { userId, kind, token, expiresAt },
    });
    if (!receipt?.id) queueFailed();
  };
  return {
    sendVerificationEmail: async ({ user, token }) => {
      try {
        const payload = z.object({ email: z.string(), exp: z.number().int().positive(), updateTo: z.undefined() })
          .parse(await verifyJWT<unknown>(token, secret));
        if (payload.email.toLowerCase() !== user.email.toLowerCase()) queueFailed();
        await enqueue(user.id, 'verification', token, new Date(payload.exp * 1000));
      } catch { queueFailed(); }
    },
    sendResetPassword: async ({ user, token }) => {
      try {
        const context = getCurrentAuthEndpointContext();
        const adapter = await getCurrentAdapter(context.context.adapter);
        const verification = await adapter.findOne<{ value: string; expiresAt: Date }>({
          model: 'verification', where: [{ field: 'identifier', value: `reset-password:${token}` }],
        });
        if (!verification || verification.value !== user.id) queueFailed();
        await enqueue(user.id, 'password_reset', token, verification.expiresAt);
      } catch { queueFailed(); }
    },
  };
}

const deliverySchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(),
  kind: z.enum(['verification', 'password_reset']),
  recipient_email: z.string().email(), first_name: z.string(),
  recipient_role: z.enum(['candidate', 'employer', 'admin']),
  locale: z.enum(routing.locales),
  token: z.string().min(1).max(4096), expires_at: z.date(),
  lease_id: z.string().uuid(), lease_expires_at: z.date(),
});
export type AuthEmailDelivery = z.infer<typeof deliverySchema>;
type MailPool = Pick<Pool, 'query'>;

/** Pool używa wyłącznie roli pracujbe_auth_mail, bez dostępu do tabel domenowych. */
export async function claimAuthEmails(pool: MailPool, limit = 20, leaseSeconds = 300): Promise<AuthEmailDelivery[]> {
  const result = await pool.query('SELECT * FROM auth.claim_emails($1, $2)', [limit, leaseSeconds]);
  return deliverySchema.array().parse(result.rows);
}

export async function completeAuthEmail(pool: MailPool, delivery: AuthEmailDelivery, providerMessageId: string): Promise<boolean> {
  const result = await pool.query('SELECT auth.complete_email($1,$2,$3) AS completed', [delivery.id, delivery.lease_id, providerMessageId]);
  return result.rows[0]?.completed === true;
}

export async function failAuthEmail(pool: MailPool, delivery: AuthEmailDelivery,
  errorCode: 'delivery_failed' | 'render_failed' | 'provider_unavailable'): Promise<boolean> {
  const result = await pool.query('SELECT auth.fail_email($1,$2,$3) AS recorded', [delivery.id, delivery.lease_id, errorCode]);
  return result.rows[0]?.recorded === true;
}

export type AuthSendBudget = { granted: true } | { granted: false; retryAt: Date | null };

/**
 * Budżet okna dostawcy dla puli `auth` (0087 przez nakładkę `auth.take_send_budget`, 0136).
 * Odmowa = okno pełne; `retryAt` = początek następnego okna.
 */
export async function takeAuthSendBudget(pool: MailPool, template: 'accountConfirmation' | 'passwordReset'): Promise<AuthSendBudget> {
  const row = (await pool.query('SELECT granted, retry_at FROM auth.take_send_budget($1)', [template])).rows[0] as
    { granted?: boolean; retry_at?: Date | string | null } | undefined;
  if (row?.granted === false) {
    const retryAt = row.retry_at ? new Date(row.retry_at) : null;
    return { granted: false, retryAt: retryAt && !Number.isNaN(retryAt.getTime()) ? retryAt : null };
  }
  return { granted: true };
}

/** Odmowa budżetu: zlecenie wraca do kolejki bez zużycia próby (0136). */
export async function deferAuthEmail(pool: MailPool, delivery: AuthEmailDelivery, retryAt: Date | null): Promise<boolean> {
  const result = await pool.query('SELECT auth.defer_email($1,$2,$3) AS deferred', [delivery.id, delivery.lease_id, retryAt]);
  return result.rows[0]?.deferred === true;
}

export async function expireAuthEmails(pool: MailPool): Promise<number> {
  return (await pool.query('SELECT auth.expire_emails() AS expired')).rows[0]?.expired ?? 0;
}

/** Ścieżki stron aplikacji (bez prefiksu języka), które przyjmują token z e-maila. */
export const AUTH_LINK_PAGES = { verification: '/potwierdz-email', password_reset: '/ustaw-nowe-haslo' } as const;

/**
 * Dane istniejącego szablonu. Bez wysyłki, logowania poświadczenia i URL od klienta.
 *
 * Link prowadzi do strony aplikacji w języku ODBIORCY (snapshot z kolejki), a token jest we
 * fragmencie `#token=` (#505): przeglądarka nie wysyła fragmentu do serwera, więc sekret nie
 * trafia do logów proxy/aplikacji ani do nagłówka Referer. Strona przekazuje go do Server Action
 * dopiero po kliknięciu przycisku — skaner linków w skrzynce nie potwierdzi konta ani nie
 * zużyje tokenu resetu. Rola nie jest częścią linku: panel po weryfikacji wynika z profilu.
 */
export function prepareAuthEmail(delivery: AuthEmailDelivery, baseURL: string) {
  const origin = new URL(baseURL);
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Auth wymaga kanonicznego origin HTTPS.');
  const now = Date.now();
  if (delivery.expires_at.getTime() <= now || delivery.lease_expires_at.getTime() <= now) {
    throw new Error('Dzierżawa lub poświadczenie wiadomości wygasły.');
  }
  const reset = delivery.kind === 'password_reset';
  const link = new URL(`/${delivery.locale}${AUTH_LINK_PAGES[delivery.kind]}`, origin);
  link.hash = new URLSearchParams({ token: delivery.token }).toString();
  return {
    to: delivery.recipient_email, locale: delivery.locale, idempotencyKey: delivery.id,
    template: reset ? 'passwordReset' as const : 'accountConfirmation' as const,
    data: { firstName: delivery.first_name, ...(reset ? { resetUrl: link.href } : { confirmationUrl: link.href }) },
  };
}
