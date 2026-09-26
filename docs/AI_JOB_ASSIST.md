# Asystent redagowania oferty (#37, część pracodawcy)

Stan: 25.09.2026 (dostawca zmieniony 26.09.2026 na OpenAI — decyzja właściciela). Funkcja jest za flagą, **domyślnie wyłączona** (także w produkcji). Wzór
konfiguracji, limitów i bezpieczeństwa: import ogłoszenia (#465, `docs/AI_JOB_IMPORT.md`).
Część dla kandydata (profil z odpowiedzi) opisuje `docs/AI_PROFILE_ASSIST.md`.

Rekruter na kroku 5 (opis, obowiązki) i 6 (wymagania obowiązkowe) kreatora oferty klika
„Zaproponuj poprawki”. Serwer prosi model OpenAI (GPT-6 Luna) o lepsze brzmienie tych pól **w języku oferty**
(`jobs.default_locale`; nowa oferta = język panelu). Wynik to propozycja pole po polu:

- obok propozycji zawsze widać tekst rekrutera („Twój tekst” / „Propozycja AI”);
- pole w formularzu zmienia się **wyłącznie** po kliknięciu „Użyj propozycji”; „Zostaw mój
  tekst” niczego nie zmienia; po akceptacji „Przywróć mój tekst” wraca do wersji rekrutera;
- gdy rekruter zmieni pole po otrzymaniu propozycji, przycisk jest nieaktywny (propozycja
  dotyczy starego tekstu);
- akcja **niczego nie zapisuje** — zapis robi kreator („Dalej” / „Zapisz zmiany”), publikację
  wyłącznie „Opublikuj” (`publish_job`). Strażnik: `tests/unit/ai-inventory.test.ts`.

Informacja o korzystaniu z AI (#37, komentarz o art. 50 ust. 1 AI Act) jest widoczna w panelu
przed pierwszym użyciem, w języku interfejsu, i powiązana z przyciskiem (`aria-describedby`,
czytnik ekranu ją odczytuje — E2E). Kwalifikacja prawna: szkic `docs/legal-drafts/ai-act-art22-dpia.md`
(wiersz A3) — do oceny prawnika.

## Kod

| Plik | Rola |
|---|---|
| `src/lib/ai-assist/config.ts` | flaga, dostawca (atrapa tylko poza produkcją), model |
| `src/lib/ai-assist/schema.ts` | ścisły schemat wejścia (Zod `strict`), schemat structured output |
| `src/lib/ai-assist/assist.ts` | prompt, wywołanie przez wspólnego klienta `src/lib/ai/openai.ts`, atrapa |
| `src/lib/ai-assist/guard.ts` | bramki deterministyczne przed i po modelu |
| `src/lib/ai-assist/run-assist.ts` | rdzeń bez autoryzacji; log użycia |
| `src/lib/ai-assist/budget.ts` | punkt wpięcia budżetu #36 |
| `src/lib/actions/job-assist.ts` | akcja serwerowa `suggestJobText` |
| `src/components/employer/JobAssistPanel.tsx` | panel w kreatorze |

## Model i API

- OpenAI Responses API przez wspólnego klienta `src/lib/ai/openai.ts` (SDK `openai`, ta sama
  zależność co import ogłoszeń i CV).
- Model domyślny: `gpt-6-luna` (decyzja właściciela 26.09.2026), nadpisywalny
  `AI_JOB_ASSIST_MODEL`, a globalnie `AI_MODEL`.
- Structured output (`text.format = json_schema`, `strict: true`), wszystkie pola wymagane,
  `additionalProperties: false`, bez typów unijnych. `reasoning.effort` `low`,
  `max_output_tokens` 6000 (obejmuje tokeny rozumowania), `store: false`, timeout 60 s,
  1 ponowienie. Bez narzędzi.
- Odmowa modelu, ucięcie odpowiedzi, zły JSON → „Nie udało się przygotować propozycji” (Invariant #8).

## Limity i koszty

| Limit | Wartość | Gdzie |
|---|---|---|
| Wywołania na firmę | 20 / godz., 60 / dobę (klucz tylko po firmie, bez IP) | `src/lib/actions/job-assist.ts` |
| Awaria limitera | fail-closed (`job-assist`, `job-assist-day` w `FAIL_SAFE_ACTIONS`) | `src/lib/rate-limit.ts` |
| Wejście | opis ≤ 5000 znaków, ≤ 20 pozycji na listę (limity kreatora) | `schema.ts` |
| Budżet globalny | hook `reserve` przed / `settle` po wywołaniu (tokeny) | `budget.ts`, #36 |

Szacunek na wywołanie (do potwierdzenia pomiarem `usage`): wejście ~1,5–4 tys. tokenów
(prompt + tekst oferty), wyjście ~0,5–2 tys. Przy cenach GPT-6 Luna (0,10 / 0,50 USD za 1 mln
tokenów wejścia / wyjścia, `src/lib/ai/pricing.ts`) to ~0,0005–0,0014 USD; górna granica przy
pełnym limicie 60 wywołań / dobę ≈ 0,1 USD na firmę.

**Budżet (#36).** Bramka `budget.ts` rezerwuje w globalnym budżecie AI (`ai_budget_reserve`,
migracja 0120, `docs/AI_BUDGET.md`) górną granicę kosztu (`src/lib/ai-assist/cost.ts`: prompt +
schemat + treść pól + pełne `max_output_tokens`) PRZED wywołaniem modelu. Odmowa albo brak bazy zadań
= kod `AI_BUDGET_EXCEEDED` bez wywołania. Bilet rozlicza tę rezerwację samymi liczbami tokenów;
błąd wywołania = rozliczenie pełną rezerwacją. Identyfikator firmy nie trafia do rejestru kosztów.

## Bezpieczeństwo

**Autoryzacja.** Sesja + aktywna firma + rola recruiter+ (owner/admin/recruiter, jak
`can_manage_jobs`). Bez bazy (demo) tylko atrapa — anonimowy ruch nie generuje kosztów.

**Brak danych kandydatów.** Wejście to wyłącznie tytuł i trzy pola treści oferty; schemat
`strict` odrzuca każdy inny klucz (test z kontrolą ujemną). Kod nie czyta aplikacji, profili ani
dopasowań (strażnik inwentarza).

**Prompt injection.** Tekst oferty to niezaufane dane (mógł zostać wklejony z innego źródła).
Dwie bramki: (1) deterministyczne wzorce poleceń dla AI w PL/NL/FR/EN i próby otwarcia
znaczników — żądanie nie trafia do modelu; (2) model zgłasza `suspiciousInstructions`. W obu
przypadkach brak propozycji i komunikat. Instrukcje wyłącznie w `instructions`, tekst w `<offer_text>`
(próby zamknięcia neutralizowane), klucze spoza schematu odrzucane.

**Bez nowych faktów.** Serwer porównuje propozycję z tekstem rekrutera: nowa liczba (kwota,
godziny, lata, procent — porównanie cyfr bez separatorów) albo nowy adres WWW = propozycja dla
pola nie jest pokazywana (komunikat z powodem). Tak samo dane kontaktowe, numer identyfikacyjny
albo znacznik redakcji w propozycji i propozycja łamiąca limity kreatora. Ograniczenie: faktów
słownych (np. nowego benefitu bez liczby) nie wykrywamy deterministycznie — reguła w prompcie
i przegląd rekrutera (propozycja obok oryginału).

**Klucz API** tylko na serwerze (`OPENAI_API_KEY`); moduły `server-only`.

## Prywatność

- Tekst istnieje w pamięci na czas żądania — nie trafia do bazy ani logów. Log użycia
  (`src/lib/ai/usage-log.ts`) ma tylko funkcję, wynik, rodzaj wejścia, model, czas.
- Przed wysłaniem usuwamy e-maile, telefony i numery identyfikacyjne (`redactSensitiveData`).
- Dane trafiają do OpenAI jako podmiotu przetwarzającego (`src/lib/privacy/processors.ts`,
  wpis `openai` — „DO UZUPEŁNIENIA”); kod wysyła `store: false`. Przed włączeniem w produkcji
  potwierdzić DPA, region i retencję (jak #465).

## Włączenie (właściciel)

1. Decyzja o koszcie i dostawcy (#36), DPA.
2. `AI_JOB_ASSIST_ENABLED=1` (+ istniejący `OPENAI_API_KEY`) w Railway.
3. Ocena prawna informacji o AI (art. 50 AI Act) — szkic A3.

## Testy

- `tests/unit/job-assist-guard.test.ts` — bramki (kontrole ujemne: nowy fakt, dane kontaktowe,
  limity, polecenia dla AI, klucze spoza schematu).
- `tests/unit/job-assist-action.test.ts` — flaga, atrapa nie w produkcji, recruiter+, limit
  per firma, budżet, brak zapisu, log bez treści.
- `tests/unit/ai-inventory.test.ts` — wpis w inwentarzu, akcja nie zapisuje i nie publikuje.
- `tests/unit/ai-openai-client.test.ts` — kształt żądania `OpenAiJobAssistor` (instrukcje osobno,
  strict schemat, odmowa, zużycie z cache).
- `tests/e2e/job-assist.spec.ts` — atrapa: akceptacja/cofnięcie/odrzucenie pola, informacja
  o AI, kontrole ujemne, axe 320/1280 px.
