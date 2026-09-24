# Kontrakty bazy danych

## Zapisane oferty kandydata

`public.get_saved_jobs_display(text)` zwraca własne zapisy zalogowanego kandydata w kolejności
zapisu. Funkcja łączy `saved_jobs` z ofertami przed sortowaniem, więc aktywna oferta nie znika
tylko dlatego, że jest starsza od 100 najnowszych ofert publicznych. Zwracane są wyłącznie
publiczne pola aktywnej, niewygasłej oferty zweryfikowanej firmy. Warunek
`saved_jobs.candidate_id = auth.uid()` ogranicza odczyt do właściciela; `EXECUTE` ma tylko
rola `authenticated`. Bezpośrednie uprawnienia do tabel `jobs` i `companies` nie zmieniają się.

Migracja: `supabase/migrations/0066_saved_jobs_display.sql`.

### Rollback

Najpierw wycofaj kod aplikacji używający RPC, następnie wykonaj:

```sql
drop function if exists public.get_saved_jobs_display(text);
```

Rollback usuwa tylko nową funkcję; nie zmienia zapisanych ofert ani innych danych.

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

## Idempotentna wysyłka wiadomości

`public.send_message(uuid, text, uuid)` przyjmuje `p_client_message_id` — UUID generowany
przez klienta raz na operację wysyłki i powtarzany przy każdym ponowieniu tej samej operacji.
Unikalny indeks `messages_client_message_id_uniq` na
`(conversation_id, sender_id, client_message_id)` rozstrzyga ponowienia i próby równoległe:
pierwsza zapisuje wiadomość, `last_message_at`, powiadomienia i e-maile; kolejna (także
czekająca na commit pierwszej) zwraca id istniejącej wiadomości bez ponownych efektów
ubocznych. Treść nie jest kluczem — dwa różne identyfikatory z tą samą treścią dają dwie
wiadomości. Stary podpis `send_message(uuid, text)` został usunięty; wywołanie bez klucza
(`null`) kończy się `VALIDATION_FAILED`. Kontrola członkostwa rozmowy działa przed
deduplikacją, więc cudzy klucz niczego nie ujawnia.

## Granica wygaśnięcia propozycji

`public.respond_to_offer(uuid, boolean)` odrzuca propozycję, gdy `expires_at <= now()`.
Warstwa odczytu (`expires_at > now()`) i UI (`canRespondToProposal`) uznają propozycję za
aktywną tylko ściśle przed terminem, więc chwila `expires_at` jest już po terminie wszędzie.
Równoległe accept/decline serializuje blokada wiersza (`for update`) i compare-and-swap:
wygrywa pierwsza transakcja, druga dostaje `VALIDATION_FAILED`, a historia, powiadomienie
i e-mail powstają raz. Dowód: `supabase/tests/rls.sql` sekcja OO (dwie sesje przez dblink).

Migracja (oba kontrakty): `supabase/migrations/0075_idempotent_message_offer_expiry.sql`.

### Rollback

Najpierw wycofaj kod aplikacji przekazujący `p_client_message_id`, następnie w nowej migracji
odtwórz `send_message(uuid, text)` i `respond_to_offer(uuid, boolean)` z
`0070_company_recipients_active_members.sql` (z grantami `execute` dla `authenticated`) i wykonaj:

```sql
drop function if exists public.send_message(uuid, text, uuid);
drop index if exists public.messages_client_message_id_uniq;
alter table public.messages drop column if exists client_message_id;
```

Rollback usuwa tylko identyfikatory operacji; treść wiadomości pozostaje bez zmian.
