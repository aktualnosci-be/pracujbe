// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { expectNoPii } from '../helpers/privacy-fixtures';
import { emitAll, init, sent } from '../helpers/sentry-harness';

/**
 * #502 — payload WYCHODZĄCY z SDK (przechwycony transport) z filtrem #508 (`redactSentryEvent`):
 * ręczne `captureError`, automatyczne `onRequestError`, breadcrumbs, `cause` i tracing. Kontrola ujemna: privacy-sentry-sdk-control.test.ts.
 */
describe('Sentry SDK — payload wychodzący', () => {
  beforeAll(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Sentry.close();
  });

  it('z filtrem: brak PII w błędach, cause, extra, breadcrumbs, request i tracingu; kod zostaje', async () => {
    init(true);
    await emitAll();
    const payload = sent.join('\n');
    expect(payload.match(/"errorCode":"INTERNAL"/g)).toHaveLength(2); // captureError + onRequestError
    // tracing wyłączony (#508) — brak transakcji
    expectNoPii(payload);
    expect(payload).not.toContain('203.0.113.9');
    expect(payload).not.toContain('"type":"transaction"');
    expect(payload).toContain('"errorCode":"INTERNAL"');
  });
});
