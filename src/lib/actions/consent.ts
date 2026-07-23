'use server';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ConsentCategories, ConsentCategory, ConsentSource } from '@/lib/consent';

/**
 * Serwerowy log zgód (RODO art. 7 ust. 1 — rozliczalność).
 *
 * Cookie `pracujbe_consent` jest głównym dowodem zgody w przeglądarce; ten log dubluje go
 * w tabeli `consents` (append-only), aby dało się wykazać, KTO, KIEDY i NA CO wyraził zgodę.
 *
 * Zapis jest PER KATEGORIA — jeden wiersz na kategorię (necessary/preferences/analytics/marketing),
 * zgodnie ze schematem `consents` (0007_misc.sql): profile_id (nullable), category, granted, source.
 * RLS (0009): insert dozwolony dla anon i authenticated, `profile_id is null OR profile_id = auth.uid()`.
 *
 * Best-effort: gdy Supabase nie jest skonfigurowane (tryb demo) lub zapis się nie powiedzie,
 * NIE blokujemy UX i NIE ujawniamy technikaliów (Invariant #8) — cookie pozostaje dowodem.
 */

/** Kolejność i komplet kategorii logowanych do bazy (zgodna z enumem `consent_category`). */
const LOGGED_CATEGORIES: readonly ConsentCategory[] = [
  'necessary',
  'preferences',
  'analytics',
  'marketing',
];

/** Dozwolone źródła zgody; nieznane wartości sprowadzamy do banera (defensywnie). */
const KNOWN_SOURCES: readonly ConsentSource[] = [
  'cookie_banner',
  'cookie_settings',
  'footer',
  'onboarding',
];

function normalizeSource(source: string): ConsentSource {
  return (KNOWN_SOURCES as readonly string[]).includes(source)
    ? (source as ConsentSource)
    : 'cookie_banner';
}

/**
 * Utrwala zgodę po stronie serwera. Zwraca `{ ok }` — wołający (klient) ignoruje wynik
 * (best-effort), ale zwracamy status na potrzeby ewentualnych testów/diagnostyki.
 */
export async function recordConsent(
  categories: ConsentCategories,
  source: string,
): Promise<{ ok: boolean }> {
  // Tryb demo / brak konfiguracji — cookie w przeglądarce pozostaje dowodem zgody.
  if (!isSupabaseConfigured()) {
    return { ok: false };
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Zalogowany: profile_id = auth.uid() (profiles 1:1 z auth.users).
    // Anonimowy: profile_id null — zgoda sesji przed logowaniem (dopuszczona przez RLS).
    const profileId = user?.id ?? null;
    const src = normalizeSource(source);

    const rows = LOGGED_CATEGORIES.map((category) => ({
      profile_id: profileId,
      category,
      granted: category === 'necessary' ? true : categories?.[category] === true,
      source: src,
    }));

    const { error } = await supabase.from('consents').insert(rows);
    return { ok: !error };
  } catch {
    // Log zgód jest pomocniczy — awaria nie może przerwać zapisu zgody w przeglądarce.
    return { ok: false };
  }
}
