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

## Dokładne facety listy ofert

Lista `/oferty-pracy` pobiera wszystkie widoczne badge oraz licznik wyników jednym RPC
`public.get_public_job_filter_facets(...)`. Funkcja ma `SECURITY DEFINER`, stały
`search_path`, a role `anon` i `authenticated` otrzymują wyłącznie `EXECUTE`. Bezpośredni
odczyt `jobs` i `companies` pozostaje zabroniony.

Agregat obejmuje cały publiczny zbiór bez limitu 200. Publiczny zakres i filtry tekstowe,
stawka oraz data są identyczne z `get_public_jobs`. Dla kategorii, lokalizacji, rodzaju umowy,
zakwaterowania, „od zaraz” i „bez języka” licznik zachowuje wszystkie aktywne filtry poza
własnym wymiarem. Tablice wejściowe mają najwyżej 100 elementów, a teksty najwyżej 100 znaków.

Migracja: `supabase/migrations/0065_public_job_filter_facets.sql`.

### Rollback

Najpierw wycofaj kod aplikacji używający RPC, następnie wykonaj:

```sql
drop function if exists public.get_public_job_filter_facets(
  text,text,text,text[],text[],text[],integer,integer,
  boolean,boolean,boolean,timestamptz
);
```

Rollback usuwa wyłącznie funkcję agregującą i nie modyfikuje danych.
