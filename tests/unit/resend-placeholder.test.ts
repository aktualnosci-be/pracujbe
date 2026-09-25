// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resendApiKeyFromEnv } from '@/lib/email/transport/select';

/**
 * #587 — skopiowany bez zmian `.env.example` nie może dawać fałszywej gotowości poczty. Placeholder
 * `re_YOUR_KEY` musi zachowywać się jak brak klucza w KAŻDYM miejscu, które czyta `RESEND_API_KEY`:
 * `resendApiKeyFromEnv()` jest jedynym źródłem prawdy dla `emailProviderFromEnv`/`mailTransportFromEnv`
 * (`src/lib/email/transport/`) i dla `readinessChecks().resend` (`src/lib/env.ts`).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resendApiKeyFromEnv odrzuca placeholdery (#587)', () => {
  it.each([undefined, '', 're_YOUR_KEY', '  re_YOUR_KEY  '])('traktuje %s jak brak klucza', (value) => {
    expect(resendApiKeyFromEnv({ RESEND_API_KEY: value })).toBeNull();
  });

  it('zwraca prawdziwy klucz bez zmian', () => {
    expect(resendApiKeyFromEnv({ RESEND_API_KEY: 're_live_realistic_key_123' })).toBe(
      're_live_realistic_key_123',
    );
  });

  it('domyślnie czyta z process.env (#587: .env.example skopiowany bez zmian)', () => {
    vi.stubEnv('RESEND_API_KEY', 're_YOUR_KEY');
    expect(resendApiKeyFromEnv()).toBeNull();

    vi.stubEnv('RESEND_API_KEY', 're_live_realistic_key_123');
    expect(resendApiKeyFromEnv()).toBe('re_live_realistic_key_123');
  });

  it('readinessChecks().resend jest false z placeholderem, true z prawdziwym kluczem', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_YOUR_KEY');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    const { readinessChecks } = await import('@/lib/env');
    expect(readinessChecks().resend).toBe(false);
    expect(readinessChecks().emailProviderReady).toBe(false);

    vi.stubEnv('RESEND_API_KEY', 're_live_realistic_key_123');
    expect(readinessChecks().resend).toBe(true);
    expect(readinessChecks().emailProviderReady).toBe(true);
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
