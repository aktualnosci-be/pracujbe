// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { expectNoPii } from '../helpers/privacy-fixtures';
import { emitAll, init, sent } from '../helpers/sentry-harness';

/**
 * #502 — payload WYCHODZĄCY z SDK (przechwycony transport): ręczne `captureError`,
 * automatyczne `onRequestError`, breadcrumbs i tracing. Kontrola ujemna: privacy-sentry-sdk-control.test.ts.
 */
describe('Sentry SDK — payload wychodzący', () => {
  beforeAll(() => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Sentry.close();
  });

  it('z filtrem: brak PII w błędach, cause, extra, breadcrumbs, request i tracingu; kod i obszar zostają', async () => {
    init(true);
    await emitAll();
    const payload = sent.join('\n');
    expect(sent.length).toBeGreaterThanOrEqual(3); // 2 błędy + transakcja
    expectNoPii(payload);
    expect(payload).not.toContain('203.0.113.9');
    expect(payload).toContain('"errorCode":"INTERNAL"');
    expect(payload).toContain('"area":"candidate.profile"');
    expect(payload).toContain('/pl/aplikacja/potwierdz?[Filtered]');
  });
});
