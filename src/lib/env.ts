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
};

/**
 * Czy Supabase jest skonfigurowane (URL + anon key obecne).
 * Warstwa danych (@/lib/jobs itp.) używa tego do wyboru: DB vs fallback demo.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
