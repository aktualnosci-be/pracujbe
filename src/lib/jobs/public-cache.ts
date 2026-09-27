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
 *
 * Wywołujący (np. `POST /api/maintenance`) może zostać uruchomiony poza pełnym kontekstem
 * żądania Next.js ustanawianym przez wewnętrzny serwer (dokładnie taka sytuacja występuje,
 * gdy test integracyjny wywołuje wyeksportowany handler route'a bezpośrednio jako funkcję,
 * z pominięciem serwera Next.js) — wtedy `revalidatePath` rzuca „static generation store
 * missing”. Rewalidacja ISR jest optymalizacją, nie krytycznym zapisem: błąd pojedynczej
 * ścieżki nie może przerwać pozostałych ani zawalić wywołującego zadania maintenance.
 */
export function revalidatePublicJobPaths(): void {
  const paths: Array<[string, 'page']> = [
    ['/[locale]', 'page'],
    ['/[locale]/oferty-pracy/[slug]', 'page'],
    ['/[locale]/praca/kategoria/[category]', 'page'],
    ['/[locale]/praca/miasto/[city]', 'page'],
  ];
  for (const [path, type] of paths) {
    try {
      revalidatePath(path, type);
    } catch {
      // Poza pełnym kontekstem żądania Next.js — patrz komentarz wyżej.
    }
  }
}
