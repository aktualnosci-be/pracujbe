import { isAllowedAuthRequest } from '@/lib/auth/http-allowlist';
import { isPortalAuthConfigured } from '@/lib/env';

/**
 * Publiczny handler HTTP Better Auth (#24) — z JAWNĄ listą dozwolonych operacji.
 *
 * Mutacje kont (rejestracja, logowanie, wylogowanie, reset i potwierdzenie adresu) idą wyłącznie
 * przez Server Actions (`src/lib/actions/auth.ts`): walidacja Zod, limiter PostgreSQL, Turnstile,
 * rola z profilu. Bezpośrednie endpointy SDK omijałyby te warstwy, więc handler ich NIE wystawia
 * (404, jak nieistniejąca trasa). Linki z e-maili prowadzą do stron aplikacji z tokenem we
 * fragmencie `#`, nie do `/api/auth/*` — token nie trafia do logów serwera ani nagłówka Referer.
 *
 * Dozwolone: `GET /api/auth/get-session` — odczyt własnej sesji z cookie i przedłużenie jej
 * ważności (odświeżenie cookie, którego komponent serwerowy nie może zapisać). Bez konfiguracji
 * kont → 404 bez łączenia z bazą. Kontrola origin/CSRF SDK pozostaje włączona.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

async function handle(request: Request): Promise<Response> {
  if (!isPortalAuthConfigured()) return notFound();
  if (!isAllowedAuthRequest(request.method, new URL(request.url).pathname)) return notFound();
  try {
    const { getAuthRuntime } = await import('@/lib/auth/runtime');
    const auth = await getAuthRuntime();
    const response = await auth.handler(request);
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    // Szczegóły runtime (URL bazy, sekret) nie trafiają do odpowiedzi.
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
