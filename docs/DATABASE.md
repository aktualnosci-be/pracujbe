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
i e-mail powstają raz. Dowód: `supabase/tests/rls.sql` sekcja PP (dwie sesje przez dblink).

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

## Publiczne zgłoszenia treści (DSA) i trwały model sprawy

Migracja `supabase/migrations/0095_dsa_notices.sql` (#41). Zgłoszenie z publicznego
formularza (`/zglos-tresc`, także bez konta) to wiersz `public.reports` z `kind = 'dsa_notice'`
— osobna kolejka od dotychczasowych zgłoszeń (`kind = 'quality'`).

- **Zapis tylko przez RPC.** `submit_content_report(...)` i `get_report_case(text, text)` mają
  `EXECUTE` wyłącznie dla `service_role`; woła je Server Action
  (`src/lib/actions/content-reports.ts`) po limiterze i Turnstile (polityka `report`,
  fail-closed). Klient nie ma `INSERT/UPDATE/DELETE` na `reports` (polityka `reports_insert_own`
  usunięta), `anon` nie ma żadnych praw do `reports` ani `report_events`.
- **Tylko treść publiczna.** Cel wskazuje publiczna oferta (`job_is_public`): zgłaszana jest
  ta oferta albo firma, która ją opublikowała. Nieistniejący i prywatny identyfikator dają ten
  sam `NOT_FOUND`.
- **Idempotencja.** Klucz (`idempotency_key`, unikalny) + blokada doradcza: ponowienie i wyścig
  dwóch żądań zwracają tę samą sprawę (`created = false`), bez drugiego e-maila. Klucz użyty
  z innym kodem dostępu → `VALIDATION_FAILED` (cudzej sprawy nie da się tak odczytać).
- **Numer i dostęp.** `case_number` `DSA-XXXX-XXXX-XXXX-XXXX` (64 bity losowe). Kod dostępu
  (24 znaki base32) generuje przeglądarka zgłaszającego; w `reports` jest tylko jego SHA-256.
  `get_report_case` zwraca wyłącznie stan sprawy (status, rodzaj, kategoria, daty, historia
  bez aktorów); zły kod i obcy numer dają `null`.
- **Niezmienny zapis i dowód.** `target_snapshot` (oferta z tłumaczeniami i wymaganiami, firma)
  buduje baza w chwili zgłoszenia. Trigger `reports_notice_immutable` blokuje — dla każdej roli,
  także `service_role` — zmianę pól zgłoszenia DSA i jego usunięcie; zmienia się tylko stan
  sprawy (`status`, `resolved_*`), a `reporter_id` może jedynie przejść na `null` (FK przy
  usunięciu konta). Zmiana lub usunięcie oferty nie zmienia dowodu.
- **Historia.** `report_events` (tylko dopisywanie): `submitted` przy utworzeniu,
  `status_changed` przy każdej zmianie statusu — także przez istniejące `admin_resolve_report`.
  Zgłaszający widzi historię swoich spraw (RLS), bez kolumny `actor_id`.
- **Prywatność zgłaszającego.** Kontakt (`reporter_email`, `reporter_name`) czyta tylko
  administrator (service_role w panelu). Autor treści (firma) nie ma ścieżki odczytu `reports`.
- **Limit w bazie.** 5 spraw na adres e-mail w 24 h i jedna otwarta sprawa na (adres, treść) →
  `RATE_LIMITED`; niezależnie od limitera aplikacji.
- **Potwierdzenie e-mail.** `enqueue_email_to_address` (bez EXECUTE dla klienta) wstawia
  `reportReceived` do `email_deliveries` w języku zgłaszającego: zalogowany —
  `resolve_recipient_locale` (Invariant #1), gość — język formularza, który wybrał. Awaria
  poczty nie zmienia sprawy (outbox ponawia). Payload e-maila zawiera numer sprawy i kod
  dostępu (link do statusu niesie je we fragmencie `#`); `email_deliveries` czyta tylko
  `service_role` — retencja kolejki e-mail pozostaje osobnym zadaniem.

Wartości tymczasowe do potwierdzenia w mapie obowiązków DSA (#40): katalog kategorii, termin
`due_at` = 7 dni, opcjonalne imię. Decyzje moderacyjne i egzekucja — #42, odwołania — #43.
Dowód: `supabase/tests/rls.sql` sekcja DSA41 (m.in. wyścig przez dblink, kontrole ujemne).

### Rollback

Sprawy `dsa_notice` są dowodem — przed rollbackiem wyeksportuj je razem z `report_events`.
Najpierw wycofaj kod aplikacji (formularz, strona statusu, panel), następnie w nowej migracji:

```sql
drop trigger if exists trg_report_events_log on public.reports;
drop trigger if exists trg_reports_notice_immutable on public.reports;
drop function if exists public.submit_content_report(uuid, uuid, text, text, uuid, text, text, text, text, text, text, boolean);
drop function if exists public.get_report_case(text, text);
drop function if exists public.enqueue_email_to_address(text, text, uuid, text, text, uuid, text, jsonb);
drop function if exists public.report_events_log();
drop function if exists public.reports_notice_immutable();
drop table if exists public.report_events;
drop function if exists public.report_events_append_only();
-- po eksporcie: delete from public.reports where kind = 'dsa_notice';
alter table public.reports
  drop constraint if exists reports_dsa_notice_complete,
  drop constraint if exists reports_kind_chk,
  drop constraint if exists reports_category_chk,
  drop constraint if exists reports_content_url_length,
  drop constraint if exists reports_reporter_name_length,
  drop constraint if exists reports_reporter_email_length,
  drop column if exists kind, drop column if exists case_number,
  drop column if exists access_code_hash, drop column if exists idempotency_key,
  drop column if exists category, drop column if exists content_url,
  drop column if exists reporter_name, drop column if exists reporter_email,
  drop column if exists reporter_locale, drop column if exists good_faith_at,
  drop column if exists target_snapshot, drop column if exists due_at;
create policy reports_insert_own on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
grant insert on public.reports to authenticated;
grant select on public.reports to anon;
```

Kolejność: trigger `reports_notice_immutable` musi zniknąć przed usunięciem wierszy DSA.
