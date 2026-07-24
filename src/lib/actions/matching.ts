'use server';

import { getMyJobMatch } from '@/lib/data/matching';
import type { MatchResult } from '@/lib/matching/score';

/**
 * Server action: dopasowanie zalogowanego kandydata do oferty (Etap 5).
 *
 * Wołane jako wyspa kliencka z detalu oferty PO montażu — dzięki temu SSR/HTML strony
 * publicznej jest identyczny dla anonimów/robotów (SEO/cache), a kandydat dostaje match
 * dohydrowany po stronie klienta. Zwraca `null` dla anonimów/pracodawców/ofert bez matchu.
 */
export async function getMyJobMatchAction(jobId: string): Promise<MatchResult | null> {
  if (typeof jobId !== 'string' || jobId.length === 0) return null;
  return getMyJobMatch(jobId);
}
