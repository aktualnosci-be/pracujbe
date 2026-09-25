import 'server-only';

import { randomUUID } from 'node:crypto';

import { env, isProductionMode } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';

import {
  TURNSTILE_ACTIONS,
  TURNSTILE_PROVIDER_FAILURE,
  turnstileSiteKey,
  type TurnstileFlow,
} from './policy';

/**
 * Serwerowa weryfikacja Cloudflare Turnstile (siteverify, #46). Sekret czytany wyłącznie
 * tutaj (moduł `server-only`).
 *
 * Stany konfiguracji:
 * - `enabled`     — oba klucze ustawione: token jest wymagany i weryfikowany;
 * - `disabled`    — brak obu kluczy poza trybem produkcyjnym (demo/lokalnie/E2E): widżet
 *                   się nie pokazuje, weryfikacja jest pomijana;
 * - `unconfigured`— tryb produkcyjny bez kluczy albo tylko jeden z dwóch kluczy: traktowane
 *                   jak niedostępny dostawca (polityka przepływu decyduje: `closed` odrzuca,
 *                   `open` przepuszcza).
 *
 * Token jest jednorazowy: Cloudflare odrzuca ponowne użycie (`timeout-or-duplicate`), a
 * `idempotency_key` pozwala bezpiecznie ponowić samo zapytanie. Sprawdzamy też akcję
 * (token z innego formularza) i hostname (token z obcej domeny).
 *
 * Logi: tylko przepływ, powód i kody błędów Cloudflare — nigdy token ani IP.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 5000;
/** Tokeny Turnstile mają do 2048 znaków; dłuższa wartość nie jest tokenem. */
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileConfigState = 'enabled' | 'disabled' | 'unconfigured';

export function turnstileConfigState(): TurnstileConfigState {
  const siteKey = turnstileSiteKey();
  const secret = process.env.TURNSTILE_SECRET_KEY || undefined;
  if (siteKey && secret) return 'enabled';
  if (!siteKey && !secret && !isProductionMode()) return 'disabled';
  return 'unconfigured';
}

/** Czy ochrona Turnstile jest włączona (do /api/health; bez ujawniania kluczy). */
export function isTurnstileEnabled(): boolean {
  return turnstileConfigState() === 'enabled';
}

/** Dozwolone hostname tokenu: `TURNSTILE_ALLOWED_HOSTNAMES` (lista po przecinku) albo host `NEXT_PUBLIC_SITE_URL`. */
function allowedHostnames(): string[] {
  const configured = (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  try {
    return [new URL(env.siteUrl).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

export type TurnstileRejectReason =
  | 'missing_token'
  | 'invalid_token'
  | 'action_mismatch'
  | 'hostname_mismatch';

export type TurnstileUnavailableReason =
  | 'unconfigured'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'provider_error';

export type TurnstileVerification =
  | { status: 'passed' }
  | { status: 'skipped' }
  | { status: 'rejected'; reason: TurnstileRejectReason; codes?: string[] }
  | { status: 'unavailable'; reason: TurnstileUnavailableReason; codes?: string[] };

export interface VerifyOptions {
  /** Wstrzykiwany w testach — testy nigdy nie łączą się z Cloudflare. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Kody siteverify oznaczające problem po stronie dostawcy lub naszej konfiguracji, a nie zły token. */
const PROVIDER_SIDE_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'internal-error',
]);

interface SiteverifyResponse {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  'error-codes'?: unknown;
}

/** Weryfikuje token dla danego przepływu. Nie rzuca — każdy wynik jest wartością. */
export async function verifyTurnstileToken(
  flow: TurnstileFlow,
  token: unknown,
  options: VerifyOptions = {},
): Promise<TurnstileVerification> {
  const state = turnstileConfigState();
  if (state === 'disabled') return { status: 'skipped' };
  if (state === 'unconfigured') return { status: 'unavailable', reason: 'unconfigured' };

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { status: 'rejected', reason: 'missing_token' };
  }

  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY ?? '',
    response: token,
    idempotency_key: randomUUID(),
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  let payload: SiteverifyResponse;
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'unavailable', reason: 'provider_error' };
    payload = (await response.json()) as SiteverifyResponse;
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { status: 'unavailable', reason: 'timeout' };
    }
    if (e instanceof SyntaxError) return { status: 'unavailable', reason: 'bad_response' };
    return { status: 'unavailable', reason: 'network' };
  }

  if (typeof payload !== 'object' || payload === null) {
    return { status: 'unavailable', reason: 'bad_response' };
  }
  const codes = Array.isArray(payload['error-codes'])
    ? payload['error-codes'].filter((c): c is string => typeof c === 'string')
    : [];

  if (payload.success !== true) {
    if (codes.some((c) => PROVIDER_SIDE_CODES.has(c))) {
      return { status: 'unavailable', reason: 'provider_error', codes };
    }
    return { status: 'rejected', reason: 'invalid_token', codes };
  }
  if (payload.action !== TURNSTILE_ACTIONS[flow]) {
    return { status: 'rejected', reason: 'action_mismatch' };
  }
  const hostname = typeof payload.hostname === 'string' ? payload.hostname.toLowerCase() : '';
  if (!allowedHostnames().includes(hostname)) {
    return { status: 'rejected', reason: 'hostname_mismatch' };
  }
  return { status: 'passed' };
}

/**
 * Stosuje politykę przepływu do wyniku weryfikacji. Zwraca kod błędu dla formularza albo
 * `null`, gdy żądanie może przejść dalej.
 */
export function turnstileDecision(
  flow: TurnstileFlow,
  result: TurnstileVerification,
): ErrorCode | null {
  switch (result.status) {
    case 'passed':
    case 'skipped':
      return null;
    case 'rejected':
      return 'BOT_CHECK_FAILED';
    case 'unavailable':
      return TURNSTILE_PROVIDER_FAILURE[flow] === 'open' ? null : 'BOT_CHECK_UNAVAILABLE';
  }
}

/**
 * Weryfikacja + polityka + log dla Server Actions. Zwraca kod błędu (`BOT_CHECK_FAILED` /
 * `BOT_CHECK_UNAVAILABLE`) albo `null`, gdy formularz może być przetworzony.
 */
export async function enforceTurnstile(
  flow: TurnstileFlow,
  token: unknown,
  options?: VerifyOptions,
): Promise<ErrorCode | null> {
  const result = await verifyTurnstileToken(flow, token, options);
  const decision = turnstileDecision(flow, result);

  // Awaria dostawcy/konfiguracji to sygnał operacyjny (kanał błędów). Odrzucony token — zwykły
  // ruch botów lub wygasły token; bez zgłoszeń, żeby nie zalewać monitoringu.
  if (result.status === 'unavailable') {
    captureError(new Error('turnstile_unavailable'), {
      area: 'turnstile',
      flow,
      reason: result.reason,
      codes: result.codes,
      failOpen: decision === null,
    });
  }
  return decision;
}
