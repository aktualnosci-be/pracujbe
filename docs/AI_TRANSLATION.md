# Tłumaczenia AI — rdzeń (#31, #32)

Stan: 24.09.2026. Fundament kolejki, adaptera dostawcy i walidacji faktów. **Funkcja nie jest
wpięta w oferty ani profile** — to kroki #33 (oferty) i #34 (profile). Domyślnie wyłączona.
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
- `claim_translation_jobs(limit, lease_s)` — `FOR UPDATE SKIP LOCKED` + dzierżawa
  (`lease_id`, `lease_expires_at`). Wygasła dzierżawa (restart workera) wraca do puli; po
  wyczerpaniu prób → `failed / lease_expired`.
- `complete_translation_job(job, lease, pola, model, tokeny)` — CAS po `lease_id`, ponowna
  kontrola bieżącej rewizji i aktywności encji pod blokadą głowy, pełny zestaw kluczy.
  Wyniki: `applied`, `proposal` (korekta ręczna zablokowana — wynik czeka w zadaniu),
  `superseded`, `stale_lease`, `not_found`.
- `fail_translation_job(job, lease, kod, ponawialny, retry_after_s)` — backoff 30 s·2ⁿ⁻¹
  (max 1 h, jitter ±20%, Retry-After jako dolna granica) albo `failed`. Kod bez treści.
- `defer_translation_job(job, lease, kod, opóźnienie_s)` — globalny budżet AI (#36) odmówił,
  model nie został wywołany: zadanie wraca po opóźnieniu (1 s–1 h) i oddaje próbę z claim.
  Worker: `budget_exceeded` → 1 h, `budget_unavailable` → 5 min.

## Koszt (#36)

Adapter OpenAI (`openai-provider.ts`) woła model wyłącznie przez `withAiBudget` (`src/lib/ai/budget.ts`):
rezerwacja górnej granicy (`estimateTranslationCost`: prompt, pola z glosariuszem, schemat,
pełne `max_output_tokens` = 16000) przed API, rozliczenie tokenami z `usage` (także przy odmowie
modelu). Brak bazy zadań albo błąd rezerwacji = brak wywołania (fail-closed). Każde wywołanie
= jeden wiersz logu użycia bez treści (`ai_usage`, #489).
- `deactivate_translation_source(typ, id, purge)` — ukrycie (zaległe zadania `superseded`,
  spóźniony wynik niczego nie publikuje) albo purge (usunięcie konta/oferty: rewizje, zadania,
  przekłady i korekty; opóźniony worker dostaje `not_found`).
- `save_manual_translation` / `release_manual_translation` — korekta z autorem i wersją,
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
  jedna szybka ponowna próba; dalej ponawia kolejka. Mapowanie: odmowa i filtr treści → trwałe
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

## Konfiguracja

| Zmienna | Znaczenie |
|---|---|
| `AI_TRANSLATION_ENABLED` | `1`/`true` włącza; domyślnie wyłączone (także w produkcji) |
| `OPENAI_API_KEY` | wspólny z pozostałymi funkcjami AI; tylko serwer |
| `AI_TRANSLATION_MODEL` | opcjonalnie; inaczej `AI_MODEL`, domyślnie `gpt-6-luna` |
| `AI_TRANSLATION_PROVIDER=fixture` | atrapa bez sieci; ignorowana przy `APP_MODE=production` |

## Otwarte (poza tym krokiem)

Wpięcie ofert (#33) i profili (#34), trasa/cron workera,
benchmark i wybór modelu (#30), UI stanu tłumaczenia i SEO, bramka prywatności
przed prawdziwymi profilami (umowa powierzenia, retencja dostawcy — decyzja właściciela).
