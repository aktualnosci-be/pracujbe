# Miejscowości Belgii (#194)

`be-municipalities.wikidata.json` — migawka gmin Belgii z [Wikidata](https://www.wikidata.org):
obecne gminy (klasa Q493522) i gminy zniesione przy fuzjach z 1 stycznia 2019 i 2025 r.
(ich nazwy nadal pojawiają się w ogłoszeniach). Pola: QID, kod NIS (REFNIS), współrzędne,
etykiety PL/NL/FR/EN (+ `mul`, wspólna etykieta Wikidata, jako zapas).

**Licencja:** dane Wikidata są udostępniane na [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
(domena publiczna) — bez obowiązku atrybucji; źródło podajemy dla przejrzystości.
Bez usług płatnych i bez geokodowania przez API w działającej aplikacji: dane trafiają do bazy
migracją `supabase/migrations/0112_locations_be_municipalities.sql`.

`be-sections.wikidata.json` — migawka części gmin (deelgemeenten / sections de commune):
elementy klasy Q2785216 i miejscowości z kodem NIS części gminy (5 cyfr + litera, np. `44011J`),
z gminą nadrzędną (P131) i następcą gminy zniesionej (P1366). Ta sama licencja CC0 1.0.
Trafia do bazy migracją `supabase/migrations/0191_locations_be_sections.sql` (numer tymczasowy)
jako `kind = 'section'` z `parent_location_id`. Nazwa zajęta przez gminę z 0112 zostaje przy
gminie; nazwa wspólna kilku części (np. Deurne, Berchem) jest pomijana jako niejednoznaczna;
część bez własnej nazwy (część główna o nazwie gminy) nie trafia do słownika. Brak współrzędnych
części = współrzędne gminy nadrzędnej.

- Odświeżenie migawek (ręcznie, poza CI): `node scripts/locations/fetch-wikidata.mjs`
  (`municipalities` albo `sections` — tylko jedna migawka; odświeżenie gmin zmienia wynik
  generatora 0112, więc po wdrożeniu zmiany idą nową migracją)
- Wygenerowanie SQL (0112 i 0191): `node scripts/locations/build-migration.mjs`

Lista kanoniczna `src/lib/matching/belgian-cities.ts` ma pierwszeństwo (współrzędne i aliasy).
Znane poprawki danych w generatorze: wspólny kod NIS przy gminie obecnej i zniesionej zostaje
przy obecnej; gmina zniesiona o nazwie gminy obecnej (Lokeren) nie jest dublowana; elementy
z nieznaną datą zniesienia są pomijane (lista w polu `skipped`).
