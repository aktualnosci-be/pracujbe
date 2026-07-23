import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Middleware i18n: wykrywa język (Accept-Language) dla "/", dokłada prefiks locale,
 * przekierowuje nieobsłużone ścieżki. Panele (candidate/employer/admin) mają noindex
 * ustawiany na poziomie metadanych, nie tutaj.
 */
export default createMiddleware(routing);

export const config = {
  // Pomijamy: api, pliki wewnętrzne Next/Vercel oraz wszystko z kropką (assety, .xml, .txt).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
