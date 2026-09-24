/**
 * Dostęp do zmiennych środowiskowych.
 *
 * WAŻNE: odczyt jest LENIWY (gettery) — `process.env` czytane jest dopiero przy użyciu
 * pola, nie przy imporcie modułu. Dzięki temu aplikacja buduje się i uruchamia BEZ env
 * (strony publiczne mają fallback demo), a moduł nigdy nie rzuca przy imporcie.
 *
 * Wartości NEXT_PUBLIC_* są wstrzykiwane do bundle'a klienta w czasie builda — nie umieszczaj
 * tam sekretów (service-role key czytany jest osobno, tylko po stronie serwera).
 */
import { isBillingEnabled } from '@/lib/billing/flag';

export const env = {
  /** Publiczny URL aplikacji (kanoniczne linki, e-maile). Fallback: localhost. */
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  },
  /** Domyślny język aplikacji. Fallback: 'pl'. */
  get defaultLocale(): string {
    return process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'pl';
  },
  /** URL projektu Supabase — undefined, gdy nieskonfigurowany (tryb demo). */
  get supabaseUrl(): string | undefined {
    return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
  },
  /** Klucz anon Supabase — undefined, gdy nieskonfigurowany (tryb demo). */
  get supabaseAnonKey(): string | undefined {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
  },
  /**
   * Tryb aplikacji (SEC-19): 'production' | 'demo'. Jedynym źródłem jest APP_MODE. Produkcja
   * MUSI ustawić `APP_MODE=production` (patrz docs/LAUNCH_CHECKLIST.md) — inaczej brak
   * konfiguracji cicho degraduje do trybu demo (fikcyjne panele).
   */
  get appMode(): 'production' | 'demo' {
    const m = process.env.APP_MODE;
    return m === 'production' ? 'production' : 'demo';
  },
  /** Ograniczone połączenie używane wyłącznie przez runtime Better Auth. */
  get authDatabaseUrl(): string | undefined {
    return process.env.DATABASE_AUTH_URL || undefined;
  },
  /** Prywatny sekret podpisujący dane Better Auth. */
  get authSecret(): string | undefined {
    return process.env.BETTER_AUTH_SECRET || undefined;
  },
  /** Kanoniczny origin Better Auth; nie jest wyprowadzany z nagłówków żądania. */
  get authBaseUrl(): string | undefined {
    return process.env.BETTER_AUTH_URL || undefined;
  },
};

/**
 * Czy Supabase jest skonfigurowane (URL + anon key obecne).
 * Warstwa danych (@/lib/jobs itp.) używa tego do wyboru: DB vs fallback demo.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/** Publiczne oferty korzystają z ograniczonego loginu PostgreSQL Railway. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_APP_URL);
}

/** Czy komplet prywatnej konfiguracji runtime Better Auth jest obecny. */
export function isAuthRuntimeConfigured(): boolean {
  return Boolean(env.authDatabaseUrl && env.authSecret && env.authBaseUrl);
}

/** Czy aplikacja działa w trybie produkcyjnym (fail-closed zamiast demo). SEC-19. */
export function isProductionMode(): boolean {
  return env.appMode === 'production';
}

/** Wzorzec adresów nieprodukcyjnych (lokalne/staging/preview). */
const NON_PROD_HOST_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0|staging|preview/i;

/**
 * P1-19: JEDNO źródło prawdy o środowisku wdrożenia dla nagłówków (HSTS/X-Robots-Tag),
 * robots.txt i sitemap. „Publiczna produkcja" = tryb produkcyjny (APP_MODE)
 * ORAZ realny publiczny URL (nie localhost/staging/preview). Dzięki temu self-hosted
 * produkcja (APP_MODE=production) jest spójnie traktowana wszędzie:
 * HSTS wł., brak globalnego noindex, robots/sitemap indeksowalne.
 *
 * UWAGA: `next.config.mjs` (build-time, bez importu TS) powiela tę regułę — zmieniając ją,
 * zaktualizuj OBA miejsca.
 */
export function isProductionDeployment(): boolean {
  if (!isProductionMode()) return false;
  return !NON_PROD_HOST_RE.test(env.siteUrl);
}

/** Klucz service-role obecny (operacje serwerowe: admin, webhooki, worker e-mail). */
export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Publiczny URL jest realny (https, nie localhost) — wymagane w produkcji (linki, e-maile). */
export function hasPublicHttpsUrl(): boolean {
  try {
    const url = new URL(env.siteUrl);
    // Gotowość stagingu jest niezależna od indeksowania przez wyszukiwarki.
    return url.protocol === 'https:' && !url.username && !url.password &&
      !/^(localhost|.*\.localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|\[::\])$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Login zadań serwerowych PostgreSQL (#25): worker poczty, webhooki, cron, odczyty admina. */
export function isServiceDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_SERVICE_URL);
}

/**
 * Zależności KRYTYCZNE dla gotowości (P1-18, #25). W produkcji aplikacja nie może obsługiwać ruchu
 * bez rdzenia: PostgreSQL (login WWW `DATABASE_APP_URL` + login zadań serwerowych
 * `DATABASE_SERVICE_URL`), sesje Better Auth oraz realny https URL. Dostawcy opcjonalni
 * (Stripe/Resend/webhooki) NIE blokują gotowości — ich stan raportuje /api/health jako `checks`.
 * Klucze Supabase nie są już częścią rdzenia: warstwa danych paneli działa bez PostgREST.
 */
export function readinessChecks(): Record<string, boolean> {
  return {
    database: isDatabaseConfigured(),
    serviceDatabase: isServiceDatabaseConfigured(),
    authRuntime: isAuthRuntimeConfigured(),
    httpsSiteUrl: hasPublicHttpsUrl(),
    // #51: sprzedaż wyłączona flagą — sekrety Stripe bez `BILLING_ENABLED` nie liczą się.
    stripe: isBillingEnabled() && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    resend: Boolean(process.env.RESEND_API_KEY),
    emailHook: Boolean(process.env.SEND_EMAIL_HOOK_SECRET),
    queueSecret: Boolean(process.env.EMAIL_QUEUE_SECRET),
    sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN),
  };
}

/**
 * Gotowość do obsługi ruchu (SEC-19 + P1-18). Tryb demo: zawsze gotowe (lokalnie/staging/E2E).
 * Tryb produkcyjny: wymaga rdzenia (PostgreSQL WWW + zadań serwerowych, Better Auth, realny
 * https URL) — brak = „nieskonfigurowany" (fail-closed: 503/maintenance, nie fikcyjne demo).
 * Nie ujawnia sekretów.
 */
export function isAppReady(): boolean {
  if (!isProductionMode()) return true;
  return isDatabaseConfigured() && isServiceDatabaseConfigured() && isAuthRuntimeConfigured() &&
    hasPublicHttpsUrl();
}
