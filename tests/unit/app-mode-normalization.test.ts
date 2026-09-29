// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../../next.config.mjs';
import { env, isProductionDeployment, isProductionMode, parseAppMode } from '@/lib/env';

/**
 * #1115 (DVP-05) — `APP_MODE` jest normalizowany (trim + małe litery) w JEDNYM znaczeniu
 * w runtime (`src/lib/env.ts`) i w konfiguracji builda (`next.config.mjs`). Wartość spoza
 * production/demo/pustej zostaje demo (fail-closed), ale jest oznaczona jako nierozpoznana.
 */

afterEach(() => vi.unstubAllEnvs());

describe('parseAppMode', () => {
  it.each(['production', 'Production', 'PRODUCTION', ' production', 'production ', '\tProduction\n'])(
    'rozpoznaje produkcję dla %j',
    (raw) => {
      expect(parseAppMode(raw)).toEqual({ mode: 'production', recognized: true });
    },
  );

  it.each([undefined, '', '  ', 'demo', 'Demo ', 'DEMO'])('rozpoznaje demo dla %j', (raw) => {
    expect(parseAppMode(raw)).toEqual({ mode: 'demo', recognized: true });
  });

  // Kontrola ujemna: literówka nie włącza produkcji, ale jest widoczna jako nierozpoznana.
  it.each(['prod', 'productoin', 'production,', 'true', '1'])('literówka %j = demo, nierozpoznana', (raw) => {
    expect(parseAppMode(raw)).toEqual({ mode: 'demo', recognized: false });
  });
});

describe('env.appMode i tryb wdrożenia', () => {
  it('wartość z białymi znakami i inną wielkością liter włącza tryb produkcyjny', () => {
    vi.stubEnv('APP_MODE', ' Production ');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
    expect(env.appMode).toBe('production');
    expect(isProductionMode()).toBe(true);
    expect(isProductionDeployment()).toBe(true);
  });

  it('kontrola ujemna: literówka nie włącza produkcji', () => {
    vi.stubEnv('APP_MODE', 'prod');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
    expect(env.appMode).toBe('demo');
    expect(isProductionDeployment()).toBe(false);
  });
});

describe('next.config.mjs — ta sama normalizacja co runtime', () => {
  const hasHsts = async (mode: string): Promise<boolean> => {
    vi.stubEnv('APP_MODE', mode);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
    const rules = await config.headers!();
    return rules[0]!.headers.some((header) => header.key === 'Strict-Transport-Security');
  };

  it.each([' Production ', 'PRODUCTION', 'production'])('HSTS włączone dla %j', async (mode) => {
    expect(await hasHsts(mode)).toBe(true);
  });

  it.each(['prod', '', 'demo'])('kontrola ujemna: brak HSTS dla %j', async (mode) => {
    expect(await hasHsts(mode)).toBe(false);
  });
});
