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
  /** Ograniczone połączenie domeny (rola pracujbe_app) — dane, profile i sesje portalu. */
  get appDatabaseUrl(): string | undefined {
    return process.env.DATABASE_APP_URL || undefined;
  },
  /** Login workera wiadomości auth (rola pracujbe_auth_mail, 0061). */
  get authMailDatabaseUrl(): string | undefined {
    return process.env.DATABASE_AUTH_MAIL_URL || undefined;
  },
  /** Login limitera (rola pracujbe_rate_limit, 0058). */
  get rateLimitDatabaseUrl(): string | undefined {
    return process.env.DATABASE_RATE_LIMIT_URL || undefined;
  },
  /** Sekret HMAC kluczy limitera (min. 32 bajty); niezależny od sekretu sesji. */
  get rateLimitKeySecret(): string | undefined {
    return process.env.RATE_LIMIT_KEY_SECRET || undefined;
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
  return Boolean(env.appDatabaseUrl);
}

/** Czy komplet prywatnej konfiguracji runtime Better Auth jest obecny. */
export function isAuthRuntimeConfigured(): boolean {
  return Boolean(env.authDatabaseUrl && env.authSecret && env.authBaseUrl);
}

/**
 * Konta i sesje portalu (#24): Better Auth potwierdza sesję, a pula domeny czyta aktywny profil
 * (`readPortalIdentity`). Bez obu części logowanie, guardy paneli i akcje auth nie działają —
 * poza produkcją to tryb demo, w produkcji `isAppReady()` = false (503).
 */
export function isPortalAuthConfigured(): boolean {
  return isAuthRuntimeConfigured() && isDatabaseConfigured();
}

/** Trwały limiter PostgreSQL (osobny login + sekret HMAC ≥ 32 bajty). */
export function isRateLimitDatabaseConfigured(): boolean {
  const secret = env.rateLimitKeySecret;
  return Boolean(env.rateLimitDatabaseUrl && secret && new TextEncoder().encode(secret).length >= 32);
}

/** Worker wiadomości auth (weryfikacja adresu, reset hasła) ma własny login. */
export function isAuthMailConfigured(): boolean {
  return Boolean(env.authMailDatabaseUrl);
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
 * `BETTER_AUTH_URL` = kanoniczny origin HTTPS serwisu (ten sam co `NEXT_PUBLIC_SITE_URL`):
 * linki z e-maili, kontrola origin/CSRF i cookie `__Secure-` muszą wskazywać jeden host.
 */
export function hasCanonicalAuthUrl(): boolean {
  const value = env.authBaseUrl;
  if (!value || !hasPublicHttpsUrl()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/'
      && !url.search && !url.hash && url.origin === new URL(env.siteUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Prywatny bucket S3 Railway na CV (#26). Nazwy zmiennych = preset „AWS SDK” w zakładce
 * Credentials bucketu Railway (także `railway bucket credentials`). Wartości tylko serwerowe,
 * nigdy `NEXT_PUBLIC_*`. `AWS_S3_URL_STYLE`: `virtual` (domyślnie) albo `path` — jak pokazuje
 * Credentials. Pełną walidację (HTTPS, nazwa, region) robi adapter `railway-bucket.ts`.
 */
export interface FileBucketConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function fileBucketConfig(): FileBucketConfig | null {
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim();
  const region = process.env.AWS_DEFAULT_REGION?.trim();
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const style = process.env.AWS_S3_URL_STYLE?.trim() || 'virtual';
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (style !== 'virtual' && style !== 'path') return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/') return null;
  } catch {
    return null;
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: style === 'path' };
}

/** Sekret HMAC krótkich linków pobrania CV (`FILE_DOWNLOAD_SECRET`, min. 32 bajty). */
export function fileDownloadSecret(): string | null {
  const secret = process.env.FILE_DOWNLOAD_SECRET;
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

/**
 * Komplet konfiguracji plików kandydata (#26): bucket + sekret linków + baza aplikacji +
 * sesje Better Auth (właściciel pliku pochodzi wyłącznie z potwierdzonej sesji).
 */
export function isFileStorageConfigured(): boolean {
  return Boolean(fileBucketConfig() && fileDownloadSecret() && isDatabaseConfigured() &&
    isAuthRuntimeConfigured());
}

/**
 * Zależności KRYTYCZNE dla gotowości (P1-18, #429). Produkcja nie obsługuje ruchu bez rdzenia
 * PostgreSQL Railway: pula domeny (`DATABASE_APP_URL`), Better Auth (`DATABASE_AUTH_URL`,
 * `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` = origin serwisu), limiter prób logowania/rejestracji
 * (`DATABASE_RATE_LIMIT_URL` + `RATE_LIMIT_KEY_SECRET`; bez niego akcje auth są blokowane) oraz
 * login zadań serwerowych (`DATABASE_SERVICE_URL`, service_role: worker poczty, webhooki, cron,
 * odczyty admina — #25) oraz realny https URL. Supabase nie jest już warunkiem gotowości (#24, #25).
 * Dostawcy opcjonalni (Resend/worker poczty/Sentry) NIE blokują gotowości — ich stan raportuje
 * /api/health jako `checks` (obserwowalność bez twardego 503).
 */
export function readinessChecks(): Record<string, boolean> {
  return {
    database: isDatabaseConfigured(),
    serviceDatabase: isServiceDatabaseConfigured(),
    auth: isAuthRuntimeConfigured(),
    authUrl: hasCanonicalAuthUrl(),
    rateLimit: isRateLimitDatabaseConfigured(),
    authMail: isAuthMailConfigured(),
    httpsSiteUrl: hasPublicHttpsUrl(),
    // #51: sprzedaż wyłączona flagą — sekrety Stripe bez `BILLING_ENABLED` nie liczą się.
    stripe: isBillingEnabled() && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    resend: Boolean(process.env.RESEND_API_KEY),
    queueSecret: Boolean(process.env.EMAIL_QUEUE_SECRET),
    sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN),
    // #26: prywatny bucket Railway (endpoint/region/bucket/klucze) + sekret linków pobrania CV.
    fileBucket: fileBucketConfig() !== null,
    fileDownloadSecret: fileDownloadSecret() !== null,
  };
}

/**
 * Gotowość do obsługi ruchu (SEC-19 + P1-18 + #429). Tryb demo: zawsze gotowe (lokalnie/E2E).
 * Tryb produkcyjny: wymaga rdzenia PostgreSQL (WWW + zadań serwerowych) + Better Auth + limitera + realnego https URL —
 * brak = „nieskonfigurowany" (fail-closed: 503/maintenance, nie fikcyjne demo). Sama obecność
 * zmiennych; łączność z bazą sprawdza dodatkowo `/api/health`. Nie ujawnia sekretów.
 */
export function isAppReady(): boolean {
  if (!isProductionMode()) return true;
  return isDatabaseConfigured() && isServiceDatabaseConfigured() && isAuthRuntimeConfigured() && hasCanonicalAuthUrl()
    && isRateLimitDatabaseConfigured() && hasPublicHttpsUrl();
}
