# Miejscowości Belgii (#194)

`be-municipalities.wikidata.json` — migawka gmin Belgii z [Wikidata](https://www.wikidata.org):
obecne gminy (klasa Q493522) i gminy zniesione przy fuzjach z 1 stycznia 2019 i 2025 r.
(ich nazwy nadal pojawiają się w ogłoszeniach). Pola: QID, kod NIS (REFNIS), współrzędne,
etykiety PL/NL/FR/EN (+ `mul`, wspólna etykieta Wikidata, jako zapas).

**Licencja:** dane Wikidata są udostępniane na [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
(domena publiczna) — bez obowiązku atrybucji; źródło podajemy dla przejrzystości.
Bez usług płatnych i bez geokodowania przez API w działającej aplikacji: dane trafiają do bazy
migracją `supabase/migrations/0112_locations_be_municipalities.sql`.

- Odświeżenie migawki (ręcznie, poza CI): `node scripts/locations/fetch-wikidata.mjs`
- Wygenerowanie SQL: `node scripts/locations/build-migration.mjs`

Lista kanoniczna `src/lib/matching/belgian-cities.ts` ma pierwszeństwo (współrzędne i aliasy).
Znane poprawki danych w generatorze: wspólny kod NIS przy gminie obecnej i zniesionej zostaje
przy obecnej; gmina zniesiona o nazwie gminy obecnej (Lokeren) nie jest dublowana; elementy
z nieznaną datą zniesienia są pomijane (lista w polu `skipped`).
