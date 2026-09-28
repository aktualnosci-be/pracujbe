import type { AiFeatureId } from '@/lib/ai/inventory';

/** Encje kolejki tłumaczeń (0145). */
export type TranslationEntityType = 'job' | 'candidate_profile';

/**
 * Funkcja AI inwentarza dla encji kolejki (#1152): oferty = `content_translation` (treść
 * ogłoszenia, dozwolona w trybie ogłoszeniowym), profile kandydatów =
 * `candidate_profile_translation` (wyłączona w trybie ogłoszeniowym). Ten sam identyfikator
 * trafia do budżetu AI i logu użycia. Brak encji (stare wywołania) = oferta.
 */
export function translationFeatureFor(entityType: TranslationEntityType | undefined): AiFeatureId {
  return entityType === 'candidate_profile' ? 'candidate_profile_translation' : 'content_translation';
}
