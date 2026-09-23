'use server';

import { getMyJobMatch } from '@/lib/data/matching';
import type { JobMatchLoad } from '@/lib/data/matching';

/**
 * Server action: dopasowanie zalogowanego kandydata do oferty (Etap 5).
 *
 * Wołane jako wyspa kliencka z detalu oferty PO montażu — dzięki temu SSR/HTML strony
 * publicznej jest identyczny dla anonimów/robotów (SEO/cache), a kandydat dostaje match
 * dohydrowany po stronie klienta. Zwraca `none` dla anonimów/pracodawców/ofert bez matchu
 * i `error` po nieudanym odczycie danych (#197) — nigdy procentu z niepełnych danych.
 */
export async function getMyJobMatchAction(jobId: string): Promise<JobMatchLoad> {
  if (typeof jobId !== 'string' || jobId.length === 0) return { status: 'none' };
  return getMyJobMatch(jobId);
}
