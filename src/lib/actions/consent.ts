'use server';

import { cookies, headers } from 'next/headers';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import type { ConsentCategories, ConsentSource } from '@/lib/consent';

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

/** Dozwolone źródła (RPC też normalizuje — tu tylko dla czytelności typu). */
const KNOWN_SOURCES: readonly ConsentSource[] = [
  'cookie_banner',
  'cookie_settings',
  'footer',
  'onboarding',
];

/** Pierwszy adres z X-Forwarded-For (klient), fallback X-Real-IP. */
function clientIp(h: Headers): string | null {
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip');
}

/**
 * Utrwala NIEZMIENNY receipt zgody po stronie serwera (RODO art. 7 — rozliczalność), przez
 * zaufane RPC `record_consent` (RPC-only: klient nie pisze wprost do `consents`). Zapisuje
 * profile_id (auth.uid()/null), visitor_id (cookie), per-kategoria granted, wersję dokumentu
 * (RPC dobiera aktualną), źródło, IP i user-agent. Best-effort: awaria nie blokuje UX (cookie
 * pozostaje dowodem w przeglądarce), bez ujawniania technikaliów (Invariant #8).
 */
export async function recordConsent(
  categories: ConsentCategories,
  source: string,
): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured()) return { ok: false };

  // Limit per IP — dodatkowa warstwa; RPC-only i tak zamyka bezpośredni flood.
  if (!(await checkRateLimit('consent', { max: 30, windowSeconds: 3600 }))) {
    return { ok: false };
  }

  try {
    const [supabase, hdrs, cookieStore] = await Promise.all([
      createServerClient(),
      headers(),
      cookies(),
    ]);
    const src = (KNOWN_SOURCES as readonly string[]).includes(source) ? source : 'cookie_banner';
    const visitorId = cookieStore.get('pracujbe_visitor')?.value ?? null;

    const { error } = await supabase.rpc('record_consent', {
      p_categories: categories ?? {},
      p_source: src,
      p_visitor_id: visitorId,
      p_ip: clientIp(hdrs),
      p_user_agent: hdrs.get('user-agent') ?? null,
    });
    return { ok: !error };
  } catch {
    // Log zgód jest pomocniczy — awaria nie może przerwać zapisu zgody w przeglądarce.
    return { ok: false };
  }
}
