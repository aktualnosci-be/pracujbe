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
   * Tryb aplikacji (SEC-19): 'production' | 'demo'. Jawny `APP_MODE` ma priorytet; w innym
   * wypadku produkcja jest wykrywana z `VERCEL_ENV==='production'`. Self-hosted produkcja
   * MUSI ustawić `APP_MODE=production` (patrz docs/LAUNCH_CHECKLIST.md) — inaczej brak
   * konfiguracji cicho degraduje do trybu demo (fikcyjne panele).
   */
  get appMode(): 'production' | 'demo' {
    const m = process.env.APP_MODE;
    if (m === 'production' || m === 'demo') return m;
    return process.env.VERCEL_ENV === 'production' ? 'production' : 'demo';
  },
};

/**
 * Czy Supabase jest skonfigurowane (URL + anon key obecne).
 * Warstwa danych (@/lib/jobs itp.) używa tego do wyboru: DB vs fallback demo.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/** Czy aplikacja działa w trybie produkcyjnym (fail-closed zamiast demo). SEC-19. */
export function isProductionMode(): boolean {
  return env.appMode === 'production';
}

/**
 * Gotowość do obsługi ruchu (SEC-19). W trybie produkcyjnym wymagana jest realna konfiguracja
 * Supabase — jej brak oznacza „nieskonfigurowany" (fail-closed: 503/maintenance, nie demo).
 * W trybie demo zawsze gotowe (lokalnie / staging / E2E). Nie ujawnia sekretów.
 */
export function isAppReady(): boolean {
  return !isProductionMode() || isSupabaseConfigured();
}
