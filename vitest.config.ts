import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Konfiguracja Vitest (testy jednostkowe + komponentowe).
 *
 * - environment jsdom: pozwala testować komponenty React (DOM w Node).
 * - alias @ -> ./src: zgodny z tsconfig, aby importy działały tak jak w aplikacji.
 * - globals: true: describe/it/expect dostępne bez importu.
 * - setupFiles: rozszerza expect o matchery @testing-library/jest-dom.
 *
 * Testy E2E (Playwright) NIE są tu uruchamiane — mają własny runner (playwright.config.ts).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
