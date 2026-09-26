/**
 * Globalny setup testów Vitest.
 *
 * Importuje matchery @testing-library/jest-dom (np. toBeInTheDocument), które
 * rozszerzają `expect`. Uruchamiany raz przed każdym plikiem testowym (patrz
 * `setupFiles` w vitest.config.ts).
 *
 * Blokada sieci (#47): połączenia poza localhost/127.0.0.1 i `TEST_NETWORK_ALLOW` kończą się
 * `NetworkBlockedError` (tests/helpers/network-guard.ts, strażnik `network-guard.test.ts`).
 * Opt-in test VIES na żywo (`VIES_LIVE_SMOKE=1`) dopuszcza wyłącznie host VIES.
 */
import '@testing-library/jest-dom';
import { installNetworkGuard } from './helpers/network-guard';

if (process.env.VIES_LIVE_SMOKE === '1') {
  process.env.TEST_NETWORK_ALLOW = [process.env.TEST_NETWORK_ALLOW, 'ec.europa.eu']
    .filter(Boolean)
    .join(',');
}

installNetworkGuard();
