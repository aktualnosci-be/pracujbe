/**
 * Setup integracji PG (#47, „blokada HTTP w testach”): ta sama blokada wyjść sieciowych co
 * w projekcie `unit` (`tests/helpers/network-guard.ts`). Integracja łączy się wyłącznie z
 * jednorazowym PostgreSQL w Dockerze na 127.0.0.1 (mapowanie portu; sam `docker` to proces
 * potomny, poza blokadą), więc loopback wystarcza. Jawnie wskazana baza zewnętrzna
 * (`INTEGRATION_PG_ADMIN_URL`, `tests/integration/support/portal-db.ts`) — jej host trafia na
 * allow-listę, żeby blokada nie zmieniała założeń uruchomienia na istniejącym serwerze.
 */
import { installNetworkGuard, integrationAllowedHost } from '../helpers/network-guard';

const pgHost = integrationAllowedHost(process.env.INTEGRATION_PG_ADMIN_URL);
if (pgHost) {
  process.env.TEST_NETWORK_ALLOW = [process.env.TEST_NETWORK_ALLOW, pgHost].filter(Boolean).join(',');
}

installNetworkGuard();
