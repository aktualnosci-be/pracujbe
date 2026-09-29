import { revalidatePath } from 'next/cache';

/**
 * Publiczne strony ISR zależne od ofert — jako ŚCIEŻKI PLIKÓW tras w `src/app` (z grupą
 * `(public)`), bez końcowego `/page`.
 *
 * #1216: `revalidatePath(wzorzec, 'page')` w Next 15 unieważnia tag `_N_T_<wzorzec>/page`,
 * a niejawne tagi wpisu ISR powstają ze ścieżki pliku trasy ŁĄCZNIE z grupą
 * (`_N_T_/[locale]/(public)/oferty-pracy/[slug]/page`). Wzorzec bez `(public)` (stan sprzed
 * #1216) nie pasował do żadnego tagu, więc rewalidacja z #775 niczego nie unieważniała.
 * Lista obejmuje każdą stronę `(public)` z `revalidate = 60` — strażnik
 * `tests/unit/public-job-cache-tags.test.ts` porównuje ją ze strukturą `src/app` i liczy tagi
 * prawdziwymi funkcjami Next (`revalidatePath`, `getImplicitTags`).
 */
export const PUBLIC_JOB_ROUTES = [
  '/[locale]/(public)',
  '/[locale]/(public)/oferty-pracy/[slug]',
  '/[locale]/(public)/praca',
  '/[locale]/(public)/praca/kategoria/[category]',
  '/[locale]/(public)/praca/miasto/[city]',
  '/[locale]/(public)/pracodawcy/[slug]',
  '/[locale]/(public)/pracodawcy/[slug]/strona/[page]',
] as const;

/**
 * #775: unieważnia publiczne strony ofert (ISR `revalidate = 60`) po zmianie cyklu życia
 * oferty (publikacja, pauza, wznowienie, zamknięcie, ponowne otwarcie, automatyczne
 * wygaśnięcie z maintenance, moderacja). Bez tego wywołania poprzednio wyrenderowana strona
 * (i jej `JobPosting` JSON-LD) mogła zostać widoczna jeszcze przez okno ISR po tym, jak oferta
 * przestała przyjmować zgłoszenia — albo świeżo opublikowana/wznowiona oferta nie pojawiała
 * się od razu na stronie głównej, landingach i profilu firmy.
 *
 * Każda ścieżka jest przekazana jako WZOR z dynamicznym segmentem + typ `'page'` — Next.js
 * unieważnia WSZYSTKIE instancje danej trasy, więc wywołujący nie musi znać dokładnego
 * sluga/kategorii/miasta/firmy zmienionej oferty (bez rozszerzania kontraktu RPC, bez migracji).
 *
 * Wywołujący (np. `POST /api/maintenance`) może zostać uruchomiony poza pełnym kontekstem
 * żądania Next.js (test integracyjny woła handler route'a bezpośrednio) — wtedy
 * `revalidatePath` rzuca „static generation store missing”. Rewalidacja ISR jest optymalizacją,
 * nie krytycznym zapisem: błąd pojedynczej ścieżki nie może przerwać pozostałych ani zawalić
 * wywołującego zadania maintenance.
 */
export function revalidatePublicJobPaths(): void {
  for (const path of PUBLIC_JOB_ROUTES) {
    try {
      revalidatePath(path, 'page');
    } catch {
      // Poza pełnym kontekstem żądania Next.js — patrz komentarz wyżej.
    }
  }
}
