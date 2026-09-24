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
 *
 * Dwa projekty: `chromium` — pliki, które uruchamiają skrypty eksportu grafik z prawdziwym
 * Chromium — idzie w jednym procesie, plik po pliku (najwyżej jedna przeglądarka z testów naraz).
 * Równoległe przeglądarki na 2-CPU runnerze CI kończyły zrzut błędem „Unable to capture
 * screenshot” (main 514e917). `unit` = cała reszta, równolegle jak dotąd.
 * `include`/`exclude` tylko w projektach: `extends: true` skleja tablice z konfiguracją główną.
 */
export const CHROMIUM_TEST_FILES = [
  'tests/unit/campaign-banner-export.test.ts',
  'tests/unit/organic-story-assets.test.ts',
  'tests/unit/launch-chromium.test.ts',
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          exclude: ['tests/e2e/**', 'node_modules/**', ...CHROMIUM_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'chromium',
          include: CHROMIUM_TEST_FILES,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` to strażnik bundlera (rzuca w kodzie klienta) — w testach jednostkowych
      // zastępujemy go no-opem, by móc importować moduły server-only (np. webhook-inbox).
      'server-only': resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
