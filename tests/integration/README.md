# Test kursora historii aplikacji na PostgREST

Uruchom ręcznie w izolowanym środowisku z Node.js, zainstalowanymi zależnościami projektu i Dockerem:

```bash
node tests/integration/candidate-applications-postgrest.mjs
```

Na Windows można uruchomić go w WSL z działającym Dockerem, z katalogu repozytorium pod `/mnt/c/...`.

Test tworzy wyłącznie własną sieć i dwa kontenery z losową nazwą oraz etykietą `pb187-test`. Nie używa produkcyjnej bazy ani portu hosta. Po zakończeniu usuwa tylko zasoby o dokładnie tej samej etykiecie i sprawdza ich brak. Testuje rzeczywisty kreator URL z `@supabase/supabase-js` wobec PostgreSQL 16 i PostgREST v16.1: kodowanie znacznika czasu w kursorze, dwie strony przy jednakowych czasach, brak duplikatów i ograniczenie dostępu przez RLS. Jest uruchamiany ręcznie, żeby nie zajmował współdzielonego runnera CI ani nie wymagał Dockera w zwykłej instalacji projektu.
