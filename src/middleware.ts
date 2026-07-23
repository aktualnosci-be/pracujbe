import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Middleware i18n: wykrywa język (Accept-Language) dla "/", dokłada prefiks locale,
 * przekierowuje nieobsłużone ścieżki. Panele (candidate/employer/admin) mają noindex
 * ustawiany na poziomie metadanych, nie tutaj.
 */
export default createMiddleware(routing);

export const config = {
  // Pomijamy: api, auth (callback OAuth/e-mail — obsługiwany poza i18n), pliki wewnętrzne
  // Next/Vercel oraz wszystko z kropką (assety, .xml, .txt). `auth` MUSI być wykluczone,
  // inaczej /auth/callback jest przekierowywany na /{locale}/auth/callback (404).
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
