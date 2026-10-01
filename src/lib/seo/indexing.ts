import { isProductionDeployment } from '@/lib/env';
import { getSiteAccessPassword } from '@/lib/site-access';

/**
 * Czy wyszukiwarki mają indeksować serwis (robots.txt z `Allow` i listą sitemap, sitemapy
 * z adresami). Wymaga publicznej produkcji (`isProductionDeployment`, P1-19) ORAZ wyłączonej
 * bramki hasła (#1115, DVP-04): w oknie cutoveru `APP_MODE=production` bywa ustawione, zanim
 * zniknie `SITE_ACCESS_PASSWORD` — robot dostałby wtedy listę adresów, pod którymi każda
 * strona to 503 z formularzem hasła. Zmiana którejkolwiek zmiennej w Railway restartuje usługę,
 * a robots.txt i sitemapy są liczone per żądanie, więc stan indeksowania zmienia się od razu.
 *
 * Nagłówki `next.config.mjs` (HSTS, `X-Robots-Tag`) zostają przy samym trybie — strony za bramką
 * i tak mają `noindex` z middleware.
 */
export function isSearchIndexingEnabled(): boolean {
  return isProductionDeployment() && !getSiteAccessPassword();
}
