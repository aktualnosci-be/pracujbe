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

interface SignupCredentials {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

interface SignupMetadata {
  readonly signup_receipt_version: 1;
  readonly agree_terms: true;
  readonly role: 'candidate' | 'employer';
  readonly locale: NonNullable<RegisterCandidateInput['locale']>;
  readonly first_name: string;
  readonly last_name: string;
  readonly company_name?: string;
  /** #492: zadeklarowany próg wieku kandydata (bez daty urodzenia); trigger zapisuje receipt. */
  readonly age_min_attested?: number;
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
  input: RegisterCandidateInput | RegisterEmployerInput,
  role: SignupMetadata['role'],
  fallbackLocale: unknown,
  action: (credentials: SignupCredentials) => Promise<T>,
): Promise<T> {
  const credentials = Object.freeze({
    email: input.email.toLowerCase(),
    password: input.password,
    name: `${input.firstName} ${input.lastName}`,
  });
  const metadata: SignupMetadata = Object.freeze({
    signup_receipt_version: 1,
    agree_terms: true,
    role,
    locale: input.locale ?? localeSchema.parse(fallbackLocale),
    first_name: input.firstName,
    last_name: input.lastName,
    ...('companyName' in input ? { company_name: input.companyName } : {}),
    ...('minAge' in input ? { age_min_attested: input.minAge } : {}),
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
