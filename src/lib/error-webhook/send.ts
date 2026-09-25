import type { ErrorReport, ErrorReporter } from '@/lib/error-report';

import { buildErrorWebhookPayload, buildErrorWebhookText, safeErrorCode } from './message';
import { errorWebhookFromEnv, type ErrorWebhookTarget } from './url';

/** Ten sam kod najwyżej raz na to okno. */
export const ERROR_WEBHOOK_DEDUP_MS = 10 * 60 * 1000;
export const ERROR_WEBHOOK_TIMEOUT_MS = 3000;
/** Górna granica przerwy po 429 (Discord podaje `retry_after` w sekundach). */
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const MAX_TRACKED_CODES = 200;

export interface ErrorWebhookDeps {
  fetch?: typeof fetch;
  now?: () => number;
  target?: () => ErrorWebhookTarget | null;
  release?: () => string | undefined;
  environment?: () => string | undefined;
  dedupMs?: number;
  timeoutMs?: number;
}

export type ErrorWebhookResult = 'sent' | 'disabled' | 'deduplicated' | 'rate_limited' | 'failed';

function retryAfterMs(response: Response, body: unknown): number {
  const fromBody =
    typeof body === 'object' && body !== null && typeof (body as { retry_after?: unknown }).retry_after === 'number'
      ? (body as { retry_after: number }).retry_after
      : NaN;
  const header = Number(response.headers.get('retry-after'));
  const seconds = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(header) && header > 0 ? header : 60;
  return Math.min(Math.ceil(seconds * 1000), MAX_BACKOFF_MS);
}

/**
 * Wysyłka zgłoszeń błędów na webhook (#571). Stan (deduplikacja, przerwa po 429) jest per
 * proces. Każda awaria (sieć, timeout, 4xx/5xx) kończy się cicho — bez adresu w logach.
 */
export function createErrorWebhookSender(deps: ErrorWebhookDeps = {}) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? Date.now;
  const target = deps.target ?? errorWebhookFromEnv;
  const release = deps.release ?? (() => process.env.NEXT_PUBLIC_APP_VERSION);
  const environment =
    deps.environment ?? (() => process.env.RAILWAY_ENVIRONMENT_NAME || process.env.APP_MODE || process.env.NODE_ENV);
  const dedupMs = deps.dedupMs ?? ERROR_WEBHOOK_DEDUP_MS;
  const timeoutMs = deps.timeoutMs ?? ERROR_WEBHOOK_TIMEOUT_MS;

  const lastSent = new Map<string, number>();
  const suppressed = new Map<string, number>();
  let blockedUntil = 0;

  async function send(report: ErrorReport): Promise<ErrorWebhookResult> {
    const webhook = target();
    if (!webhook) return 'disabled';
    const code = safeErrorCode(report.code);
    const at = now();

    if (at < blockedUntil) {
      suppressed.set(code, (suppressed.get(code) ?? 0) + 1);
      return 'rate_limited';
    }
    const previous = lastSent.get(code);
    if (previous !== undefined && at - previous < dedupMs) {
      suppressed.set(code, (suppressed.get(code) ?? 0) + 1);
      return 'deduplicated';
    }
    if (lastSent.size >= MAX_TRACKED_CODES && !lastSent.has(code)) {
      const oldest = lastSent.keys().next().value;
      if (oldest !== undefined) lastSent.delete(oldest);
    }
    lastSent.delete(code);
    lastSent.set(code, at);
    const repeated = suppressed.get(code) ?? 0;
    suppressed.delete(code);

    const text = buildErrorWebhookText({
      code,
      route: report.route,
      release: release(),
      environment: environment(),
      time: new Date(at),
      repeated,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(webhook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildErrorWebhookPayload(webhook.format, text)),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.status === 429) {
        const body: unknown = await response.json().catch(() => null);
        blockedUntil = now() + retryAfterMs(response, body);
        return 'rate_limited';
      }
      return response.ok ? 'sent' : 'failed';
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  const reporter: ErrorReporter = (report) => {
    void send(report).catch(() => undefined);
  };

  return { send, reporter };
}
