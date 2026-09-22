# Kontrakty bazy danych

## Publiczne liczniki ofert

Kafle `/praca` odczytują liczniki przez dwa RPC `SECURITY DEFINER`:

- `public.get_public_job_category_counts(text[])`,
- `public.get_public_job_city_counts(text[])`.

Każde RPC wykonuje jedno grupowane zapytanie dla całego przekazanego zestawu. Zwraca wyłącznie
klucz filtra i liczbę ofert spełniających publiczny zakres listy: oferta aktywna, niewygasła i
nieusunięta oraz zweryfikowana, nieusunięta firma. Licznik miasta zachowuje semantykę filtra
listy (`ILIKE %miasto%`). Klucze obu wymiarów są ograniczane do 100 znaków. Żądany klucz
zwraca jawne `0`, także gdy jedyne pasujące oferty należą do niezweryfikowanych firm. Role
`anon` i `authenticated` mają tylko `EXECUTE`; bezpośredni
`SELECT` z `jobs` i `companies` pozostaje odebrany.

Migracja: `supabase/migrations/0064_public_job_facet_counts.sql`.

### Rollback

Najpierw wycofaj kod aplikacji używający RPC, następnie wykonaj:

```sql
drop function if exists public.get_public_job_category_counts(text[]);
drop function if exists public.get_public_job_city_counts(text[]);
```

Rollback usuwa tylko nowe funkcje i nie zmienia danych ani tabel.
