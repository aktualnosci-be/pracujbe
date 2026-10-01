# Tłumaczenia AI — rdzeń (#31, #32)

Stan: 25.09.2026. Fundament kolejki, adaptera dostawcy i walidacji faktów (#31/#32) oraz
wpięcie ofert (#33, sekcja „Oferty” niżej). Profile — #34. Domyślnie wyłączona.
Języki: tylko pl/nl/fr/en (decyzja właściciela; bez ro/uk z #29/#38). Plan całości:
`docs/AI_MULTILINGUAL_PLAN.md`.

## Kolejka i rewizje (migracja 0145)

| Tabela | Rola |
|---|---|
| `translation_sources` | „głowa” encji (`job` / `candidate_profile` + id): bieżąca rewizja, aktywność |
| `translation_source_revisions` | niezmienne rewizje: kanoniczne pola, język źródła, SHA-256 |
| `translation_jobs` | zadanie na (rewizja, język docelowy, wersja pipeline) — unikat = deduplikacja |
| `translation_documents` | aktualny przekład per (encja, język): pełny zestaw pól jednej rewizji, ai/manual |

Wszystkie tabele: RLS włączone i wymuszone, bez polityk i grantów dla anon/authenticated.
Funkcje wyłącznie dla `service_role`:

- `record_translation_source(typ, id, język, pola, wersja_pipeline, opóźnienie_s)` — wołana
  **w transakcji zapisu źródła** (#33/#34): nowa rewizja + zadania dla wszystkich języków
  portalu poza źródłowym; zaległe zadania starszych rewizji → `superseded`; istniejące
  przekłady → `is_stale`. Ta sama treść = `unchanged` (bez kosztu; może tylko przyspieszyć
  termin), nowa wersja pipeline albo ponowna aktywacja = `requeued`. Opóźnienie (≤ 1 h) scala
  częste zapisy robocze; publikacja z opóźnieniem 0 przyspiesza oczekujące zadania.
  Encja musi istnieć i nie być usunięta (oferta + firma, `candidate_profiles.id` + konto;
  `translation_entity_exists`, 0952) — inaczej `NOT_FOUND` bez żadnego wiersza.
- `claim_translation_jobs(limit, lease_s)` — `FOR UPDATE SKIP LOCKED` + dzierżawa
  (`lease_id`, `lease_expires_at`). Wygasła dzierżawa (restart workera) wraca do puli; po
  wyczerpaniu prób → `failed / lease_expired`.
- `complete_translation_job(job, lease, pola, model, tokeny)` — CAS po `lease_id` i ważnej
  dzierżawie (`lease_expires_at` w przyszłości, 0952 — po terminie `stale_lease`, także zanim
  inny worker przejmie zadanie; to samo `fail`/`defer`), ponowna
  kontrola bieżącej rewizji i aktywności encji pod blokadą głowy, pełny zestaw kluczy.
  Wyniki: `applied`, `proposal` (korekta ręczna zablokowana — wynik czeka w zadaniu),
  `superseded`, `stale_lease`, `not_found`.
- `fail_translation_job(job, lease, kod, ponawialny, retry_after_s)` — backoff 30 s·2ⁿ⁻¹
  (max 1 h, jitter ±20%, Retry-After jako dolna granica) albo `failed`. Kod bez treści.
- `defer_translation_job(job, lease, kod, opóźnienie_s)` — globalny budżet AI (#36) odmówił,
  model nie został wywołany: zadanie wraca po opóźnieniu (1 s–1 h) i oddaje próbę z claim.
  Worker: `budget_exceeded` → 1 h, `budget_unavailable` → 5 min. Przy zapasie dzierżawy
  < 90 s worker nie woła modelu (`lease_too_short`) — wynik i tak zostałby odrzucony.

## Koszt (#36)

Adapter OpenAI (`openai-provider.ts`) woła model wyłącznie przez `withAiBudget` (`src/lib/ai/budget.ts`):
rezerwacja górnej granicy (`estimateTranslationCost`: prompt, pola z glosariuszem, schemat,
pełne `max_output_tokens` = 16000) przed API, rozliczenie tokenami z `usage` (także przy odmowie
modelu). Brak bazy zadań albo błąd rezerwacji = brak wywołania (fail-closed). Każde wywołanie
= jeden wiersz logu użycia bez treści (`ai_usage`, #489).
- `deactivate_translation_source(typ, id, purge)` — ukrycie (zaległe zadania `superseded`,
  spóźniony wynik niczego nie publikuje) albo purge (usunięcie konta/oferty: rewizje, zadania,
  przekłady i korekty; opóźniony worker dostaje `not_found`). Ukrycie źródła encji, której
  już nie ma, = purge (0952).
- `save_manual_translation` / `release_manual_translation` — korekta z autorem i wersją
  (autor wymagany: aktywny admin, recruiter+ firmy oferty albo właściciel profilu; 0952),
  blokuje nadpisanie przez AI; reset blokady jest jawny i stosuje czekającą propozycję.

Wywołanie dostawcy nigdy nie odbywa się w transakcji: claim i complete/fail to osobne,
krótkie wywołania RPC (`src/lib/translation/store.ts`, `worker.ts`).

Dowód: `supabase/tests/rls.sql` sekcja TR31 (deny, atomowość i rollback, no-op, dedup,
v1 kończąca się po v2, restart/lease, retry/failed, korekta ręczna, ukrycie/purge) z kontrolą
ujemną TR31-N (bez kontroli rewizji spóźniony wynik v1 zostałby opublikowany).

## Adapter i walidacja (`src/lib/translation/`)

- `provider.ts` — interfejs `TranslationProvider` (surowa odpowiedź), błędy
  `TranslationProviderError` z powodem i flagą ponowienia, atrapa `FixtureTranslationProvider`.
- `openai-provider.ts` — wspólny klient `src/lib/ai/openai.ts` (Responses API, model
  `gpt-6-luna` — decyzja właściciela 2026-09-26), structured output `strict` ze schematem
  o dokładnie tych kluczach co źródło, bez narzędzi, `store: false`, pola w `<source_fields>`
  (próby zamknięcia znacznika neutralizowane), glosariusz pary języków. Klient: timeout 60 s,
  bez ponowień SDK (`maxRetries: 0` — rezerwacja budżetu = jedno wywołanie, #1106); ponawia
  kolejka (backoff zadania, każda próba rezerwuje budżet od nowa). Mapowanie: odmowa i filtr treści → trwałe
  (`refused`); limit dostawcy → `rate_limited`; każda inna awaria (sieć, 5xx, ucięta
  odpowiedź, zły JSON) → `provider_unavailable`, ponawiane w granicy `max_attempts`. Klient
  nie przekazuje komunikatu dostawcy ani `Retry-After`.
- `validate.ts` + `facts.ts` — wynik zapisywany tylko po przejściu wszystkich kontroli:
  kształt i klucze, puste pola, długość, znaczniki i znaki sterujące spoza źródła, echo granicy
  promptu, niezmienność faktów pole po polu: e-maile, URL/domeny, daty, godziny (8:00 = 8h00 =
  8u00), telefony, liczby (konwencja separatorów języka), waluty, jednostki, brutto/netto,
  okres stawki, terminy chronione (glosariusz, oznaczenia jak BA4/C95, nazwy przekazane
  jawnie) i obecność negacji. Kontrola jest zachowawcza: liczba zapisana słownie albo zmieniony
  format daty = odrzucenie. Nie ocenia płynności ani zmian znaczenia poza tymi kategoriami.
- `glossary.ts` — terminy bez tłumaczenia i terminologia belgijska; `pipeline.ts` — wersja
  pipeline (prompt + glosariusz) w kluczu deduplikacji.

Logi/monitoring dostają tylko kody i liczniki (`TranslationBatchResult`, `onEvent`) — nigdy
treść pól, promptu ani komunikatu dostawcy.

## Oferty (#33, migracja 0146)

Kolejka oferty jest skutkiem ZATWIERDZONEGO stanu oferty, nie osobnym wywołaniem w każdej
ścieżce zapisu. Odroczone triggery (`constraint trigger … initially deferred`) na `jobs`,
`job_translations`, `job_requirements` i `companies` wołają przy COMMIT
`sync_job_translation_source(job)`:

| Stan oferty przy commicie | Skutek |
|---|---|
| publiczna: `active`, nieusunięta, niewygasła, firma `verified`, `is_demo = false` | `record_translation_source` z polami w języku oferty (`default_locale`) — nowa treść = nowa rewizja + zadania dla pozostałych języków; ta sama = no-op; wznowienie = requeued |
| szkic, wstrzymana, zamknięta, wygasła, firma zawieszona, demo | `deactivate_translation_source(purge = false)`; szkic nigdy nie publiczny nie tworzy wpisu |
| usunięta (`deleted_at` albo brak wiersza) | purge — rewizje, zadania, przekłady i korekty |

Obejmuje to każdą ścieżkę: `publish_job`, `update_published_job`, wstrzymanie/wznowienie/
ponowne otwarcie, `expire_due_jobs`, decyzje moderacyjne, status firmy. Rollback zapisu nie
zostawia śladu w kolejce, a wiele zmian w jednej transakcji (opis + replace-all wymagań) daje
jedną rewizję z końcową treścią. Wynagrodzenie, miasto, daty i flagi nie są polami tłumaczenia —
ich zmiana nie tworzy rewizji i jest od razu wspólna (czytane z `jobs`).

Pola: `title`, `description`, `working_hours`, `shifts`, `company_description`, `meta_title`,
`meta_description`, `responsibilities.N`, `conditions.N`, `benefits.N`, `highlights.N`,
`requirements_mandatory.N`, `requirements_optional.N` (wymagania w języku oferty). Oferta ponad
limit rdzenia (80 pól / 60 000 znaków) publikuje się normalnie, tłumaczenie jest pomijane
(`skipped`, źródło ukryte). Wersja pipeline w SQL (`translation_pipeline_version()`) = stała TS
(test `translation-job-sync`).

Worker: `POST /api/translation/process` (`MAINTENANCE_SECRET`/`CRON_SECRET`), kilka paczek do
pustej kolejki albo 20 s (`src/lib/translation/run.ts`); bez flagi odpowiada `skipped` bez
bazy i dostawcy; `GET` = `405` bez autoryzacji i efektów (#614). Każde wywołanie modelu =
wiersz logu użycia AI (bez treści) i rezerwacja budżetu AI (#36); odmowa budżetu odracza zadania
bez zużycia prób (licznik `deferred` w odpowiedzi). Cron: Cloudflare
Worker co 10 min (`docs/CLOUDFLARE_CRON.md`, bez flagi = `skipped`) albo usługa
`cron-translation` w `docs/railway/KONFIGURACJA_PRODUKCJI.md` — tylko po decyzji o włączeniu.

Dowód: `rls.sql` sekcja TR33 (publikacja, pola wymagań, rollback, stawka bez rewizji, jedna
transakcja = jedna rewizja, spóźniony wynik = superseded, korekta ręczna po edycji, pauza/
wznowienie, firma zawieszona, wygaśnięcie, dwie sesje równolegle, limit pól, demo, soft/hard
delete) z kontrolą ujemną TR33-N; unit `translation-job-sync`, `translation-run`,
`translation-process-route`.

### Odczyt na stronie oferty (migracja 0159)

`get_public_job_machine_translation(job, locale)` (SECURITY DEFINER, anon/authenticated) to
jedyna ścieżka odczytu przekładu przez klienta — tabele kolejki zostają deny. Zwraca wiersz
tylko dla oferty publicznej (jak `get_public_job`, bez demo), aktywnego źródła, przekładu
BIEŻĄCEJ rewizji (`not is_stale`) w języku oferty i języka strony, w którym oferta nie ma
własnego tłumaczenia ani wymagań (tekst człowieka ma pierwszeństwo), i tylko gdy strona
pokazuje treść, z której powstała rewizja: tłumaczenie w `default_locale` albo `jobs.title`
przy braku tłumaczeń (`get_public_job` przy braku `default_locale` bierze np. `en`, a przekład
takiego tekstu by nie odpowiadał — ten sam warunek co karty listy); tylko pola wyświetlane
(tytuł, opis, godziny, zmiany, opis firmy, listy obowiązków/warunków/wyróżników/wymagań).

Strona `/{locale}/oferty-pracy/[slug]` (`getJobBySlug` → `readMachineTranslation`): tylko za
flagą `AI_TRANSLATION_ENABLED` (sama flaga, bez klucza dostawcy — `isTranslationDisplayEnabled`),
tylko gdy treść jest w innym znanym języku niż strona. `applyJobMachineTranslation`
(`src/lib/job-machine-translation.ts`) nakłada przekład wyłącznie przy pełnej zgodności
(rewizja w języku treści, każda lista o tej samej liczbie pozycji) — inaczej oryginał, nigdy
mieszanka języków. Awaria odczytu = oryginał + `captureError` z samym obszarem i ID oferty.
Oznaczenie pod paszportem: `job.machineTranslationNotice` (AI) albo
`job.manualTranslationNotice` (korekta ręczna) z językiem oryginału i linkiem
`job.translationOriginalLink` do wersji w języku oryginału. SEO bez zmian: strona z
przekładem nadal kanonizuje się do oryginału, bez hreflang i bez JobPosting (#301). ISR 60 s.

Dowód: `rls.sql` sekcja TM159 (bieżąca rewizja, tylko pola wyświetlane, pierwszeństwo tekstu
człowieka, oferta wstrzymana/firma zawieszona, przekład po edycji, granty, strona z tekstem
spoza `default_locale` — TM159-7) z kontrolami ujemnymi TM159-N i TM159-7N; unit `job-machine-translation` (flaga wyłączona = brak odczytu, awaria = oryginał).

### Karty listy ofert (migracja 0160)

`get_public_jobs_machine_titles(ids[], locale)` (SECURITY DEFINER, anon/authenticated) zwraca
przekład pól karty — `title` i `highlights.N` — dla najwyżej 100 ofert jednej strony listy.
Warunki jak w 0159 (oferta publiczna, bieżąca rewizja bez `is_stale`, język bez własnego
tłumaczenia i wymagań) plus warunek karty: `get_public_jobs` pokazuje przy braku tłumaczenia
w języku strony tłumaczenie `default_locale` (albo `jobs.title`), więc wiersz jest zwracany
tylko wtedy, gdy karta pokazuje właśnie tę treść, z której powstała rewizja.

`withListMachineTranslations` (`src/lib/jobs.ts`) robi JEDNO zapytanie na stronę (lista id,
nigdy zapytanie na kartę), za flagą `AI_TRANSLATION_ENABLED`, w tym samym renderze serwera co
lista — strony ISR (strona główna, landingi) dostają gotowy HTML, cache bez zmian.
`applyJobListMachineTranslation` nakłada tytuł i wyróżniki tylko przy niepustym tytule i tej
samej liczbie wyróżników; inaczej karta w oryginale. Awaria odczytu = oryginał + kod obszaru
`jobs.readListMachineTranslations`. Przekład włącza wywołujący (`getJobs(…, { translateCards:
true })`): „Najnowsze oferty”, `/oferty-pracy`, landingi kategorii i miasta, profil firmy.
Sitemap, liczniki, facety i „Podobne oferty” (lista bez znacznika) zostają w oryginale.
Znacznik na karcie (wiersz firmy): `jobs.machineTranslatedBadge` albo `jobs.translatedBadge`
(korekta ręczna). SEO bez zmian — adresy kart i dane strukturalne nie zależą od przekładu.

Dowód: `rls.sql` sekcja TM160 (tylko pola karty, limit 100 id, tekst człowieka, oferta
wstrzymana/wygasła, firma zawieszona, przekład po edycji, granty) z kontrolą ujemną TM160-N;
unit `job-list-machine-translation` (flaga wyłączona = brak odczytu, lista bez kart = brak
odczytu, jedno wywołanie na stronę, fallback, awaria).

## Nazwy chronione (#740, migracja 0190 — numer tymczasowy)

Nazwa firmy jest nazwą chronioną każdej rewizji oferty. Źródło wyłącznie serwerowe:
`sync_job_translation_source` czyta `companies.name` z bazy i przekazuje ją do
`record_translation_source(…, p_protected_terms)` — klient nie ma do tego ścieżki (RPC tylko
dla service_role). Lista jest częścią niezmiennej rewizji (`translation_source_revisions.
protected_terms`, normalizacja `translation_protected_terms`: trim, NFC, bez duplikatów,
posortowana, najwyżej 10 nazw po 1–200 znaków, bez znaków sterujących) i wchodzi do odcisku
treści — zmiana nazwy firmy (trigger na `companies` reaguje na `name`) tworzy nową rewizję
każdej jej oferty publicznej, stare zadania są superseded, przekłady nieaktualne. Bez nazw
odcisk jest taki jak w 0145. `claim_translation_jobs` zwraca `protected_terms`, worker
przekazuje je dostawcy (prompt: „Keep these terms exactly as written”) i walidatorowi: nazwa
obecna w polu źródła musi wystąpić bez zmian w tym samym polu przekładu, inaczej wynik jest
odrzucany kodem `facts_terms` i nie trafia do bazy. Wersja pipeline
`translation-v2+prompt-v1+glossary-v1`; migracja ponownie synchronizuje aktywne źródła ofert.

Dowód: `rls.sql` sekcja TP740 (kontrole ujemne: odcisk bez nazw, trigger firmy bez `name`),
rollback `supabase/rollback/0190_translation_protected_terms.down.sql`
(`translation-protected-terms-rollback.sql`), unit `translation-worker` (nazwa zmieniona przez
model = `facts_terms`, kontrola ujemna bez nazw), `translation-job-sync`.

Otwarte (#33 → kolejne kroki): JobPosting/hreflang wersji
przetłumaczonych (decyzja SEO), przekład w „Podobnych ofertach”, UI korekty ręcznej dla
rekrutera, inne nazwy własne poza nazwą firmy, budżet AI (#36/#552 — po
scaleniu: `costBudgeted: true` w inwentarzu i rezerwacja budżetu przed wywołaniem w
`run.ts`), oferty ponad limit pól (podział na kilka zleceń).

## Konfiguracja

| Zmienna | Znaczenie |
|---|---|
| `AI_TRANSLATION_ENABLED` | `1`/`true` włącza; domyślnie wyłączone (także w produkcji) |
| `OPENAI_API_KEY` | wspólny z pozostałymi funkcjami AI; tylko serwer |
| `AI_TRANSLATION_MODEL` | opcjonalnie; inaczej `AI_MODEL`, domyślnie `gpt-6-luna` |
| `AI_TRANSLATION_PROVIDER=fixture` | atrapa bez sieci; ignorowana przy `APP_MODE=production` |

## Otwarte (poza tym krokiem)

Wpięcie profili (#34),
benchmark i wybór modelu (#30), UI stanu tłumaczenia i SEO, bramka prywatności
przed prawdziwymi profilami (umowa powierzenia, retencja dostawcy — decyzja właściciela).
