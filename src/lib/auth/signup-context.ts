import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { APIError } from 'better-auth/api';
import {
  localeSchema,
  registerCandidateSchema,
  registerEmployerSchema,
  type RegisterCandidateInput,
  type RegisterEmployerInput,
} from '../validation/auth';
import {
  registerInvitedEmployerSchema,
  type RegisterInvitedEmployerInput,
} from '../validation/team-invite-signup';
import {
  consentWordingVersions,
  OPTIONAL_CONSENT_PURPOSES,
  signupOptionalConsents,
  type OptionalConsentPurpose,
} from '../signup-consents';

interface SignupCredentials {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

interface SignupMetadata {
  /** v2 (#493): regulamin, informacja o prywatności i zgody opcjonalne osobno (0108). */
  readonly signup_receipt_version: 2;
  readonly agree_terms: true;
  readonly privacy_notice_ack: true;
  readonly optional_consents: Readonly<Record<OptionalConsentPurpose, boolean>>;
  readonly consent_wording: Readonly<Record<string, string>>;
  readonly role: 'candidate' | 'employer';
  readonly locale: NonNullable<RegisterCandidateInput['locale']>;
  readonly first_name: string;
  readonly last_name: string;
  readonly company_name?: string;
}

interface SignupContext {
  readonly credentials: SignupCredentials;
  readonly metadata: SignupMetadata;
  active: boolean;
  admitted: boolean;
}

const signupContext = new AsyncLocalStorage<SignupContext>();

function denied(): never {
  throw new APIError('BAD_REQUEST', {
    code: 'VALIDATED_SIGNUP_REQUIRED',
    message: 'Rejestracja wymaga poprawnie wypełnionego formularza.',
  });
}

async function runSignup<T>(
  input: RegisterCandidateInput | RegisterEmployerInput | RegisterInvitedEmployerInput,
  role: SignupMetadata['role'],
  fallbackLocale: unknown,
  action: (credentials: SignupCredentials) => Promise<T>,
): Promise<T> {
  const credentials = Object.freeze({
    email: input.email.toLowerCase(),
    password: input.password,
    name: `${input.firstName} ${input.lastName}`,
  });
  const locale = input.locale ?? localeSchema.parse(fallbackLocale);
  const metadata: SignupMetadata = Object.freeze({
    signup_receipt_version: 2,
    agree_terms: true,
    privacy_notice_ack: true,
    optional_consents: Object.freeze(signupOptionalConsents(input)),
    consent_wording: Object.freeze(consentWordingVersions('signup', locale, OPTIONAL_CONSENT_PURPOSES)),
    role,
    locale,
    first_name: input.firstName,
    last_name: input.lastName,
    ...('companyName' in input ? { company_name: input.companyName } : {}),
  });
  const context: SignupContext = { credentials, metadata, active: true, admitted: false };
  return signupContext.run(context, async () => {
    try {
      return await action(credentials);
    } finally {
      // Zadanie odłączone od zakończonej akcji nie odziedziczy prawa do rejestracji.
      context.active = false;
    }
  });
}

/** Serwerowy Zod przed SDK; rola wynika z wybranej akcji, nigdy z pola formularza. */
export async function withCandidateSignup<T>(
  input: unknown,
  fallbackLocale: unknown,
  action: (credentials: SignupCredentials) => Promise<T>,
): Promise<T> {
  return runSignup(registerCandidateSchema.parse(input), 'candidate', fallbackLocale, action);
}

export async function withEmployerSignup<T>(
  input: unknown,
  fallbackLocale: unknown,
  action: (credentials: SignupCredentials) => Promise<T>,
): Promise<T> {
  return runSignup(registerEmployerSchema.parse(input), 'employer', fallbackLocale, action);
}

/**
 * Pracodawca z linku zaproszenia do zespołu (0109): bez nazwy firmy w metadanych, więc
 * potwierdzenie adresu nie zakłada firmy — zaproszenie czeka w panelu.
 */
export async function withInvitedEmployerSignup<T>(
  input: unknown,
  fallbackLocale: unknown,
  action: (credentials: SignupCredentials) => Promise<T>,
): Promise<T> {
  return runSignup(registerInvitedEmployerSchema.parse(input), 'employer', fallbackLocale, action);
}

/** Hook endpointu: również duplikat e-maila musi przejść tę samą walidację. */
export function authorizeSignupRequest(body: { email?: unknown; password?: unknown; name?: unknown } | undefined): void {
  const context = signupContext.getStore();
  if (!context?.active || context.admitted || !body
    || body.email !== context.credentials.email
    || body.password !== context.credentials.password
    || body.name !== context.credentials.name) denied();
  context.admitted = true;
}

/** Hook INSERT: prywatne metadane pobiera wyłącznie z bieżącego kontekstu. */
export function signupMetadataForUser(user: { email: string; name: string }): SignupMetadata {
  const context = signupContext.getStore();
  if (!context?.active || !context.admitted
    || user.email !== context.credentials.email
    || user.name !== context.credentials.name) denied();
  return context.metadata;
}
