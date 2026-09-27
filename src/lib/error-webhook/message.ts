import { ErrorCodes } from '@/lib/errors';
import { FILTERED, redactString, redactUrl } from '@/lib/privacy/redact';

import type { ErrorWebhookFormat } from './url';

/** Limit treści wiadomości Discorda (`content`), także dla adresu `/slack`. */
export const ERROR_WEBHOOK_MAX_CHARS = 2000;

const ALLOWED_CODES = new Set<string>(Object.values(ErrorCodes));
const MAX_ROUTE = 300;
const MAX_LABEL = 80;

export interface ErrorWebhookMessage {
  code: string;
  route?: string;
  release?: string;
  environment?: string;
  time: Date;
  /** `client` = błąd z przeglądarki (`/api/client-error`). */
  source?: 'server' | 'client';
  /** Ile zgłoszeń tego kodu pominięto od poprzedniej wiadomości (deduplikacja). */
  repeated?: number;
}

/** Kod spoza słownika `ErrorCodes` (np. tekst z wyjątku) nie przechodzi — zostaje `INTERNAL`. */
export function safeErrorCode(code: string): string {
  return ALLOWED_CODES.has(code) ? code : 'INTERNAL';
}

/**
 * Trasa bez query i fragmentu, bez segmentów wyglądających na token lub dane osobowe
 * (`redactUrl`, #502) i bez znaków formatowania Markdown/wzmianki — tylko znaki ścieżki
 * i szablonu App Routera (`[locale]`, `(public)`).
 */
export function safeRoute(route: string | undefined): string {
  if (!route) return '-';
  let path = redactUrl(route.trim());
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  path = path.replace(/[?#]\[Filtered\]$/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  const safe = path
    .split('/')
    .map((segment) => (segment === '' || /^[A-Za-z0-9_.~\-[\]()]+$/.test(segment) || segment === FILTERED ? segment : FILTERED))
    .join('/');
  return safe.length > MAX_ROUTE ? `${safe.slice(0, MAX_ROUTE)}…` : safe;
}

function safeLabel(value: string | undefined): string {
  if (!value) return '-';
  const redacted = redactString(value).replace(/[^A-Za-z0-9._+\-[\]]/g, '');
  if (!redacted) return '-';
  return redacted.length > MAX_LABEL ? redacted.slice(0, MAX_LABEL) : redacted;
}

/** Tekst wiadomości: wyłącznie kod, trasa, wydanie, środowisko i czas — obcięty do limitu. */
export function buildErrorWebhookText(message: ErrorWebhookMessage): string {
  const lines = [
    message.source === 'client' ? 'pracuj.be: błąd w przeglądarce' : 'pracuj.be: błąd serwera',
    `Kod: ${safeErrorCode(message.code)}`,
    `Trasa: ${safeRoute(message.route)}`,
    `Wydanie: ${safeLabel(message.release)}`,
    `Środowisko: ${safeLabel(message.environment)}`,
    `Czas: ${message.time.toISOString()}`,
  ];
  if (message.repeated && message.repeated > 0) {
    lines.push(`Pominięte powtórzenia: ${Math.floor(message.repeated)}`);
  }
  const text = lines.join('\n');
  return text.length > ERROR_WEBHOOK_MAX_CHARS ? `${text.slice(0, ERROR_WEBHOOK_MAX_CHARS - 1)}…` : text;
}

/** Payload wg postaci adresu: Slack-compatible = `{text}`, natywny Discord = bez wzmianek. */
export function buildErrorWebhookPayload(format: ErrorWebhookFormat, text: string): Record<string, unknown> {
  const limited = text.length > ERROR_WEBHOOK_MAX_CHARS ? `${text.slice(0, ERROR_WEBHOOK_MAX_CHARS - 1)}…` : text;
  if (format === 'slack') return { text: limited };
  return { content: limited, allowed_mentions: { parse: [] } };
}
