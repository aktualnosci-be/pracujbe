/**
 * Odczyt cookie zgody bez zależności (#575). Importują go moduły stron ofert (lejek), więc nie
 * może ciągnąć Server Action zapisu zgody (`@/lib/actions/consent`) ani store'u banera —
 * inaczej rośnie JS strony oferty. `@/lib/consent` re-eksportuje wszystko stąd (jedno źródło).
 * Bezpieczny na serwerze: bez `document` odczyt zwraca `null`.
 */

/** Kategorie zgód. `necessary` jest zawsze aktywna i nie podlega wyłączeniu. */
export type ConsentCategory = 'necessary' | 'preferences' | 'analytics' | 'marketing';

/** Stan zgody dla każdej kategorii. */
export type ConsentCategories = Record<ConsentCategory, boolean>;

/**
 * Źródło zdarzenia zgody (który ekran/przycisk) — utrwalane w kolumnie `source` tabeli
 * `consents` dla rozliczalności. Wyprowadzane z kontekstu wywołania, nie z cookie.
 */
export type ConsentSource = 'cookie_banner' | 'cookie_settings' | 'footer' | 'onboarding';

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

/** Zdarzenie DOM emitowane po zmianie zgody (detail: ConsentRecord). */
export const CONSENT_CHANGE_EVENT = 'pracujbe:consent-change';

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
