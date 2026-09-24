# Import ogłoszenia przez AI (#465) — research i opis wdrożenia

Stan: 24.09.2026. Funkcja jest za flagą, **domyślnie wyłączona** (także w produkcji). Włącza ją
właściciel po akceptacji kosztów, dostawcy i warunków przetwarzania danych (patrz „Włączenie").

Pracodawca w kreatorze nowej oferty może wgrać zrzut ekranu istniejącego ogłoszenia albo wkleić
link. Serwer odczytuje ogłoszenie przez Claude i wstępnie wypełnia kroki kreatora. Pola niepewne
są oznaczone „do sprawdzenia" na odpowiednim kroku. Nic nie jest publikowane automatycznie —
publikacja przechodzi wyłącznie przez istniejące `publish_job` po kliknięciu „Opublikuj".

## Mapowanie pól kreatora

Import wypełnia pola `JobWizard` (nazwy = pola formularza, `src/lib/ai-import/schema.ts`):

| Krok | Pola | Uwagi |
|---|---|---|
| 1 | tytuł, kategoria, zawód | kategoria z listy `CATEGORY_KEYS`; wybór „najbliższej" zwykle trafia do sprawdzenia |
| 2 | typ umowy, godziny, zmiany, start od zaraz, data startu | lokalne nazwy umów (CDI, vast contract, interim…) mapowane na `CONTRACT_TYPES`; data tylko `RRRR-MM-DD` |
| 3 | miasto, region, adres, zdalna | region z ogłoszenia albo jednoznacznie z miasta |
| 4 | widełki, waluta, okres | kolumna całkowita: stawka 17,50 → 18 i oznaczenie; waluty spoza EUR/PLN → do sprawdzenia |
| 5 | opis, obowiązki | opis obcinany do 5000 znaków z oznaczeniem |
| 6 | wymagania obowiązkowe, umiejętności obowiązkowe, lata doświadczenia | limity pozycji jak `JOB_ITEM_LIMITS` (#364) |
| 7 | wymagania dodatkowe, umiejętności, języki (+poziom), certyfikaty, prawo jazdy | język bez poziomu → „podstawowy" + do sprawdzenia |
| 8 | warunki, benefity, zakwaterowanie, transport | — |
| 9 | opis firmy, e-mail kontaktowy | **zgoda na publikację nigdy nie jest ustawiana przez import** |

Każdy krok przechodzi przez **te same schematy Zod** co ręczne wypełnianie (`step1Schema` …
`step9DraftSchema`). Pole odrzucone przez schemat jest czyszczone i oznaczane; reszta kroku
zostaje w formularzu. Do szkicu w bazie trafiają tylko kroki poprawne w całości — jednym
wywołaniem atomowego RPC `save_job_draft` (#192, 0083; semantyka patch). Treść zostaje w języku
ogłoszenia; tłumaczenie to osobny temat (#29–#35).

## Wybór modelu i API

- **Dostawca:** Anthropic Messages API, oficjalny SDK `@anthropic-ai/sdk` (jedyna nowa zależność).
- **Model domyślny:** `claude-opus-5` — najnowszy Opus z vision (wysoka rozdzielczość do
  2576 px dłuższego boku) i structured output. Nadpisywalny `AI_JOB_IMPORT_MODEL`
  (np. `claude-sonnet-5`, ok. 2,5× taniej — decyzja właściciela po porównaniu jakości).
- **Structured output:** `output_config.format = { type: 'json_schema' }` ze schematem
  `JOB_EXTRACTION_JSON_SCHEMA`. Wszystkie pola wymagane, `additionalProperties: false`, bez typów
  unijnych (brak danych = `""` / `"unknown"` / `[]`) — API ogranicza liczbę pól unijnych.
  Limity długości/liczby nie są wspierane przez structured output, więc egzekwuje je Zod.
- **Effort `low`:** ekstrakcja z jednego dokumentu nie wymaga długiego rozumowania; obniża koszt
  i czas odpowiedzi. Bez narzędzi (tools) — model nie może niczego wykonać.
- **Odmowa modelu** (`stop_reason: refusal`), ucięcie odpowiedzi lub zły JSON → komunikat
  „Nie udało się odczytać ogłoszenia" (bez szczegółów dostawcy, Invariant #8). Serwerowy
  mechanizm fallbacku modelu (beta) celowo nie jest włączony — do decyzji po pierwszych danych.

## Koszty i limity

Ceny Anthropic (cache skilla claude-api, 24.06.2026; zweryfikować przed włączeniem):
Opus 5 — 5 USD / 1 mln tokenów wejścia, 25 USD / 1 mln wyjścia; Sonnet 5 — 2 / 10 USD.

Szacunek na jedno wywołanie (do potwierdzenia pomiarem `usage` na realnych ogłoszeniach):

| Wejście | Tokeny wejścia | Tokeny wyjścia (w tym rozumowanie) | Opus 5 | Sonnet 5 |
|---|---|---|---|---|
| Zrzut ekranu (do ~4800 tokenów obrazu) + prompt i schemat (~2 tys.) | ~3–7 tys. | ~1,5–3 tys. | ~0,05–0,11 USD | ~0,02–0,04 USD |
| Link (tekst strony do 40 000 znaków ≈ 10 tys. tokenów) | ~4–12 tys. | ~1,5–3 tys. | ~0,06–0,14 USD | ~0,02–0,05 USD |

Limity w kodzie:

| Limit | Wartość | Gdzie |
|---|---|---|
| Wywołania na firmę | 10 / godz., 30 / dobę (klucz tylko po firmie, bez IP) | `src/lib/actions/job-import.ts` |
| Awaria limitera | fail-closed (blokada), bo każde wywołanie kosztuje | `src/lib/rate-limit.ts` |
| Rozmiar obrazu | 5 MB, PNG/JPG/WebP po sygnaturze (magic bytes) | `src/lib/ai-import/image.ts` |
| Pobranie linku | 8 s łącznie, 2 MB HTML (po dekompresji), 5 MB obraz, 3 przekierowania | `src/lib/ai-import/safe-fetch.ts` |
| Tekst strony do modelu | 40 000 znaków | jw. |
| Wywołanie API | timeout 60 s, 1 ponowienie, `max_tokens` 8000 | `src/lib/ai-import/extract.ts` |

Górna granica przy pełnym wykorzystaniu limitu: ~30 × 0,14 USD ≈ 4 USD dziennie na firmę (Opus 5).
Globalny budżet miesięczny i raport kosztów (`usage`) → #36.

Limiter używa istniejącego `rate_limit_hit` (0015) — nowa migracja nie była potrzebna
(zarezerwowany numer 0090 pozostaje wolny).

## Bezpieczeństwo

**Autoryzacja.** Sesja + aktywna firma + rola recruiter+ (owner/admin/recruiter — jak
`can_manage_jobs`). Zapis przez `createJobDraft` i `save_job_draft` pod sesją (RLS, baza ponownie
sprawdza recruiter+ i status szkicu). Bez bazy (tryb demo) płatny dostawca jest niedostępny —
anonimowy ruch nie może generować kosztów.

**Pobieranie linku (SSRF).** Tylko `http`/`https`, bez danych logowania, porty 80/443, odrzucone
nazwy lokalne (`localhost`, `.internal`, `.local`, jednoczłonowe). Host rozwiązywany przed
połączeniem; jeśli którykolwiek adres jest prywatny, pętlą zwrotną, link-local (metadane chmury
169.254.169.254, fd00:ec2::254), CGNAT, multicast, zarezerwowany lub IPv4 osadzony w IPv6 —
odmowa. Połączenie przypięte do sprawdzonego adresu (odporność na DNS rebinding). Każde
przekierowanie sprawdzane od nowa. Limit czasu i rozmiaru, także po dekompresji. Brak
przeglądarki i wykonywania skryptów — HTML zamieniany na tekst bez `<script>`/`<style>`/komentarzy
(zachowujemy JSON-LD `JobPosting` jako dane).

**Prompt injection.** Zrzut i strona to niezaufane dane. Instrukcje są wyłącznie w `system`;
materiał w wiadomości użytkownika w znaczniku `<listing>` (próby jego zamknięcia są
neutralizowane). Model nie ma narzędzi, a odpowiedź jest ograniczona schematem; serwer odrzuca
klucze spoza schematu i waliduje wartości schematami kreatora. Model zgłasza tekst skierowany
do AI (`suspiciousInstructions`) — wtedy wszystkie wypełnione pola są oznaczone, UI pokazuje
ostrzeżenie, a **nic nie jest zapisywane do bazy** do czasu przejrzenia przez człowieka.
Znaki sterujące i niewidoczne znaki kierunku tekstu są usuwane. Publikacja zawsze wymaga
kliknięcia „Opublikuj" i zgody w kroku 9.

**Klucz API** tylko po stronie serwera (`ANTHROPIC_API_KEY`, nigdy `NEXT_PUBLIC_*`); moduły
`server-only`.

## Prywatność

- Plik i treść strony istnieją wyłącznie w pamięci na czas żądania — nie trafiają do Storage,
  bazy ani logów. W szkicu zapisywane są tylko pola wyciągnięte z ogłoszenia (widoczne dla
  pracodawcy i edytowalne).
- Dane trafiają do Anthropic jako podmiotu przetwarzającego. Według warunków komercyjnych
  API dane nie są domyślnie używane do trenowania modeli; okres retencji po stronie dostawcy
  określa aktualna polityka Anthropic (Zero Data Retention wymaga osobnej umowy). **Przed
  włączeniem w produkcji:** potwierdzić umowę powierzenia (DPA), region przetwarzania i retencję.
- Ogłoszenie może zawierać dane osoby kontaktowej. Import zapisuje e-mail kontaktowy tylko,
  gdy jest w ogłoszeniu i przechodzi walidację — pracodawca widzi go w kroku 9.
- UI informuje, że import dotyczy ogłoszeń, do których pracodawca ma prawa, i że plik nie jest
  przechowywany. Treści prawnych (regulamin, polityka) ta zmiana nie dodaje.

## Ryzyka i ograniczenia

| Ryzyko | Ograniczenie |
|---|---|
| Model „dopowie" dane (np. wynagrodzenie) | prompt zakazuje zgadywania; pola niepewne oznaczone; walidacja kroków; brak auto-publikacji |
| Strony renderowane JavaScriptem / blokujące boty | bez przeglądarki treść bywa pusta → komunikat „nie znaleźliśmy ogłoszenia"; zrzut ekranu jako alternatywa |
| ToS portali źródłowych | jedno pobranie na wyraźne żądanie pracodawcy, bez crawlingu; informacja w UI o prawach do ogłoszenia; decyzja właściciela |
| Koszty / nadużycia | recruiter+, limity per firma fail-closed, limit rozmiaru, brak dostępu w trybie demo |
| Niedostępność dostawcy | timeout 60 s, czytelny błąd; kreator działa ręcznie bez zmian |
| Stawki ułamkowe | kolumna całkowita — zaokrąglenie z oznaczeniem do sprawdzenia |

## Włączenie (Railway)

Zmiennych nie ustawia ta zmiana. Aby włączyć:

1. `ANTHROPIC_API_KEY` — klucz organizacji Anthropic (tylko serwer).
2. `AI_JOB_IMPORT_ENABLED=1` — flaga funkcji. Bez niej albo bez klucza krok importu jest
   niewidoczny, a kreator działa jak dotąd.
3. Opcjonalnie `AI_JOB_IMPORT_MODEL` (domyślnie `claude-opus-5`).
4. Limiter wymaga działającego `rate_limit_hit` (klucz service-role jak dla pozostałych limitów);
   przy jego awarii import zwraca „zbyt wiele prób" (fail-closed).

`AI_JOB_IMPORT_PROVIDER=fixture` to atrapa dla E2E/lokalnie — ignorowana przy
`APP_MODE=production`. Wyłączenie: usunąć `AI_JOB_IMPORT_ENABLED` (bez wdrożenia kodu).

## Testy

- Unit: `ai-import-image`, `ai-import-safe-fetch` (adresy wewnętrzne, przekierowania, DNS,
  limity, bomba gzip, timeout; lokalny serwer testowy, DNS-atrapa), `ai-import-map` (schematy
  kroków, oznaczenia, injection, zgodność kluczy z 0083), `ai-import-extract` (atrapa klienta
  SDK — kształt żądania, odmowa, schemat structured output), `job-import-action` (flaga, klucz,
  recruiter+, limit per firma, zły plik, adres wewnętrzny, injection, brak `publish_job`),
  `job-import-panel` (UI).
- E2E: `tests/e2e/job-import.spec.ts` z atrapą dostawcy — import ze zrzutu (pl/en), podrobiony
  typ pliku, metadane chmury/loopback, polecenie dla AI ukryte w obrazie, axe 320/1280 px.
- Żaden test ani CI nie wykonuje prawdziwego wywołania API.
