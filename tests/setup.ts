/**
 * Globalny setup testów Vitest.
 *
 * Importuje matchery @testing-library/jest-dom (np. toBeInTheDocument), które
 * rozszerzają `expect`. Uruchamiany raz przed każdym plikiem testowym (patrz
 * `setupFiles` w vitest.config.ts).
 */
import '@testing-library/jest-dom';
