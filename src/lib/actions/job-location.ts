'use server';

import { z } from 'zod';

import { isLocale } from '@/i18n/routing';
import { captureError } from '@/lib/error-report';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { LOCATION_KEYS, localizedCityName } from '@/lib/locations/city-aliases';
import {
  JOB_CITY_MIN_PREFIX,
  JOB_CITY_SUGGESTION_LIMIT,
  cityKeyPrefixPattern,
  demoJobCityAssist,
  pickSuggestions,
  type JobCityAssist,
} from '@/lib/locations/job-city';
import { BELGIAN_CITIES, cityKey } from '@/lib/matching/belgian-cities';
import type { LocationKey } from '@/lib/jobs';

const inputSchema = z.object({ city: z.string().max(200), locale: z.string().max(10) });

/** Nazwa miejscowości do podpowiedzi: 10 tłumaczonych miast w języku strony, inne ze słownika. */
function displayName(slug: string, name: string, locale: string): string {
  return (LOCATION_KEYS as readonly string[]).includes(slug)
    ? localizedCityName(slug as LocationKey, locale)
    : name;
}

/**
 * Podpowiedź miasta w kreatorze oferty (P1-10): rozpoznana miejscowość ze słownika i propozycje
 * nazw. Tylko odczyt słownika pod RLS (publiczny), niczego nie zapisuje — `jobs.location_id`
 * ustawia trigger bazy przy zapisie kroku.
 */
export async function jobCityAssist(input: unknown): Promise<JobCityAssist> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error' };
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : 'pl';
  const key = cityKey(parsed.data.city);
  if (!key) return { status: 'ok', match: null, suggestions: [] };

  if (!isPortalDataConfigured()) {
    const demo = demoJobCityAssist(parsed.data.city);
    const city = demo.slug ? BELGIAN_CITIES.find((c) => c.slug === demo.slug) : undefined;
    return {
      status: 'ok',
      match: city ? { slug: city.slug, name: displayName(city.slug, city.aliases[0] ?? city.slug, locale) } : null,
      suggestions: demo.suggestions,
    };
  }

  const identity = await getPortalIdentity();
  if (!identity) return { status: 'error' };
  try {
    return await withPortalTransaction(identity, async (tx) => {
      const exact = await queryRows<{ slug: string; name: string }>(tx, 'job-city.lookup',
        `SELECT l.slug, l.name
           FROM public.location_aliases a
           JOIN public.locations l ON l.id = a.location_id
          WHERE l.is_active = true AND a.alias_key = $1
          LIMIT 1`, [key]);
      const prefix = key.length < JOB_CITY_MIN_PREFIX ? [] : await queryRows<{
        location_id: string; alias: string; name: string; slug: string; sort_order: number | null;
      }>(tx, 'job-city.suggest',
        `SELECT a.location_id, a.alias, l.name, l.slug, l.sort_order
           FROM public.location_aliases a
           JOIN public.locations l ON l.id = a.location_id
          WHERE l.is_active = true AND a.alias_key LIKE $1 ESCAPE '\\'
          ORDER BY l.sort_order, a.alias_key
          LIMIT 200`, [cityKeyPrefixPattern(key)]);
      const row = exact[0];
      return {
        status: 'ok' as const,
        match: row ? { slug: row.slug, name: displayName(row.slug, row.name, locale) } : null,
        suggestions: pickSuggestions(prefix.map((r) => ({
          locationId: r.location_id, alias: r.alias, sortOrder: Number(r.sort_order ?? 0),
          name: displayName(r.slug, r.name, locale),
        })), JOB_CITY_SUGGESTION_LIMIT),
      };
    });
  } catch (error) {
    captureError(error, { area: 'jobs.jobCityAssist' });
    return { status: 'error' };
  }
}
