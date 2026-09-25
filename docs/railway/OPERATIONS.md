# Operacje — czujki, kopie i wyszukiwanie (#47)

Ten dokument opisuje część #47 zrobioną w kodzie. Kroki, które wymagają zmian
w infrastrukturze (zmienne Railway, loginy PostgreSQL, usługi cron, wolumeny,
zewnętrzny monitoring), są w sekcji „Kroki dla właściciela”. Repozytorium
tych kroków nie wykonuje.

## 1. Czujki: `GET /api/health/ops`

| Endpoint | Kto | Co zwraca |
|---|---|---|
| `/api/health` | publicznie (Railway healthcheck, uptime) | tylko `status` (`ok`/`unconfigured`); szczegóły z tokenem |
| `/api/health/ops` | wyłącznie z nagłówkiem `x-health-token: <HEALTH_CHECK_SECRET>` | liczby z bazy, kody sygnałów, stan puli procesu |

`/api/health/ops` bez skonfigurowanego sekretu albo z błędnym tokenem zwraca
**404**, także poza produkcją, więc nie potwierdza nawet swojego istnienia.
Odpowiedź zawiera wyłącznie liczby i kody. Nie ma w niej adresów, treści,
identyfikatorów ani konfiguracji.

| HTTP | `status` | Znaczenie |
|---|---|---|
| 200 | `ok` | brak alarmów; po alarmie to **sygnał recovery** |
| 503 | `alert` | przekroczony próg, kody w `alerts` |
| 503 | `unavailable` | nie da się odczytać metryk (baza/uprawnienia); szczegół w Sentry `ops.metrics` |
| 503 | `unconfigured` | brak źródła metryk (`DATABASE_OPS_URL` ani service-role) |

`warnings` nie zmieniają kodu HTTP. To sygnały do przeglądu, np. nieudane wysyłki z 24 h.

### Sygnały i progi (`src/lib/ops/sensors.ts`)

| Kod | Rodzaj | Warunek | Typowa przyczyna |
|---|---|---|---|
| `email_queue_age` | alarm | najstarszy gotowy e-mail domenowy czeka > 15 min | cron `/api/email/process` nie działa, Resend niedostępny |
| `email_lease_abandoned` | alarm | wiersz z dzierżawą > 300 s i nadal `queued` | worker padł w trakcie wysyłki |
| `auth_email_queue_age` | alarm | najstarszy gotowy e-mail auth (weryfikacja/reset) > 5 min | worker kolejki auth nie działa |
| `auth_email_lease_abandoned` | alarm | dzierżawa `leased` po `lease_expires_at` | worker auth padł |
| `webhook_stuck` | alarm | webhook `processing` > 15 min | awaria w trakcie przetwarzania (0038) |
| `maintenance_lag` | alarm | aktywna oferta > 2 h po `expires_at`, rezerwacja kodu > 26 h, checkout `pending` > 150 min | cron `/api/maintenance` nie działa |
| `db_connections` | alarm | użyte ≥ 80% z `max_connections − superuser_reserved_connections` | wyciek połączeń, za dużo replik |
| `email_failed`, `auth_email_failed`, `webhook_failed` | ostrzeżenie | nieudane w ostatnich 24 h | błędne adresy, odrzucenia dostawcy |
| `app_pool_waiting` | ostrzeżenie | żądania czekają na połączenie puli **tego procesu** | pula za mała albo blokujące zapytania |
| `mail_hard_bounce_rate` | alarm | ≥ 50 listów przyjętych w 24 h i > 5% z nich trwale odbitych | zła lista adresów, import, literówki w formularzu |
| `mail_hard_bounce_rising` | alarm | odsetek trwałych odbić 24 h > 2% i > 2× odsetka z 7 dób bazowych (≥ 50 listów w obu oknach) | jak wyżej, wcześniejszy sygnał |
| `mail_complaint_rate` | alarm | ≥ 50 listów w 24 h i > 0,3% skarg | niechciane wiadomości, brak łatwego wypisania |
| `mail_complaint_rising` | alarm | odsetek skarg 24 h > 0,1% i > 2× odsetka z 7 dób bazowych | nowa kampania/szablon |
| `mail_suppressions_new` | alarm | > 20 nowych blokad adresów w 24 h | nagły skok odbić lub skarg |
| `mail_suppressions_active` | ostrzeżenie | > 1000 aktywnych blokad | przegląd listy w `/admin/poczta` |

