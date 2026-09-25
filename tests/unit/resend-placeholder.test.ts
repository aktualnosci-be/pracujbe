// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * #587 — skopiowany bez zmian `.env.example` nie może dawać fałszywej gotowości poczty. Placeholder
 * `re_YOUR_KEY` musi zachowywać się jak brak klucza: `resendApiKey()`/`readinessChecks().resend`
 * i workery kolejki (`email/outbox.ts`, `auth/email-worker.ts`) czytają wyłącznie ten helper.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resendApiKey odrzuca placeholdery (#587)', () => {
  it.each([undefined, '', 're_YOUR_KEY'])('traktuje %s jak brak klucza', async (value) => {
    if (value === undefined) vi.stubEnv('RESEND_API_KEY', '');
    else vi.stubEnv('RESEND_API_KEY', value);
    const { resendApiKey } = await import('@/lib/env');
    expect(resendApiKey()).toBeUndefined();
  });

  it('zwraca prawdziwy klucz bez zmian', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_live_realistic_key_123');
    const { resendApiKey } = await import('@/lib/env');
    expect(resendApiKey()).toBe('re_live_realistic_key_123');
  });

  it('readinessChecks().resend jest false z placeholderem, true z prawdziwym kluczem', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_YOUR_KEY');
    const { readinessChecks } = await import('@/lib/env');
    expect(readinessChecks().resend).toBe(false);

    vi.stubEnv('RESEND_API_KEY', 're_live_realistic_key_123');
    expect(readinessChecks().resend).toBe(true);
  });
});

describe('.env.example nie zawiera aktywnego placeholdera Resend (#587, kontrola ujemna)', () => {
  it('RESEND_API_KEY jest pusty, jak pozostałe sekrety przykładowego pliku', () => {
    const content = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    const line = content.split('\n').find((l) => l.startsWith('RESEND_API_KEY='));
    expect(line).toBeDefined();
    expect(line).toMatch(/^RESEND_API_KEY=""?$/);
  });

  it('kontrola ujemna: dawny placeholder byłby wykryty', () => {
    const line = 'RESEND_API_KEY="re_YOUR_KEY"';
    expect(line).not.toMatch(/^RESEND_API_KEY=""?$/);
  });
});
