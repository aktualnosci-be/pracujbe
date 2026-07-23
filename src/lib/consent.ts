/**
 * Zgody na cookies (RODO / GDPR).
 *
 * Źródło prawdy po stronie klienta to cookie `pracujbe_consent` (JSON: {v, categories, ts, id}).
 * Moduł jest bezpieczny do importu na serwerze — cały dostęp do `document`/`crypto`/`location`
 * jest strażowany (`typeof ... === 'undefined'`), więc `getConsent()` po prostu zwraca `null`
 * w RSC/SSR, a nic nie jest ładowane ani zapisywane przed świadomą zgodą użytkownika.
 *
 * Zasada: ZERO trackingu przed zgodą. Kategoria `necessary` jest zawsze aktywna (działanie
 * platformy: logowanie, bezpieczeństwo, sam zapis zgody), pozostałe domyślnie WYŁĄCZONE.
 */

/** Kategorie zgód. `necessary` jest zawsze aktywna i nie podlega wyłączeniu. */
export type ConsentCategory = 'necessary' | 'preferences' | 'analytics' | 'marketing';

/** Stan zgody dla każdej kategorii. */
export type ConsentCategories = Record<ConsentCategory, boolean>;

/**
 * Rekord zgody zapisywany w cookie. Struktura celowo minimalna i zgodna z tym, co później
 * utrwala tabela `consents` po stronie serwera (patrz nota na końcu pliku):
 *  - v          → wersja polityki (kolumna `wersja` / `version`)
 *  - categories → mapa kategorii (kolumna `kategorie` / `categories`)
 *  - ts         → znacznik czasu ISO (kolumna `ts`)
 *  - id         → losowy identyfikator zdarzenia zgody (kolumna `id`)
 */
export interface ConsentRecord {
  v: string;
  categories: ConsentCategories;
  ts: string;
  id: string;
}

/** Nazwa cookie przechowującego zgodę. */
export const CONSENT_COOKIE_NAME = 'pracujbe_consent';

/**
 * Wersja polityki prywatności/cookies. Zmiana wartości w env unieważnia dotychczasowe zgody
 * (użytkownik zobaczy baner ponownie) — patrz `getConsent()`.
 */
export const CONSENT_POLICY_VERSION = process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0';

/** Czas życia cookie ze zgodą (dni). RODO sugeruje odpytywać nie rzadziej niż co ~12 mies. */
export const CONSENT_MAX_AGE_DAYS = 180;

/** Pełna lista kategorii w kolejności prezentacji w panelu ustawień. */
export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  'necessary',
  'preferences',
  'analytics',
  'marketing',
];

/** Zgoda minimalna: tylko kategoria niezbędna (odrzucenie opcjonalnych). */
export function necessaryOnly(): ConsentCategories {
  return { necessary: true, preferences: false, analytics: false, marketing: false };
}

/** Pełna zgoda: wszystkie kategorie włączone. */
export function acceptAllCategories(): ConsentCategories {
  return { necessary: true, preferences: true, analytics: true, marketing: true };
}

/** Czy dana kategoria jest objęta ważną zgodą (necessary zawsze true). */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true;
  const record = getConsent();
  return record?.categories[category] === true;
}

/**
 * Odczyt zgody. Zwraca `null`, gdy:
 *  - jesteśmy na serwerze (brak `document`),
 *  - cookie nie istnieje lub jest niepoprawny,
 *  - wersja polityki w cookie różni się od bieżącej (wymuszamy ponowną zgodę).
 */
export function getConsent(): ConsentRecord | null {
  if (typeof document === 'undefined') return null;
  const raw = readCookie(CONSENT_COOKIE_NAME);
  if (!raw) return null;

  const record = parseRecord(raw);
  if (!record) return null;

  // Polityka się zmieniła → dotychczasowa zgoda nieaktualna.
  if (record.v !== CONSENT_POLICY_VERSION) return null;

  return record;
}

/**
 * Zapis zgody. Normalizuje kategorie (necessary wymuszone na true), stempluje wersją polityki,
 * czasem i losowym id, po czym utrwala w cookie. Zwraca zapisany rekord (do dalszej dystrybucji
 * przez consent-store / ewentualnej synchronizacji z serwerem).
 */
export function saveConsent(categories: ConsentCategories): ConsentRecord {
  const record: ConsentRecord = {
    v: CONSENT_POLICY_VERSION,
    categories: {
      necessary: true,
      preferences: categories.preferences === true,
      analytics: categories.analytics === true,
      marketing: categories.marketing === true,
    },
    ts: new Date().toISOString(),
    id: createConsentId(),
  };

  if (typeof document !== 'undefined') {
    writeCookie(CONSENT_COOKIE_NAME, JSON.stringify(record), CONSENT_MAX_AGE_DAYS);
  }

  return record;
}

/* -------------------------------------------------------------------------- */
/* Wewnętrzne helpery cookie                                                  */
/* -------------------------------------------------------------------------- */

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, days: number): void {
  const maxAge = days * 24 * 60 * 60;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function parseRecord(raw: string): ConsentRecord | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  const v = typeof obj.v === 'string' ? obj.v : null;
  const ts = typeof obj.ts === 'string' ? obj.ts : null;
  const id = typeof obj.id === 'string' ? obj.id : null;
  const cats = obj.categories;
  if (v === null || ts === null || id === null || typeof cats !== 'object' || cats === null) {
    return null;
  }

  const c = cats as Record<string, unknown>;
  const categories: ConsentCategories = {
    necessary: true,
    preferences: c.preferences === true,
    analytics: c.analytics === true,
    marketing: c.marketing === true,
  };

  return { v, categories, ts, id };
}

function createConsentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/* Nota: utrwalanie zgody po stronie serwera (tabela `consents`)              */
/* -------------------------------------------------------------------------- */
/*
 * Cookie jest dowodem zgody w przeglądarce; dla rozliczalności (RODO art. 7 ust. 1)
 * warto zdublować rekord w bazie. Docelowo w Server Action / Route Handler:
 *
 *   import { createAdminClient } from '@/lib/supabase/admin';
 *   const supabase = createAdminClient();
 *   await supabase.from('consents').insert({
 *     id: record.id,                 // ten sam identyfikator co w cookie
 *     version: record.v,             // wersja polityki (kolumna `wersja`)
 *     categories: record.categories, // JSONB (kolumna `kategorie`)
 *     ts: record.ts,                 // znacznik czasu zgody
 *     source: 'banner',              // źródło: 'banner' | 'settings' | 'footer' (kolumna `źródło`)
 *     user_id: userId ?? null,       // gdy zalogowany
 *     // Uwaga RODO: NIE zapisuj pełnego IP w formie jawnej — ewentualnie hash/skrót.
 *   });
 *
 * `source` wyprowadza się z kontekstu wywołania (który przycisk / ekran), a nie z cookie —
 * dlatego nie jest częścią minimalnej struktury zapisywanej w przeglądarce.
 */
