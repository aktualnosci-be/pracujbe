// @vitest-environment node
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import integration from '../../vitest.integration.config';

/**
 * Moduły aplikacji importują `@/…`. Integracja (PostgreSQL w Dockerze) importuje te same
 * moduły, więc bez aliasu `@` padała przy ładowaniu pliku, nie przy teście (#280).
 */
describe('vitest.integration.config', () => {
  it('rozwiązuje alias @ do src jak tsconfig i vitest.config.ts', () => {
    const alias = (integration.resolve?.alias ?? {}) as Record<string, string>;
    expect(alias['@']).toBe(resolve(__dirname, '../../src'));
  });
});
