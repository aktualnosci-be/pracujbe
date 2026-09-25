# Dostawcy i transfery danych — szkic roboczy

> **PROJEKT — do weryfikacji prawnika, nieopublikowany.**
> Wersja robocza 0.1 (2026-09-24), przygotowana do #488 (AI), #503 (Resend) i #504
> (Cloudflare Turnstile). Opisuje przepływy **wynikające z kodu repozytorium**. Umowy (DPA),
> osoby prawne dostawców, regiony, podprocesorzy, retencja po stronie dostawcy i podstawy
> transferu poza EOG nie wynikają z kodu — są **do ustalenia przez właściciela/prawnika**.
> Ustalenia z dokumentacji dostawców zebrane w komentarzach #488, #503 i #504 wymagają
> sprawdzenia na koncie portalu; ten szkic nie przepisuje ich jako faktów.
> Poufnych umów nie umieszczamy w publicznym repozytorium — tu tylko odnośnik, data i wynik oceny.

Dane źródłowe: `src/lib/privacy/processors.ts` (wszystkie usługi, pola prawne = „DO UZUPEŁNIENIA”)
i [`data-map.generated.md`](data-map.generated.md) sekcja 2 (usługi) i 4 (treść e-maili).

## 1. Zestawienie usług

| Usługa | Czynności | Kiedy aktywna (z kodu) | Rola | Region | Podstawa transferu | DPA (wersja, data) |
|---|---|---|---|---|---|---|
| Railway | wszystkie (hosting, baza, cron, logi) | produkcja | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Supabase | panele, Storage CV, limiter (przejściowo) | `NEXT_PUBLIC_SUPABASE_URL` + klucze | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Resend | e-maile transakcyjne i konta | `RESEND_API_KEY` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Sentry | raporty błędów | `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Cloudflare Turnstile | ochrona formularzy | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Anthropic | import ogłoszeń | `AI_JOB_IMPORT_ENABLED` + `ANTHROPIC_API_KEY` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Google Analytics | analityka po zgodzie | ID pomiaru + zgoda `analytics` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| Meta Pixel | marketing po zgodzie | ID piksela + zgoda `marketing` | do ustalenia | do ustalenia | do ustalenia | do ustalenia |
| VIES (Komisja Europejska) | sprawdzenie VAT firmy | akcja administratora | do ustalenia | do ustalenia | do ustalenia | nie dotyczy / do ustalenia |
| Stripe | płatności — wyłączone | tylko `BILLING_ENABLED=true` | nie dotyczy do czasu włączenia | — | — | — |

Stan konfiguracji produkcji (które klucze są ustawione) nie wynika z repozytorium — **do
potwierdzenia przez właściciela** w panelu Railway, bez publikowania wartości.

## 2. Dostawcy AI (#488)

### 2.1 Anthropic — import ogłoszenia o pracę

**Z kodu** (`src/lib/ai-import/extract.ts`, `config.ts`, `run-import.ts`, `docs/AI_JOB_IMPORT.md`):

- Funkcja dla pracodawcy (owner/admin/recruiter aktywnej firmy), za flagą `AI_JOB_IMPORT_ENABLED`,
  domyślnie wyłączona także w produkcji. Bez klucza funkcja jest niedostępna; atrapa
  `AI_JOB_IMPORT_PROVIDER=fixture` nie działa w trybie produkcyjnym.
- Do API wysyłane jest **jedno** z dwóch, plus instrukcja systemowa i schemat odpowiedzi:
  - tekst strony pobranej z linku podanego przez pracodawcę — **po minimalizacji**
    (`src/lib/ai-import/minimize.ts`): z JSON-LD zostają tylko dozwolone pola `JobPosting`,
    e-maile, telefony, NISS/BIS, PESEL i numery dokumentów są usuwane, a zamiast adresu URL
    trafia sama nazwa hosta;
  - obraz zrzutu ekranu (PNG/JPG/WebP ≤ 5 MB, base64) — **bez lokalnej redakcji** (brak OCR);
    może zawierać dane osób z ogłoszenia. Numer identyfikacyjny w odpowiedzi modelu powoduje
    odmowę importu (`JOB_IMPORT_SENSITIVE_DATA`).
- Kod **nie wysyła** danych kandydatów, profili, CV ani wiadomości.
- Model: stała `DEFAULT_JOB_IMPORT_MODEL` albo `AI_JOB_IMPORT_MODEL`. Kod nie ustawia parametru
  regionu przetwarzania (`inference_geo`) ani innych ustawień geograficznych.
- Portal nie zapisuje obrazu ani pobranej strony — tylko wynik po walidacji w szkicu oferty
  (`save_job_draft`). Limity: 10 importów na godzinę i 30 na dobę na firmę.

**Do ustalenia przez właściciela/prawnika:**

| Pytanie | Odpowiedź | Dowód / data sprawdzenia |
|---|---|---|
| Osoba prawna dostawcy będąca stroną umowy | do ustalenia | |
| Wersja DPA obowiązująca konto i sposób jego zawarcia | do ustalenia | |
| Region przechowywania i przetwarzania dla używanego modelu i workspace | do ustalenia | |
| Retencja wejścia/wyjścia po stronie dostawcy; status ZDR organizacji | do ustalenia | |
| Lista podprocesorów i tryb zmian | do ustalenia | |
| Mechanizm transferu (art. 45 lub 46 RODO) i ocena warunków transferu | do ustalenia | |
| Czy dane z importu służą do trenowania modeli (ustawienia konta) | do ustalenia | |
| Podstawa z art. 6 dla przetwarzania danych osób z ogłoszeń | do ustalenia | |
| Osoba odpowiedzialna za ponowny przegląd przy zmianie modelu/regionu/dostawcy | do ustalenia | |

### 2.2 Planowane użycia AI na danych kandydata

W kodzie **nie ma** dziś przepływu wysyłającego do AI profil, CV ani wiadomości kandydata,
ani tłumaczeń przez AI (`docs/AI_MULTILINGUAL_PLAN.md` to plan). Każde takie użycie wymaga
osobnego wpisu w rejestrze, oceny dostawcy i decyzji transferowej przed wdrożeniem (#487, #488).
Akceptacja dostawcy dla importu ogłoszeń nie przenosi się automatycznie na dane kandydata.

Zmiana techniczna do rozważenia w osobnym issue (nie w tym szkicu): wyłącznik fail-closed dla
funkcji wysyłających dane kandydata do dostawcy bez zatwierdzonego wpisu (#488).

## 3. Resend — poczta (#503)

**Z kodu** (`src/lib/email/outbox.ts`, `src/app/api/email/webhook/resend/route.ts`,
`src/app/api/auth/email-hook/route.ts`, `src/emails/wiring.ts`):

- Worker czyta kolejkę `email_deliveries`, renderuje szablon React Email w języku odbiorcy
  i wywołuje `resend.emails.send` z polami: nadawca, adres odbiorcy, temat, treść HTML oraz —
  gdzie dotyczy — nagłówki `List-Unsubscribe`/`List-Unsubscribe-Post`. Klucz idempotencji =
  identyfikator wiersza kolejki. Bez `RESEND_API_KEY` worker niczego nie wysyła.
- Treść e-maila buduje się z payloadu kolejki. **Pola payloadu każdego szablonu** są generowane
  z aktualnych funkcji SQL w sekcji 4 mapy danych, np. `newApplication` → `candidateName`,
  `jobTitle`; `newMessage` → `senderName`, `panel` (bez treści wiadomości). Test
  `tests/unit/privacy-data-map.test.ts` blokuje payloady zawierające CV, odpowiedzi
  screeningowe, treść wiadomości lub telefon (z kontrolą ujemną).
- Do szablonu worker przekazuje tylko pola z listy `src/lib/email/payload-fields.ts` (#503);
  resztę payloadu odrzuca przed renderem. Szczegóły i ocena: [`poczta-transfer-resend.md`](poczta-transfer-resend.md).
- Worker dokłada imię odbiorcy z `profiles`, link do panelu i stopkę wypisania. E-maile konta
  (potwierdzenie, reset hasła, magic link, zmiana e-maila, zaproszenie) zawierają link z tokenem.
- `reportReceived` zawiera numer sprawy i kod dostępu do statusu zgłoszenia.
- Kod nie ustawia opcji śledzenia otwarć ani kliknięć; ich stan na koncie dostawcy nie wynika
  z repozytorium.
- Webhook dostawcy przekazuje do portalu zdarzenia doręczenia (odbicie, skarga, opóźnienie),
  zapisywane w `email_deliveries` i `email_suppressions`.
- Przy wysyłce worker ponownie sprawdza zgodę odbiorcy, blokadę adresu i — dla e-maili
  z danymi kandydata do firmy — aktualne uprawnienie odbiorcy w firmie (#503, `0123`).
- Kod nie usuwa wierszy `email_deliveries` (retencja odłożona).

**Do ustalenia przez właściciela/prawnika:**

| Pytanie | Odpowiedź | Dowód / data sprawdzenia |
|---|---|---|
| Czy produkcja wysyła przez Resend (klucz ustawiony), inny tor albo poczta wyłączona | do ustalenia | |
| Osoba prawna dostawcy, DPA konta, lista podprocesorów | do ustalenia | |
| Lokalizacja przechowywania treści, logów i webhooków; region wysyłki | do ustalenia | |
| Mechanizm transferu (art. 45/46) i ocena | do ustalenia | |
| Retencja treści i logów u dostawcy; po zamknięciu konta | do ustalenia | |
| Ustawienia śledzenia otwarć/kliknięć na koncie (oczekiwane: wyłączone) | do ustalenia | |
| Czy pełne imię i nazwisko kandydata w e-mailu do firmy jest niezbędne, czy wystarczy neutralny komunikat z linkiem | do ustalenia (decyzja produktowa + prawnik) | |
| Retencja `email_deliveries` i procedura przy żądaniu usunięcia (wiadomości już doręczonych nie da się cofnąć) | do ustalenia | |

## 4. Cloudflare Turnstile — ochrona formularzy (#504)

**Z kodu** (`src/lib/turnstile/verify.ts`, `policy.ts`, `src/components/auth/TurnstileWidget.tsx`,
`docs/TURNSTILE.md`):

- Formularze: logowanie, rejestracja, reset hasła, zgłoszenie treści, aplikowanie bez konta.
  Aktywne, gdy ustawiono oba klucze; bez kluczy poza produkcją wyłączone. Polityka awarii:
  logowanie fail-open, pozostałe fail-closed (`policy.ts`).
- Przeglądarka ładuje skrypt widżetu z `challenges.cloudflare.com` (dozwolone w CSP). Jakie
  sygnały przeglądarki zbiera skrypt dostawcy — **nie wynika z kodu portalu**.
- Serwer wysyła do Siteverify: sekret, token odpowiedzi i losowy `idempotency_key`. **Nie wysyła**
  parametru `remoteip` ani treści pól formularza. Sprawdza akcję i hostname tokenu.
- Widżet nie zależy od zgód cookies; komentarz w `policy.ts` nazywa go ochroną niezbędną.
  To założenie techniczne, nie ocena prawna — ta jest do ustalenia (tabela niżej).
- Tryb widżetu (managed/non-interactive/invisible), pre-clearance (cookie `cf_clearance`)
  i analityka to ustawienia panelu Cloudflare — nie kodu.

**Do ustalenia przez właściciela/prawnika:**

| Pytanie | Odpowiedź | Dowód / data sprawdzenia |
|---|---|---|
| Czy Turnstile jest aktywny w produkcji; tryb widżetu; pre-clearance | do ustalenia | protokół z panelu |
| Test sieciowy: brak treści pól i CV w żądaniach do Cloudflare | do wykonania | |
| Rola Cloudflare dla ochrony portalu i dla ewentualnych celów własnych dostawcy | do ustalenia | |
| DPA, podprocesorzy, region, transfer, retencja sygnałów | do ustalenia | |
| Podstawa z art. 6 RODO i ocena art. 5 ust. 3 ePrivacy dla faktycznych sygnałów i ewentualnego `cf_clearance` | do ustalenia | |
| Ścieżka dla użytkownika, któremu skrypt jest blokowany (dostępność, formularze fail-closed) | do ustalenia | |
| Czy przy trybie invisible wymagany jest odnośnik do dokumentu prywatności dostawcy | do ustalenia | |

## 5. Pozostałe usługi — skrót z kodu

- **Railway:** hosting i baza; adapter bucketa S3 istnieje, ale CV obsługuje dziś Supabase Storage.
  Miejsce przechowywania kopii zapasowych (`BACKUP_DIR`) nie wynika z repozytorium.
- **Supabase:** warstwa przejściowa; ścieżka limitera zapisuje klucz z adresem IP bez
  haszowania (ścieżka PostgreSQL zapisuje HMAC).
- **Sentry:** zdarzenie budowane od zera z kodu błędu, identyfikatora i czasu (`redactSentryEvent`);
  `sendDefaultPii: false`, replay i tracing wyłączone.
- **Google Analytics / Meta Pixel:** ładowane dopiero po zgodzie; wycofanie usuwa cookies.
- **VIES:** numer VAT firmy wysyłany do usługi Komisji Europejskiej na żądanie administratora.

## 6. Procedura przeglądu (propozycja do zatwierdzenia)

1. Właściciel uzupełnia tabele „do ustalenia” z datą i odnośnikiem do dokumentu poza repozytorium.
2. Prawnik zatwierdza rolę, podstawę i mechanizm transferu dla każdej usługi.
3. Pola `role`, `region`, `transferBasis`, `contract`, `providerRetention` w
   `src/lib/privacy/processors.ts` zmienia się dopiero po zatwierdzeniu — test pilnuje dziś
   wartości „DO UZUPEŁNIENIA”, więc jego zmiana jest świadomą decyzją w PR.
4. Ponowny przegląd: nowy dostawca, nowy model/endpoint/region, nowa kategoria danych, zmiana
   podprocesorów dostawcy — do ustalenia, kto i jak często.
