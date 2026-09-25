import 'server-only';

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import type { Pool } from 'pg';
import { authorizeSignupRequest, signupMetadataForUser } from './signup-context';
import { authEmailOutboxPlugin, createAuthEmailSenders } from './email-outbox';

type VerificationSender = NonNullable<NonNullable<BetterAuthOptions['emailVerification']>['sendVerificationEmail']>;
type ResetSender = NonNullable<NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']>;

export interface AuthServerDependencies {
  /** Oddzielna pula z rolą pracujbe_auth i search_path=auth; nigdy pula domeny. */
  pool: Pool;
  /** Kanoniczny origin HTTPS. Nie pochodzi z Host ani nagłówków proxy. */
  baseURL: string;
  secret: string;
  /** Domyślnie trwała kolejka 0061; nadpisanie służy kontrolowanym adapterom/testom. */
  sendVerificationEmail?: VerificationSender;
  sendResetPassword?: ResetSender;
}


/**
 * Adapter schematu 0057. Bez globalnej instancji, odczytu env i publicznej trasy.
 * Pula, sekrety i trwała wysyłka są odpowiedzialnością wywołującego.
 * Signup wymaga walidowanego kontekstu; profil i receipty zapisują triggery 0008/0059.
 * Hasła/sesje SDK nie zastępują sprawdzenia aktywności profilu i reguł domenowych.
 */
export function createAuthServer(dependencies: AuthServerDependencies) {
  let origin: URL;
  try {
    origin = new URL(dependencies.baseURL);
  } catch {
    throw new Error('Auth wymaga kanonicznego origin HTTPS.');
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Auth wymaga kanonicznego origin HTTPS.');
  }
  if (dependencies.secret.trim().length < 32) {
    throw new Error('Auth wymaga osobnego sekretu o długości co najmniej 32 znaków.');
  }

  const senders = createAuthEmailSenders(dependencies.secret);
  const auth = betterAuth({
    database: dependencies.pool,
    baseURL: origin.origin,
    secret: dependencies.secret,
    trustedOrigins: [origin.origin],
    logger: {
      // SDK bywa wywoływane z surowym pg.Error; ani message, ani args nie są bezpieczne.
      log: level => {
        if (level === 'error') console.error('AUTH_SDK_ERROR');
        else if (level === 'warn') console.warn('AUTH_SDK_WARNING');
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: true,
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        // SDK nazywa wyłączenie pola z odpowiedzi `returned`, nie `output`.
        raw_user_meta_data: { type: 'json', required: false, input: false, returned: false },
      },
      // Domenowe usuwanie konta i zmiana e-maila wymagają osobnego procesu.
      deleteUser: { enabled: false },
      changeEmail: { enabled: false },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        idToken: 'id_token',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: dependencies.sendResetPassword ?? senders.sendResetPassword,
    },
    emailVerification: {
      sendOnSignUp: true,
      // Logowanie niepotwierdzonego konta (dopiero PO poprawnym haśle, więc bez enumeracji)
      // zleca nowy link — wygasły link z rejestracji nie blokuje aktywacji konta.
      sendOnSignIn: true,
      // Link ważny 12 h (domyślnie SDK: godzina; kolejka 0061 przyjmuje najwyżej dobę).
      expiresIn: 60 * 60 * 12,
      autoSignInAfterVerification: true,
      sendVerificationEmail: dependencies.sendVerificationEmail ?? senders.sendVerificationEmail,
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (context.path === '/sign-up/email') authorizeSignupRequest(context.body);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async user => ({ data: { ...user, raw_user_meta_data: signupMetadataForUser(user) } }),
        },
      },
    },
    // auth.api nie stosuje limitera HTTP SDK. Akcje nadal wymagają checkRateLimit.
    plugins: [authEmailOutboxPlugin, nextCookies()],
  });

  return auth;
}
