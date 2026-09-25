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

## Aplikacja bez konta

`applications.candidate_id` może być `NULL` wyłącznie z kompletem snapshotu gościa
(`applications_candidate_or_guest_chk`: `guest_name`, `guest_email`). Częściowy unikat
`uq_applications_guest_email_job (job_id, guest_email)` dopuszcza jedną aktywną aplikację
gościa na (oferta, e-mail). Oczekujące zgłoszenia (`guest_application_requests`) nie mają
grantów ani polityk — tylko RPC `submit_guest_application` / `confirm_guest_application`
(service_role) i `claim_guest_application` (authenticated). Tokeny są przechowywane
wyłącznie jako hash SHA-256. Zmianę `candidate_id` (NULL → `auth.uid()`) trigger
`enforce_application_integrity` dopuszcza tylko wewnątrz `claim_guest_application`.
Szczegóły, retencja i rollback: [`GUEST_APPLY.md`](./GUEST_APPLY.md). Migracja: `0095`.

## Publiczne zgłoszenia treści (DSA) i trwały model sprawy

Migracja `supabase/migrations/0094_dsa_notices.sql` (#41). Zgłoszenie z publicznego
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
`due_at` = 7 dni, opcjonalne imię. Decyzje moderacyjne i egzekucja — #42 (niżej), odwołania — #43.
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

## Decyzja moderacyjna i egzekucja w sprawie DSA

Migracja `supabase/migrations/0099_dsa_moderation.sql` (#42). Sprawę `dsa_notice` rozstrzyga
wyłącznie `admin_decide_report(report, expected_status, decision, facts, ground_type,
ground_reference, automated_detection)`. W jednej transakcji zapisuje decyzję, wykonuje skutek,
zamyka sprawę, dopisuje historię i audyt oraz kolejkuje powiadomienia. Błąd którejkolwiek
części cofa całość, a sprawa zostaje otwarta.

- **Decyzja (`moderation_decisions`, niezmienna).** Rodzaj: `no_action`, `job_removed`
  (oferta) albo `company_suspended` (firma wraz z jej ofertami). Zapisuje fakty (20–1000
  znaków), podstawę (`terms`/`law`) i wskazanie postanowienia (wymagane przy ograniczeniu),
  udział automatyzacji (`automated_detection`; `automated_decision` zawsze `false`), autora
  decyzji (`decided_by`), stan treści sprzed decyzji i numer `DEC-XXXX-XXXX-XXXX` do odwołań.
  Jedna decyzja na sprawę. Tabela nie ma grantów dla klientów.
- **Skutek i blokada.** `job_removed` → oferta `closed` + `jobs.moderation_decision_id`;
  `company_suspended` → firma `suspended` + `companies.moderation_decision_id`. Póki blokada
  trwa, statusu nie zmieni żadna rola (`MODERATION_LOCKED`): ani `set_job_status` pracodawcy,
  ani `admin_set_company_status`, ani zapis bezpośredni. Blokadę ustawia i zdejmuje tylko
  decyzja albo przywrócenie.
- **Spójność przy COMMIT.** Odroczony constraint trigger `trg_moderation_effect_check`
  odrzuca decyzję, dla której treść nie jest ograniczona albo sprawa nie jest zamknięta tą
  decyzją (`MODERATION_EFFECT_MISSING`). Działa także przy zapisie z pominięciem RPC.
- **Sam status nie wystarcza.** Trigger `reports_decision_guard`: sprawę DSA zamyka
  (`resolved`/`dismissed`) tylko decyzja (`reports.decision_id`), zgodnie z jej rodzajem.
  `admin_resolve_report` może jedynie wziąć sprawę do analizy. Rozstrzygniętej sprawy nie
  otwiera się zmianą statusu (odwołania — #43).
- **Równoległe decyzje.** Sprawa `FOR UPDATE` + `expected_status` (`STALE_STATE`), treść
  `FOR UPDATE`. Druga decyzja o już ograniczonej treści nie zmienia blokady i dziedziczy stan
  sprzed pierwszego ograniczenia.
- **Powiadomienia (outbox, Invariant #1).** Aktywni właściciele firmy: in-app
  (`data.kind = 'moderation'`) i e-mail `moderationJobRemoved`/`moderationCompanySuspended`
  z uzasadnieniem w ich języku. Zgłaszający: `reportDecisionActioned`/`reportDecisionNoAction`
  z samym wynikiem, bez faktów i danych autora (profil → `resolve_recipient_locale`, gość →
  język zgłoszenia). `get_report_case` zwraca `outcome` bez uzasadnienia.
- **Przywrócenie.** `admin_restore_moderation(decision, reason)`: niezmienny wpis
  `moderation_restorations`, zdjęcie blokady albo przekazanie jej innej aktywnej decyzji
  o tej samej treści, powrót do stanu sprzed decyzji (oferta `active`/`paused` tylko przed
  terminem), historia, audyt `moderation.restored`, e-mail `moderationRestored`.
- **Kolejka przeglądu.** `reports.review_priority` (0–3) i `review_flag` ustawia tylko
  `flag_report_for_review` (`service_role`, np. automat). Flaga niczego nie rozstrzyga.
- **Uzasadnienie dla autora.** `get_company_moderation_decisions(company)` — aktywny
  owner/admin firmy (panel `/employer/firma`), bez tożsamości moderatora.

Dowód: `supabase/tests/rls.sql` sekcja MOD42. Obejmuje regresję z kontrolą ujemną (bez
strażnika sprawa „rozstrzygnięta”, a oferta publiczna), wstrzykniętą awarię egzekucji, wyścig
dwóch decyzji przez dblink, blokadę dla każdej roli oraz przywrócenie z przekazaniem blokady.

### Rollback

Decyzje są dowodem — przed rollbackiem wyeksportuj `moderation_decisions` i
`moderation_restorations`. Najpierw wycofaj kod aplikacji (dialog decyzji, sekcja w panelu
firmy), następnie w nowej migracji zdejmij blokady (z wyłączonymi triggerami
`trg_guard_job_moderation_lock`/`trg_guard_company_moderation_lock`), usuń funkcje
`admin_decide_report`, `admin_restore_moderation`, `flag_report_for_review`,
`get_company_moderation_decisions`, triggery i funkcje strażników, tabele
`moderation_restorations` i `moderation_decisions`, nowe kolumny `jobs`/`companies`/`reports`/
`report_events`. Na koniec przywróć check `report_events.event_type` i `get_report_case` z 0094.

## Odwołania, terminy, retencja i raport przejrzystości DSA

Migracja `supabase/migrations/0104_dsa_appeals.sql` (#43; numer według kolejki
koordynatora migracji). Buduje na sprawie z 0094 i decyzji z 0099.

- **Odwołanie (`moderation_appeals`, niezmienne).** Jedno na decyzję, numer
  `APL-XXXX-XXXX-XXXX`, uzasadnienie 20–2000 znaków, klucz idempotencji, termin rozpatrzenia
  (`due_at`). Autor treści (aktywny owner/admin firmy) odwołuje się od ograniczenia przez
  `submit_moderation_appeal(decision, key, grounds)` pod sesją; zgłaszający — od braku działań,
  numerem sprawy i kodem dostępu przez `submit_report_appeal` (EXECUTE tylko `service_role`,
  woła je Server Action za limiterem). Cudza decyzja = `NOT_FOUND`. Żadna strona nie widzi
  danych drugiej: autor dostaje swoje decyzje i odwołania (`get_company_moderation_decisions`
  z polami odwołania), zgłaszający — wynik i własne odwołanie (`get_report_case`); zdarzenia
  odwołań nie są widoczne w RLS historii sprawy dla zgłaszającego.
- **Termin od poinformowania.** `moderation_informed_at(decision)` = pierwszy faktycznie wysłany
  e-mail o decyzji (`sent`/`delivered`/`opened`/`clicked`; odbicie się nie liczy) albo odczyt
  powiadomienia w panelu (autor). Koniec terminu = poinformowanie + `dsa_appeal_window()`.
  Dopóki strona nie została poinformowana, termin nie biegnie. Stan drogi odwołania:
  `moderation_appealable` (`OK`, `APPEAL_EXISTS`, `APPEAL_WINDOW_CLOSED`, `INVALID_TRANSITION`).
- **Rozpatrzenie.** `admin_decide_appeal(appeal, expected_status, outcome, reasoning,
  new_decision, ground_type, ground_reference)`. Autor decyzji nie rozpatruje odwołania, jeśli
  jest inny aktywny administrator (`REVIEWER_CONFLICT`); gdy go nie ma, zapisuje się
  `same_reviewer = true` (widoczne w raporcie). Odwołanie autora uwzględnione → cofnięcie
  ograniczenia wspólnym rdzeniem `moderation_restore_core` (ten sam co
  `admin_restore_moderation`, bez dubla e-maila „przywrócono”). Odwołanie zgłaszającego
  uwzględnione → nowa decyzja ograniczająca (`moderation_decisions.appeal_id`) z egzekucją
  i powiadomieniem autora; sprawa przechodzi `dismissed → resolved` i wskazuje nową decyzję
  (strażnik `reports_decision_guard` dopuszcza to tylko w tej ścieżce). Historia
  (`appeal_submitted`/`appeal_decided`), audyt (`moderation.appeal_submitted`/`_decided`),
  e-maile `appealReceived`/`appealUpheld`/`appealReversed` w języku odbiorcy. Błąd dowolnej
  części cofa całość.
- **Retencja.** `dsa_retention_cases()` wyznacza dla zamkniętej sprawy koniec drogi odwołania
  (każda decyzja: odwołanie rozpatrzone, ograniczenie cofnięte albo termin od poinformowania
  upłynął); sprawa z odwołaniem w toku albo z niepoinformowaną stroną czeka. Po
  `dsa_case_retention()` od tej chwili sprawa kwalifikuje się do anonimizacji.
  `dsa_retention_report()` to podgląd bez zapisu (panel `/admin/raport-dsa`);
  `dsa_retention_run(dry_run)` (tylko `service_role`) zapisuje przebieg w `dsa_retention_runs`
  i przy `dry_run = false` anonimizuje: kontakt zgłaszającego, opis, adres, snapshot, kod
  dostępu, fakty decyzji, powody przywróceń, uzasadnienia odwołań i payload e-maili (wiadomość
  z kolejki → `failed`). Wiersze, kategorie, rodzaje, daty i numery zostają — agregaty raportu
  przetrwają retencję. Audyt `dsa.retention_run`.
- **Raport przejrzystości.** `dsa_transparency_report(from, to)` (agregaty: zgłoszenia wg
  kategorii i rodzaju treści, decyzje wg rodzaju i podstawy, mediana czasu do decyzji,
  w terminie, automatyzacja, odwołania wg strony i wyniku, odwrócone decyzje, przywrócenia)
  i `dsa_statements_export(from, to)` (wiersz na decyzję bez danych osobowych i faktów) —
  tylko `service_role`; panel i `GET /api/admin/dsa-report?od=&do=&format=csv|json` po
  `requireAdmin`.

**Wartości tymczasowe (#40):** okno odwołania 6 miesięcy, termin rozpatrzenia 14 dni, retencja
12 miesięcy; zakres publikacji raportu i przekazywania do bazy DSA. Harmonogram: cron
`/api/maintenance` woła `dsa_retention_run` wyłącznie za jawną flagą `DSA_RETENTION_MODE`
(`dry-run` = podgląd z licznikami, `apply` = anonimizacja; brak/inna wartość = wyłączone,
bez zapytania do bazy — `src/lib/admin/dsa-retention-mode.ts`). `apply` — dopiero po
zatwierdzeniu wartości.

### Odwołanie zgłaszającego od cofnięcia ograniczenia (0109)

Migracja `0109_dsa_restoration_appeals.sql`
rozszerza tę samą maszynę odwołań:

- `moderation_appeals.appealed_restoration_id` — odwołanie od cofnięcia
  (`moderation_restorations`), tylko zgłaszającego (CHECK), cofnięcie musi dotyczyć decyzji
  odwołania (trigger). Unikaty: jedno odwołanie od decyzji i jedno od każdego cofnięcia.
- Ręczne cofnięcie (`admin_restore_moderation`) kolejkuje e-mail `reportRestored` do
  zgłaszającego w jego języku (profil → `resolve_recipient_locale`, gość — język formularza),
  bez powodu cofnięcia i danych autora. Termin odwołania biegnie od faktycznego wysłania tego
  e-maila (`moderation_restoration_informed_at`/`_appeal_deadline`).
- `moderation_restoration_appealable(id)`: od cofnięcia po uwzględnionym odwołaniu autora
  (albo przy jego odwołaniu w toku) i od cofnięcia decyzji, która już nie rozstrzyga sprawy —
  `INVALID_TRANSITION` (e-mail też nie wychodzi).
- `submit_report_restoration_appeal` (service_role, numer sprawy + kod, idempotentne) i
  `admin_decide_appeal`: rozpatruje ktoś inny niż osoba, która COFNĘŁA ograniczenie;
  uwzględnienie = nowa decyzja ograniczająca z `appeal_id` (jak przy braku działań).
- `get_report_case` zwraca `restoration` (data, stan drogi odwołania, termin, odwołanie);
  retencja czeka na koniec drogi odwołania od cofnięcia i czyści payload `reportRestored`;
  raport ma `appeals.againstRestoration`, eksport nie przypisuje decyzji odwołania od cofnięcia.

Dowód: `rls.sql` sekcja RA43 (kontrole ujemne: reguła recenzenta z 0104, retencja od chwili
cofnięcia, złączenie odwołań po samej decyzji). Rollback: w nagłówku migracji.

Dowód: `supabase/tests/rls.sql` sekcja APL43 — m.in. termin od poinformowania (e-mail w kolejce,
odbity, doręczony 7 mies. temu), rozdzielenie rozpatrującego z kontrolą (jedyny admin),
wstrzyknięta awaria przywrócenia, ponowne zastosowanie skutku, kontrola ujemna „naiwnej”
retencji od zamknięcia sprawy, agregaty niezmienione po anonimizacji.

### Rollback

Odwołania są dowodem — przed rollbackiem wyeksportuj `moderation_appeals` i
`dsa_retention_runs`. Wycofaj kod (formularze odwołań, `/admin/odwolania`, `/admin/raport-dsa`,
trasa eksportu), potem w nowej migracji: usuń funkcje z 0104, przywróć z 0099
`admin_restore_moderation`, `reports_decision_guard`, `moderation_append_only`,
`get_company_moderation_decisions`, `get_report_case`, check `report_events.event_type`
i unikat `moderation_decisions(report_id)`; z 0094 `reports_notice_immutable`,
`reports_dsa_notice_complete`, politykę `report_events_select_own`; usuń tabele
`dsa_retention_runs`, `moderation_appeals` i nowe kolumny. Zanonimizowanych danych rollback
nie przywraca.