Liczby pochodzą z `public.ops_metrics()` (migracja `0096`, `SECURITY DEFINER`,
EXECUTE mają tylko `pracujbe_ops` i `service_role`). Rola `pracujbe_ops` nie ma
żadnych praw do tabel. Dowód: `supabase/tests/rls.sql` sekcja OPS47 i
`tests/integration/ops-metrics.test.ts` z prawdziwym loginem, kontrolą ujemną
i odmową dostępu do tabel. `appPool` opisuje pulę jednej instancji. Przy kilku
replikach każde wywołanie może trafić do innej instancji.

### Poczta (#44, migracja `0118`)

Sekcja `mail` w `ops_metrics()` zawiera same liczby: listy przyjęte przez dostawcę
(`sent_at`) w ostatnich 24 h i w 7 dobach bazowych przed nimi (okno 2.–8. doba), ile
z tej samej kohorty trwale się odbiło (`bounce_type = 'permanent'`) i ile dostało
skargę (zdarzenia z webhooka Resend, 0098), liczbę aktywnych blokad
(`email_suppressions`, `lifted_at is null`) i blokad założonych w 24 h. Odsetki
liczymy dla kohorty wysyłki, więc spóźnione zdarzenie (np. skarga po dwóch dniach)
trafia do okna, w którym list wyszedł. Poniżej 50 listów w oknie odsetków nie
oceniamy — pojedyncze odbicie przy małym ruchu nie podnosi alarmu. Wiek najstarszego
gotowego wiersza obu kolejek (`email_deliveries`, `auth.email_outbox`) to istniejące
`email_queue_age` / `auth_email_queue_age`. Progi to wartości startowe
(`OPS_THRESHOLDS.mail*`) — skoryguj je po kilku tygodniach realnego ruchu. Baza bez
`0118` nie ma sekcji `mail`: czujki poczty milczą, reszta działa. Kolejka auth nie
zapisuje zdarzeń doręczenia, więc odsetki dotyczą tylko poczty domenowej. Dowód:
`rls.sql` sekcja OPS44 (z kontrolą ujemną na ciele z `0096`), test integracyjny
z loginem monitoringu (alarm → recovery), `tests/unit/ops-sensors.test.ts`.

Źródło metryk ustala `src/lib/ops/metrics-source.ts`. Pierwszeństwo ma
`DATABASE_OPS_URL` (PostgreSQL Railway, osobny login, jedna sesja na proces),
a gdy go nie ma, używany jest przejściowy service-role Supabase.

## 2. Kopie zapasowe

Pełny opis: [BACKUP_RESTORE.md](BACKUP_RESTORE.md). W skrócie:

- `scripts/db/backup.sh` tworzy zaszyfrowany artefakt `age` (klucz publiczny),
  wykonuje pełny odczyt `pg_restore`, zapisuje manifest z rozmiarami i SHA-256,
  stosuje retencję i opcjonalnie wysyła ping heartbeat;
- `scripts/db/restore-backup.sh` odtwarza artefakt do izolowanej bazy
  `pracujbe_restore_*` i porównuje wynik z manifestem;
- `scripts/db/test-backup.sh` (`npm run test:backup`) to test obu skryptów na
  PostgreSQL 16 z kontrolami ujemnymi;
- `scripts/db/verify-restore.sh` to dotychczasowy dowód „zrzut → odtworzenie”
  bez artefaktu, sprawdzany w CI (job `rls`).

## 3. Wyszukiwanie ofert — pomiar

Pomiar wykonuje `scripts/db/search-benchmark.sh` (`npm run db:search-benchmark`).
Tworzy jednorazową bazę z migracjami, 20 000 syntetycznych ofert (16 000
aktywnych) z tytułami PL/RO/UK/FR/NL/EN i miastami w kilku zapisach. Dla każdego
zapytania wypisuje liczbę wyników `get_public_jobs_count` oraz czas i węzeł
planu ciała `get_public_jobs` (auto_explain, drugie wywołanie w sesji).
Porównuje stan przed migracjami po `BENCH_BASELINE` (domyślnie `0108`) i po nich.
Tabela niżej = pomiar z 24.09.2026 dla `0096` (indeks miasta).

