import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Integracja używa wyłącznie własnego, jednorazowego PostgreSQL w Dockerze. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    hookTimeout: 90_000,
    testTimeout: 20_000,
    fileParallelism: false,
  },
  resolve: {
    // `@` jak w tsconfig i vitest.config.ts — moduły aplikacji importują `@/…` także w integracji.
    alias: {
      '@': resolve(__dirname, 'src'),
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
