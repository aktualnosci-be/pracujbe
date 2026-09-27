# Import ogłoszenia przez AI (#465) — research i opis wdrożenia

Stan: 24.09.2026 (dostawca zmieniony 26.09.2026 na OpenAI — decyzja właściciela). Funkcja jest za flagą, **domyślnie wyłączona** (także w produkcji). Włącza ją
właściciel po akceptacji kosztów, dostawcy i warunków przetwarzania danych (patrz „Włączenie").

Pracodawca w kreatorze nowej oferty może wgrać zrzut ekranu istniejącego ogłoszenia albo wkleić
link. Serwer odczytuje ogłoszenie modelem OpenAI (GPT-6 Luna) i wstępnie wypełnia kroki kreatora. Pola niepewne
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
| 9 | opis firmy | **zgoda na publikację nigdy nie jest ustawiana przez import**; e-mail kontaktowy wpisuje pracodawca ręcznie (#500) |

Każdy krok przechodzi przez **te same schematy Zod** co ręczne wypełnianie (`step1Schema` …
`step9DraftSchema`). Pole odrzucone przez schemat jest czyszczone i oznaczane; reszta kroku
zostaje w formularzu. Do szkicu w bazie trafiają tylko kroki poprawne w całości — jednym
wywołaniem atomowego RPC `save_job_draft` (#192, 0083; semantyka patch). Treść zostaje w języku
ogłoszenia; tłumaczenie to osobny temat (#29–#35).

## Wybór modelu i API

- **Dostawca:** OpenAI Responses API, oficjalny SDK `openai` (decyzja właściciela 26.09.2026 —
  wyłącznie model „GPT-6 Luna”; SDK Anthropic usunięte). Jedno miejsce wywołania:
  `src/lib/ai/openai.ts` (wspólne dla importu ogłoszeń, asystenta treści i importu CV).
- **Model domyślny:** `gpt-6-luna` (potwierdzony na
  https://developers.openai.com/api/docs/models/gpt-6-luna: vision, structured outputs,
  Responses API, kontekst 1 050 000, wyjście do 128 000 tokenów). Nadpisywalny
  `AI_JOB_IMPORT_MODEL`, a globalnie `AI_MODEL` (walidacja formatu identyfikatora).
- **Structured output:** `text.format = { type: 'json_schema', name, schema, strict: true }` ze
  schematem `JOB_EXTRACTION_JSON_SCHEMA`. Tryb strict wymaga: wszystkie pola w `required`,
  `additionalProperties: false` (test `ai-openai-client`). Bez typów unijnych (brak danych =
  `""` / `"unknown"` / `[]`). Limity długości/liczby egzekwuje Zod po stronie serwera.
- **Obraz:** `input_image` jako data URL (base64), `detail: 'high'`.
- **Effort `low`** (`reasoning.effort`): ekstrakcja z jednego dokumentu nie wymaga długiego
  rozumowania; obniża koszt i czas. Bez narzędzi (tools) — model nie może niczego wykonać.
  `store: false` — odpowiedź nie jest przechowywana do późniejszego pobrania przez API.
- **Odmowa modelu** (element `refusal` w odpowiedzi albo `incomplete_details.reason =
  content_filter`), ucięcie (`status: incomplete`, np. `max_output_tokens`) lub zły JSON →
  komunikat „Nie udało się odczytać ogłoszenia" (bez szczegółów dostawcy, Invariant #8).

## Koszty i limity

Cennik OpenAI (https://developers.openai.com/api/docs/pricing, tier Standard, stan 26.09.2026),
`gpt-6-luna` za 1 mln tokenów: wejście 0,10 USD, wejście z cache 0,01 USD, zapis do cache
0,125 USD, wyjście 0,50 USD (tokeny rozumowania liczone jako wyjście). Długi kontekst:
0,20 / 0,02 / 0,25 / 0,75 USD — **próg nie jest podany na stronie cennika**; w kodzie przyjęto
272 000 tokenów wejścia (źródła wtórne, TODO do potwierdzenia) — nasze wejścia są daleko
poniżej. Tabela: `src/lib/ai/pricing.ts`.

Szacunek na jedno wywołanie (do potwierdzenia pomiarem `usage` na realnych ogłoszeniach):

| Wejście | Tokeny wejścia | Tokeny wyjścia (w tym rozumowanie) | GPT-6 Luna |
|---|---|---|---|
| Zrzut ekranu (do ~3 tys. tokenów obrazu wg przewodnika vision dla GPT-6) + prompt i schemat (~2 tys.) | ~3–7 tys. | ~1,5–3 tys. | ~0,001–0,003 USD |
| Link (tekst strony do 40 000 znaków ≈ 10 tys. tokenów) | ~4–12 tys. | ~1,5–3 tys. | ~0,001–0,003 USD |

Limity w kodzie:

| Limit | Wartość | Gdzie |
|---|---|---|
| Wywołania na firmę | 10 / godz., 30 / dobę (klucz tylko po firmie, bez IP) | `src/lib/actions/job-import.ts` |
| Awaria limitera | fail-closed (blokada), bo każde wywołanie kosztuje | `src/lib/rate-limit.ts` |
| Rozmiar obrazu | 5 MB, PNG/JPG/WebP po sygnaturze (magic bytes) | `src/lib/ai-import/image.ts` |
| Pobranie linku | 8 s łącznie, 2 MB HTML (po dekompresji), 5 MB obraz, 3 przekierowania | `src/lib/ai-import/safe-fetch.ts` |
| Tekst strony do modelu | 40 000 znaków | jw. |
| Wywołanie API | timeout 60 s, 1 ponowienie, `max_output_tokens` 8000 | `src/lib/ai/openai.ts`, `src/lib/ai-import/extract.ts` |

Górna granica przy pełnym wykorzystaniu limitu: ~30 × 0,003 USD ≈ 0,1 USD dziennie na firmę (GPT-6 Luna).
Globalny budżet (#36, `docs/AI_BUDGET.md`): każde wywołanie rezerwuje górną granicę kosztu
(GPT-6 Luna: ~0,005–0,008 USD) przed API i rozlicza się tokenami z `usage`; limit startowy 10 USD/dobę
i 100 USD/miesiąc dla wszystkich funkcji AI. Po przekroczeniu import zwraca
`AI_BUDGET_EXCEEDED` bez wywołania modelu. Raport: `/admin/koszty-ai`.

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

**Prompt injection.** Zrzut i strona to niezaufane dane. Instrukcje są wyłącznie w `instructions`;
materiał w wiadomości użytkownika w znaczniku `<listing>` (próby jego zamknięcia są
neutralizowane). Model nie ma narzędzi, a odpowiedź jest ograniczona schematem; serwer odrzuca
klucze spoza schematu i waliduje wartości schematami kreatora. Model zgłasza tekst skierowany
do AI (`suspiciousInstructions`) — wtedy wszystkie wypełnione pola są oznaczone, UI pokazuje
ostrzeżenie, a **nic nie jest zapisywane do bazy** do czasu przejrzenia przez człowieka.
Znaki sterujące i niewidoczne znaki kierunku tekstu są usuwane. Publikacja zawsze wymaga
kliknięcia „Opublikuj" i zgody w kroku 9.

**Klucz API** tylko po stronie serwera (`OPENAI_API_KEY`, nigdy `NEXT_PUBLIC_*`); moduły
`server-only`.

## Prywatność

- Plik i treść strony istnieją wyłącznie w pamięci na czas żądania — nie trafiają do Storage,
  bazy ani logów. W szkicu zapisywane są tylko pola wyciągnięte z ogłoszenia (widoczne dla
  pracodawcy i edytowalne).
- Dane trafiają do OpenAI jako podmiotu przetwarzającego (wpis `openai` w
  `src/lib/privacy/processors.ts`: rola, region, transfer, DPA i retencja — „DO UZUPEŁNIENIA”).
  Kod wysyła `store: false`; okres przechowywania po stronie dostawcy (np. do monitorowania
  nadużyć), region przetwarzania i ewentualne Zero Data Retention określa umowa z OpenAI.
  **Przed włączeniem w produkcji:** potwierdzić DPA, region przetwarzania i retencję.
- Ogłoszenie może zawierać dane osoby kontaktowej. Od #500 import **nie** przenosi e-maila
  kontaktowego (pole usunięte ze schematu modelu) — pracodawca wpisuje go ręcznie w kroku 9.
- UI informuje, że import dotyczy ogłoszeń, do których pracodawca ma prawa, i że plik nie jest
  przechowywany. Treści prawnych (regulamin, polityka) ta zmiana nie dodaje.

## Minimalizacja danych osób trzecich i identyfikatorów (#500, #495)

Bramka techniczna działa niezależnie od instrukcji dla modelu (kod: `src/lib/ai-import/minimize.ts`,
`src/lib/privacy/sensitive-data.ts`, walidacja wyjścia w `map.ts`).

**Przed wysłaniem (link):**

| Co | Jak |
|---|---|
| Sekcja strony | gdy jest `<main>` (albo `<article>`) — tylko ona; `<nav>`, `<aside>`, `<footer>`, `<form>` usuwane |
| JSON-LD | tylko `JobPosting` i pola z listy dozwolonych (tytuł, opis, lokalizacja, wynagrodzenie, wymagania, benefity, nazwa firmy…); bez `url`, `identifier`, `applicationContact`, `contactPoint`, e-maili organizacji; inne typy (np. `Organization`) odrzucane |
| E-maile, telefony | zastępowane znacznikiem `[email removed]` / `[phone removed]` |
| NISS/BIS, PESEL, karta eID, numery dokumentów | wykrywane deterministycznie (suma kontrolna mod 97 / wagi PESEL; numer po słowie kluczowym, np. „paszport nr”, także z błędną sumą) → `[identifier removed]` |
| Adres źródła | do promptu trafia tylko nazwa hosta — bez ścieżki, parametrów (tokenów), fragmentu i danych logowania |

**Zrzut ekranu:** nie da się go zredagować lokalnie (brak OCR) — obraz trafia do dostawcy
w całości. Ograniczenia: reguła w prompcie (nie kopiować danych osób) i walidacja wyjścia.
Decyzja, czy import obrazu ma zostać przy włączeniu flagi, należy do właściciela (#488).

**Po odpowiedzi modelu (oba źródła):**

- tekst z e-mailem/telefonem nie trafia do formularza — pole tekstowe jest czyszczone, pozycja
  listy pomijana; pole oznaczone „do sprawdzenia”;
- numer NISS/BIS, PESEL lub dokumentu w dowolnym polu → import odrzucany w całości
  (`JOB_IMPORT_SENSITIVE_DATA`), nic nie trafia do formularza ani szkicu;
- licznik redakcji nie zawiera wartości; materiał ani wynik nie są logowane.

**Ograniczenia wykrywania:** imion i nazwisk nie wykrywamy deterministycznie (tylko reguła
w prompcie i przegląd przez pracodawcę). Numer zapisany słownie, rozbity nietypowo albo w
formacie innego kraju bez słowa kluczowego może nie zostać wykryty.

**Otwarte (właściciel/prawnik, poza kodem):** opis przepływu danych i ról, podstawa art. 6
i decyzja art. 14 dla osoby kontaktowej i danych przypadkowych, DPA/region/retencja dostawcy
(#488). Flaga pozostaje wyłączona do czasu tych decyzji.

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

1. `OPENAI_API_KEY` — klucz projektu OpenAI (tylko serwer).
2. `AI_JOB_IMPORT_ENABLED=1` — flaga funkcji. Bez niej albo bez klucza krok importu jest
   niewidoczny, a kreator działa jak dotąd.
3. Opcjonalnie `AI_JOB_IMPORT_MODEL` albo globalnie `AI_MODEL` (domyślnie `gpt-6-luna`).
4. Limiter wymaga działającego `rate_limit_hit` (klucz service-role jak dla pozostałych limitów);
   przy jego awarii import zwraca „zbyt wiele prób" (fail-closed).

`AI_JOB_IMPORT_PROVIDER=fixture` to atrapa dla E2E/lokalnie — ignorowana przy
`APP_MODE=production`. Wyłączenie: usunąć `AI_JOB_IMPORT_ENABLED` (bez wdrożenia kodu).

## Testy

- Unit (#500/#495): `sensitive-data` (NISS/BIS/PESEL/eID z kontrolą ujemną, brak fałszywych
  trafień na kwotach/datach/telefonach), `ai-import-minimize` (HTML ze stopką z e-mailem i URL
  z tokenem → nic z tego w payloadzie dostawcy; zrzut z danymi osoby → redakcja wyniku albo
  odmowa).
- Unit: `ai-import-image`, `ai-import-safe-fetch` (adresy wewnętrzne, przekierowania, DNS,
  limity, bomba gzip, timeout; lokalny serwer testowy, DNS-atrapa), `ai-import-map` (schematy
  kroków, oznaczenia, injection, zgodność kluczy z 0083), `ai-import-extract` (atrapa klienta
  OpenAI `tests/helpers/fake-openai.ts` — kształt żądania, odmowa, 429, schemat strict),
  `ai-openai-client` (wspólny klient: store=false, brak logowania treści, zgodność schematów), `job-import-action` (flaga, klucz,
  recruiter+, limit per firma, zły plik, adres wewnętrzny, injection, brak `publish_job`),
  `job-import-panel` (UI).
- E2E: `tests/e2e/job-import.spec.ts` z atrapą dostawcy — import ze zrzutu (pl/en), podrobiony
  typ pliku, metadane chmury/loopback, polecenie dla AI ukryte w obrazie, axe 320/1280 px.
- Żaden test ani CI nie wykonuje prawdziwego wywołania API.
