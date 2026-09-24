// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { PII } from '../helpers/privacy-fixtures';
import { emitAll, init, sent } from '../helpers/sentry-harness';

/**
 * #502 — payload WYCHODZĄCY z SDK (przechwycony transport): ręczne `captureError`,
 * automatyczne `onRequestError`, breadcrumbs i tracing. KONTROLA UJEMNA dla privacy-sentry-sdk.test.ts: bez filtra PII opuszcza SDK,\n * więc test z filtrem sprawdza realną ścieżkę (osobny plik = osobny klient SDK).
 */
describe('Sentry SDK — payload wychodzący', () => {
  beforeAll(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Sentry.close();
  });

  it('bez filtra dane kandydata opuszczają SDK', async () => {
    init(false);
    await emitAll();
    const payload = sent.join('\n');
    for (const value of [PII.email, PII.token, PII.lastName, PII.firstName, PII.nissPlain]) {
      expect(payload).toContain(value);
    }
  });
});