Wyniki z 24.09.2026 (lokalnie, czas w ms):

| Zapytanie (keyword / city) | Wyniki | PG16 przed | PG16 po | PG18 przed | PG18 po | Węzeł PG18 po |
|---|---:|---:|---:|---:|---:|---|
| `sprzątania` / — | 889 | 1329 | 1353 | 29 | 18 | Index Scan `idx_jobs_published_at` |
| `sprzątanie` / — | **0** | 1014 | 1094 | 805 | 759 | Index Scan `idx_jobs_published_at` |
| `sprzatania` / — | **0** | 1111 | 1084 | 757 | 848 | jw. |
| `Șofer` / — | 889 | 1190 | 1103 | 16 | 19 | jw. |
| `sofer` / — | **0** | 1055 | 1032 | 882 | 801 | jw. |
| `Водій` / — | 889 | 1296 | 1067 | 16 | 17 | jw. |
| `nettoyage` / — | 889 | 1116 | 1133 | 19 | 16 | jw. |
| `Preparateur` / — | **0** | 1102 | 1112 | 776 | 826 | jw. |
| `magazijn` / — | 889 | 1313 | 1217 | 26 | 17 | jw. |
| `warehouse` / — | 888 | 1077 | 1046 | 17 | 17 | jw. |
| — / `Bruxelles` | 1340 | 97 | 92 | 1.6 | 3.5 | Index Scan `idx_jobs_published_at` |
| — / `Brussels` | **0** | 11 | 11 | 8.9 | **0.09** | Bitmap Heap Scan `idx_jobs_city_trgm` |
| — / `Liege` | **0** | 10 | 10 | 9.1 | **0.04** | Bitmap Heap Scan `idx_jobs_city_trgm` |
| — / `Luik` | **0** | 11 | 11 | 8.6 | **0.03** | Bitmap Heap Scan `idx_jobs_city_trgm` |
| `Kierowca` / `Gent` | 74 | 96 | 90 | 77 | 61 | Bitmap Heap Scan `idx_jobs_city_trgm` |

Wnioski:

1. **Railway używa PostgreSQL 18.** Od PG18 ciało funkcji SQL trafia do cache
   planów i może dostać plan dla konkretnych wartości. Dzięki temu warunek
   `p_city is null or j.city ilike …` korzysta z `idx_jobs_city_trgm`, a
   zapytania o rzadkie lub nieistniejące miasto przyspieszają z około 9 ms do
   około 0,05 ms. Na PG16 (CI) plan ogólny z parametrem `$3 IS NULL OR …` nie
   używa żadnego indeksu i indeks nie zmienia czasu. Obniża to jednak tylko
   koszt zapisu jednej kolumny aktywnych ofert.
2. **Słowo kluczowe to główny koszt i nie ma indeksu.** Warunek
   `coalesce(t.title, j.title) ilike '%…%'` łączy tytuł oferty z tłumaczeniem z
   podzapytania LATERAL, więc żaden indeks nie może go obsłużyć. Zapytanie bez
   trafień przegląda wszystkie aktywne oferty: około 0,8 s na PG18 i około 1 s
   na PG16 przy 16 000 ofert. Na PG16 zły szacunek (`rows=1`) daje nested loop
   z firmami przy każdym zapytaniu z keyword.
3. **Jakość wyników:** wyszukiwanie jest wrażliwe na znaki diakrytyczne
   (`sprzatania`, `sofer`, `Preparateur`, `Liege` → 0) i odmianę (`sprzątanie`
   nie znajduje „sprzątania”). Nie zna też aliasów miast w innych językach
   (`Brussels`, `Luik` → 0 przy ofertach zapisanych jako „Bruxelles”/„Liège”). Cyrylica i rumuńskie `Ș` działają przy zapisie
   z diakrytykami (ILIKE w UTF-8).
4. **Escapowanie LIKE:** `%` i `_` w słowie kluczowym działają jak symbole
   wieloznaczne (`50%` dopasuje wszystko). To dotyczy poprawności wyników.
   Dane innych ofert nie są przez to dostępne.

### Po `0110` — wyszukiwanie bez diakrytyków i literalne `%`/`_` (25.09.2026)

