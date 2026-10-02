import 'server-only';

import { createHash } from 'node:crypto';

import type { Locale } from '@/i18n/routing';
import type { GuardedExplanation } from '@/lib/ai-explain/guard';
import type { ExplainSource } from '@/lib/ai-explain/sources';

/**
 * Pamięć podręczna wyjaśnień (#773) w pamięci procesu — ta sama treść oferty w tym samym języku
 * odpowiedzi nie generuje drugiego płatnego wywołania modelu. Klucz = oferta + język + SHA-256
 * fragmentów wysyłanych do modelu (zmiana treści oferty = nowy klucz). Bez danych osoby
 * pytającej; tylko udane wyniki. Ograniczona liczba wpisów i czas życia (LRU).
 */

const MAX_ENTRIES = 300;
const TTL_MS = 6 * 60 * 60 * 1000;

interface Entry {
  value: GuardedExplanation;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

export function explainCacheKey(jobId: string, targetLocale: Locale, sources: readonly ExplainSource[]): string {
  const hash = createHash('sha256');
  for (const s of sources) hash.update(`${s.id}\u0000${s.field}\u0000${s.modelText}\u0001`);
  return `${jobId}:${targetLocale}:${hash.digest('hex')}`;
}

export function readExplainCache(key: string, now = Date.now()): GuardedExplanation | null {
  const entry = entries.get(key);
  if (!entry) return null;
  entries.delete(key);
  if (entry.expiresAt <= now) return null;
  entries.set(key, entry);
  return entry.value;
}

export function writeExplainCache(key: string, value: GuardedExplanation, now = Date.now()): void {
  entries.delete(key);
  entries.set(key, { value, expiresAt: now + TTL_MS });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Testy. */
export function clearExplainCache(): void {
  entries.clear();
}
