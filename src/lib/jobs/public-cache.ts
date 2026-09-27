import { revalidatePath } from 'next/cache';

/**
 * #775: unieważnia publiczne strony ofert (ISR `revalidate = 60`) po zmianie cyklu życia
 * oferty (publikacja, pauza, wznowienie, zamknięcie, ponowne otwarcie, automatyczne
 * wygaśnięcie z maintenance). Bez tego wywołania poprzednio wyrenderowana strona (i jej
 * `JobPosting` JSON-LD) mogła zostać widoczna jeszcze przez okno ISR po tym, jak oferta
 * przestała przyjmować zgłoszenia — albo świeżo opublikowana/wznowiona oferta nie pojawiała
 * się od razu na stronie głównej i landingach.
 *
 * Każda ścieżka jest przekazana jako WZOR z dynamicznym segmentem + typ `'page'` (ten sam
 * zabieg, którego kod już używa dla `/[locale]/oferty-pracy/[slug]` w `updatePublishedJob`)
 * — Next.js unieważnia WSZYSTKIE instancje danej trasy, więc wywołujący nie musi znać
 * dokładnego sluga/kategorii/miasta zmienionej oferty. Dzięki temu naprawa nie wymaga
 * rozszerzania kontraktu RPC cyklu życia (bez migracji SQL) kosztem nieco szerszej
 * rewalidacji, ograniczonej wyłącznie do stron listujących oferty (bez całej aplikacji).
 */
export function revalidatePublicJobPaths(): void {
  revalidatePath('/[locale]', 'page');
  revalidatePath('/[locale]/oferty-pracy/[slug]', 'page');
  revalidatePath('/[locale]/praca/kategoria/[category]', 'page');
  revalidatePath('/[locale]/praca/miasto/[city]', 'page');
}