`0110_search_unaccent.sql` zmienia warunki słowa kluczowego i miasta w
`get_public_jobs`/`_count`/`get_public_job_filter_facets` (pozostałe parametry
i granty jak w `0091`):

- obie strony porównania składa `search_fold(text)` = `lower(unaccent(…))`
  ze stałym słownikiem (IMMUTABLE, indeksowalne); cyrylicę słownik zostawia
  bez zmian (poza `ё`), rumuńskie `ș`/`ț` i polskie `ł` składa;
- wpis użytkownika trafia do `LIKE` jako literał (`search_like_pattern`
  escapuje `\`, `%`, `_`), więc `50%` szuka napisu „50%”;
- prefiltry przez indeksy GIN `gin_trgm_ops` na `search_fold(title)`
  (oferty, tłumaczenia) i `search_fold(city)`; dokładny warunek na tytule
  wyświetlanym w locale zostaje. `idx_jobs_city_trgm` z `0096` zastąpił
  `idx_jobs_city_fold_trgm`.

Pomiar `npm run db:search-benchmark` (PG16 lokalnie, 20 000 ofert, 16 000
aktywnych; „przed” = migracje do `BENCH_BASELINE=0107`, „po” = z migracją wyszukiwania, dziś `0110`):

| Zapytanie (keyword / city) | Wyniki przed | Wyniki po | ms przed | ms po |
|---|---:|---:|---:|---:|
| `sprzątanie` / — | 0 | 0 | 947 | 3 |
| `sprzątania` / — | 889 | 889 | 824 | 74 |
| `sprzatania` / — | **0** | 889 | 895 | 81 |
| `SPRZATANIA` / — | **0** | 889 | 964 | 134 |
| `50%` / — | 0 | 0 | 993 | 4 |
| `_` / — | **16000** | 0 | 1034 | 286 |
| `sofer` / — | **0** | 889 | 883 | 99 |
| `Водій` / — | 889 | 889 | 878 | 68 |
| `Preparateur` / — | **0** | 889 | 992 | 168 |
| `warehouse` / — | 888 | 888 | 1041 | 121 |
| — / `Bruxelles` | 1340 | 1340 | 72 | 144 |
| — / `Liège` | 1339 | 1339 | 88 | 79 |
| — / `Liege` | **0** | 1339 | 8 | 101 |
| — / `Brussels` | 0 | 0 | 7 | 3 |
| `Kierowca` / `Gent` | 74 | 74 | 84 | 88 |

Wnioski: słowo kluczowe jest 6–300× szybsze, bo wiersze bez trafienia w
tytule lub tłumaczeniu odpadają przed złączeniem LATERAL. Miasto o wielu
trafieniach kosztuje podobnie jak dotąd (składanie tylko w prefiltrze).
`_`/`%` przestały dopasowywać wszystko. Czasy PG18 (Railway) do ponownego
pomiaru na kopii produkcyjnej bazy.

**Nadal otwarte:** odmiana (`sprzątanie` ≠ „sprzątania”) i aliasy miast
w innych językach w SQL (`Brussels`, `Luik`; dziś rozwija je aplikacja przez
`src/lib/job-list-query.ts`). Przed wdrożeniem `0110` sprawdź na Railway:
`select * from pg_available_extensions where name = 'unaccent'`.

## 4. Rollback — kod, schemat, dane

| Warstwa | Jak cofnąć | Czego NIE robić |
|---|---|---|
| **Kod** (route `/api/health/ops`, `src/lib/ops/*`, skrypty) | redeploy poprzedniego SHA w Railway; endpoint znika, pozostałe trasy bez zmian | — |
| **Schemat** (`0096`) | NOWA migracja naprawcza: `drop function public.ops_metrics()`, `drop index public.idx_jobs_city_trgm`, `revoke usage on schema public from pracujbe_ops`, a po odebraniu członkostwa loginowi monitoringu `drop role pracujbe_ops` | nie edytuj zastosowanej `0096`; kod starszy niż `0096` działa na bazie z `0096` (funkcja i indeks są addytywne) |
| **Schemat** (`0118`, poczta) | NOWA migracja naprawcza z ciałem `ops_metrics()` z `0096` i `drop index public.idx_email_deliveries_sent_at` | aplikacja toleruje brak sekcji `mail` (czujki poczty milczą) |
| **Dane** | `0096` nie zmienia danych. Utracone dane odtwarzasz z kopii: `restore-backup.sh` do izolowanej bazy, weryfikacja, potem decyzja o przełączeniu/eksporcie | nigdy nie odtwarzaj kopii bezpośrednio do produkcyjnej bazy; skrypty odmawiają celu spoza `pracujbe_restore_*` |

Kopie logiczne nie zastępują snapshotów wolumenu Railway i odwrotnie. Snapshot
cofa całą bazę do chwili wykonania, a kopia logiczna pozwala odtworzyć bazę do
izolowanego celu i sprawdzić jej zawartość.

## 5. Kroki dla właściciela (infrastruktura — poza repozytorium)

1. **Sekret monitoringu:** ustaw `HEALTH_CHECK_SECRET` w usłudze web Railway
   (losowe ≥ 32 znaki). Bez niego `/api/health/ops` zwraca 404.
2. **Login monitoringu PostgreSQL** (po `0096`, jako migrator):
   ```sql
   create role pracujbe_ops_monitor login password '<losowe>'
     noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
   grant pracujbe_ops to pracujbe_ops_monitor;
   ```
   W usłudze web ustaw `DATABASE_OPS_URL=postgresql://pracujbe_ops_monitor:…@<prywatny host>:<port>/<baza>?sslmode=…`.
   Aplikacja odrzuci login z innym członkostwem, uprawnieniami superusera lub
   własnością bazy.
3. **Zewnętrzny uptime** (usługa spoza Railway, np. z nagłówkami HTTP):
   `https://pracuj.be/` i `https://pracuj.be/api/health`, w obu przypadkach
   oczekiwane 200, co 1–5 min. Do tego `https://pracuj.be/api/health/ops`
   z nagłówkiem `x-health-token`, oczekiwane 200 co 5 min. Alarm po 2 kolejnych
   odpowiedziach innych niż 200, recovery po pierwszym 200. Krytyczna ścieżka
   bez zapisu danych to lista `/pl/oferty-pracy` (odczyt z bazy przez rolę `anon`).
4. **Kopie:** osobna usługa cron (bez publicznej domeny) z klientem PostgreSQL
   w wersji ≥ serwera (Railway: 18) i `age`. Potrzebuje zmiennych `BACKUP_*`
   (patrz BACKUP_RESTORE.md), katalogu artefaktów na wolumenie lub w buckecie
   poza wolumenem bazy, harmonogramu raz na dobę i `BACKUP_HEARTBEAT_URL` do
   usługi dead-man’s-switch. Klucz prywatny `age` trzymaj poza Railway (np. w menedżerze haseł właściciela).
5. **Okresowe odtworzenie:** raz w tygodniu `restore-backup.sh` do tymczasowej
   bazy na osobnym klastrze, np. jednorazowej usłudze Railway PostgreSQL lub
   lokalnym kontenerze. Wynik `RESTORE: PASS` zanotuj w STATUS.md.
6. **CI (opcjonalnie, zmiana workflow należy do właściciela):** test kopii
   szyfrowanej można dopiąć do joba `rls` po instalacji `age` w kontenerze usługi:
   ```yaml
   - name: Encrypted backup/restore test (age)
     env:
       POSTGRES_CONTAINER: ${{ job.services.postgres.id }}
     run: |
       docker exec "$POSTGRES_CONTAINER" sh -c 'apt-get update -qq && apt-get install -y -qq age >/dev/null'
       docker exec -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGUSER=postgres -e PGPASSWORD=postgres \
         "$POSTGRES_CONTAINER" bash /tmp/pracujbe-tests/scripts/db/test-backup.sh
   ```

## Pozostałe punkty #47 (niezrobione w tej zmianie)

- raportowanie CSP (`report-to`) z limitem i redakcją URL/PII oraz ścisła
  `Referrer-Policy` na stronach z tokenami;
- testy blokujące nieoczekiwane HTTP w unit/integration;
- wyszukiwanie `unaccent` + escapowanie LIKE (follow-up po #188, patrz §3);
- metryka „porzuconych dzierżaw” kolejek innych niż e-mail (obecnie brak takich kolejek).
