/**
 * Granice paginacji publicznej listy ofert (#593/#594) — jedno źródło prawdy współdzielone
 * przez `src/lib/db/public-jobs.ts` (odczyt), `src/lib/jobs.ts` (opakowanie demo/DB) i UI
 * (`oferty-pracy/page.tsx`, `Pagination`). Bez `server-only`: liczby czyste, używane też przy
 * renderze paginacji.
 *
 * `get_public_jobs` (0026, utrzymane w 0150) klampuje `p_offset` do `MAX_JOB_LIST_OFFSET` —
 * anty-abuse dla dowolnego bezpośredniego wywołania RPC. Strony UI POZA tą granicą nie mogą
 * jednak po prostu odpytać RPC z klampowanym offsetem: różne numery stron zmapowałyby się na
 * TEN SAM klampowany offset i zwróciły identyczny wycinek (duplikat zamiast końca listy).
 * Warstwa aplikacji (nie SQL) odpowiada więc za dwie rzeczy: nie odpytywać RPC, gdy naturalny
 * offset przekracza sufit (jawny, pusty koniec listy zamiast duplikatu), i ograniczyć numer
 * ostatniej osiągalnej strony w nawigacji/redirectach do rzeczywistej granicy danych — total
 * (licznik wyników) zostaje dokładny, tylko zasięg paginacji jest jawnie ucięty.
 */

export const MAX_JOB_LIST_OFFSET = 10_000;

function safePageSize(pageSize: number): number {
  return Math.max(1, Math.trunc(pageSize));
}

/** Naturalny (nieklampowany) offset strony 1-indeksowanej o danym rozmiarze. */
export function jobListNaturalOffset(page: number, pageSize: number): number {
  return (Math.max(1, Math.trunc(page)) - 1) * safePageSize(pageSize);
}

/**
 * Czy strona jest POZA rzeczywistą granicą danych (#593): jej naturalny offset przekracza
 * `MAX_JOB_LIST_OFFSET`, więc odpytanie RPC zwróciłoby zduplikowany, klampowany wycinek
 * poprzedniej osiągalnej strony zamiast kolejnych (albo braku) wyników.
 */
export function isJobListPageBeyondLimit(page: number, pageSize: number): boolean {
  return jobListNaturalOffset(page, pageSize) > MAX_JOB_LIST_OFFSET;
}

/**
 * Ostatnia strona (1-indeksowana) o danym rozmiarze, której naturalny offset mieści się
 * w `MAX_JOB_LIST_OFFSET` — górna granica sensownej nawigacji/paginacji niezależnie od tego,
 * ile faktycznie wynosi `total` (licznik może być wyższy; te wyniki po prostu nie są
 * osiągalne przez paginację offsetową i lista jawnie się tam kończy).
 */
export function maxReachableJobListPage(pageSize: number): number {
  return Math.floor(MAX_JOB_LIST_OFFSET / safePageSize(pageSize)) + 1;
}

/**
 * Ostatnia strona spójna zarazem z `total` (rzeczywista liczba wyników) i z granicą
 * paginacji — dokładnie to, czego potrzebuje redirect „strona spoza zakresu” (#228) oraz
 * nawigacja `Pagination`, żeby nigdy nie zaoferować strony, która duplikuje inną.
 */
export function jobListLastPage(total: number, pageSize: number): number {
  const byTotal = Math.max(1, Math.ceil(Math.max(0, total) / safePageSize(pageSize)));
  return Math.min(byTotal, maxReachableJobListPage(pageSize));
}
