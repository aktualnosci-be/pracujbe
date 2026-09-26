# Asystent budowania profilu z odpowiedzi (#37, część kandydata)

Stan: 25.09.2026. Funkcja jest za flagą, **domyślnie wyłączona** (także w produkcji). Część
pracodawcy (redakcja oferty): `docs/AI_JOB_ASSIST.md`. Import CV (#487): `docs/AI_CV_IMPORT.md`.

Kandydat bez CV otwiera `/candidate/profil/asystent` (link „Uzupełnij z pomocą AI” na
`/candidate/profil`, tylko z flagą) i odpowiada własnymi słowami na cztery pytania: ostatnia
praca, umiejętności/maszyny, języki, uprawnienia. Serwer prosi Claude o **propozycje wpisów
profilu** (zawody, umiejętności, języki z poziomem, certyfikaty, lata doświadczenia). Każda
propozycja ma źródło — cytat z odpowiedzi — albo oznaczenie „Do sprawdzenia”.

- propozycje są **domyślnie niezaznaczone**; zapis wyłącznie zaznaczonych, dopisanie do profilu
  (istniejące dane się nie zmieniają) — to samo RPC co import CV (`apply_candidate_cv_proposals`,
  0115), wspólny rdzeń `src/lib/cv-import/apply.ts`;
- odpowiedzi i propozycje **nie są zapisywane** ani logowane;
- wynik nie trafia do firm i **nie wpływa na dopasowanie, status ani widoczność** kandydata
  (strażnik `tests/unit/ai-inventory.test.ts`); model nie ocenia osoby.

**Informacja o AI** (komentarz w #37, art. 50 ust. 1 AI Act): widoczna nad pytaniami przed
pierwszym użyciem, w języku interfejsu, powiązana z przyciskiem (`aria-describedby`) — test
komponentu w 4 językach i E2E (320 px, axe). Kwalifikacja prawna: szkic
`docs/legal-drafts/ai-act-art22-dpia.md`, wiersz A5 — do oceny prawnika.

## Kod

| Plik | Rola |
|---|---|
| `src/lib/profile-assist/config.ts` | flaga, dostawca (atrapa tylko poza produkcją), model |
| `src/lib/profile-assist/questions.ts` | pytania, limity, ścisły schemat wejścia |
| `src/lib/profile-assist/prepare.ts` | minimalizacja przed modelem (czysta, deterministyczna) |
| `src/lib/profile-assist/schema.ts` | structured output (pola jak import CV, `aboutWork` zamiast `isCv`) |
| `src/lib/profile-assist/extract.ts` | wywołanie Messages API (jedyne miejsce), prompt, atrapa |
| `src/lib/profile-assist/run.ts` | rdzeń bez autoryzacji; walidacja `mapCvExtraction` |
| `src/lib/profile-assist/cost.ts` | szacunek kosztu do rezerwacji budżetu |
| `src/lib/actions/profile-assist.ts` | akcje `proposeProfileFromAnswers`, `applyProfileAssistProposals` |
| `src/components/candidate/ProfileAssistPanel.tsx` | panel (pytania → propozycje → gotowe) |
| `src/components/candidate/ProposalChecklist.tsx` | lista propozycji wspólna z importem CV |

## Bezpieczeństwo i prywatność

- **Autoryzacja:** sesja + rola `candidate`; właściciela profilu nie przyjmujemy od klienta. Bez
  bazy (demo) tylko atrapa — anonimowy ruch nie generuje kosztów.
- **Wejście:** schemat `strict` (tylko 4 pytania, ≤ 1000 znaków każde); klucz spoza schematu =
  `VALIDATION_FAILED` bez limitera, budżetu i modelu.
- **Minimalizacja** (`prepare.ts`, ta sama co tekst CV — `minimizeCvText`): numer NISS/BIS/dokumentu
  → odmowa; linie o osobach trzecich (przełożony, referencja, osoba kontaktowa), dane osobowe
  i kategorie szczególne (art. 9/10) usunięte; e-maile, telefony i linki → znaczniki; kilka
  adresów e-mail albo kontakt w długiej odpowiedzi → bezpieczne zatrzymanie. Kandydat widzi
  liczbę usuniętych fragmentów.
- **Prompt injection:** wzorce poleceń dla AI w PL/NL/FR/EN (wspólne z asystentem ofert,
  `textHasInjection`) → odmowa przed modelem; model zgłasza `suspiciousInstructions` → brak
  propozycji. Odpowiedzi w znacznikach `<answer>` (próby ich otwarcia neutralizowane),
  instrukcje tylko w `system`, model bez narzędzi.
- **Bez nowych faktów:** propozycja bez cytatu obecnego w wysłanym tekście jest oznaczana „Do
  sprawdzenia”; propozycja z kontaktem, linkiem, identyfikatorem, osobą trzecią albo kategorią
  szczególną jest odrzucana (`mapCvExtraction`, `isDisallowedProposalText`); zapis sprawdza to
  ponownie.

## Limity i koszty

| Limit | Wartość | Gdzie |
|---|---|---|
| Wywołania na konto | 10 / godz., 30 / dobę (bez IP) | `src/lib/actions/profile-assist.ts` |
| Awaria limitera | fail-closed (`profile-assist`, `profile-assist-day`) | `src/lib/rate-limit.ts` |
| Budżet globalny | rezerwacja przed wywołaniem (`profile_answers_assist`), rozliczenie tokenami | `docs/AI_BUDGET.md`, migracja 0147 |
| Wyjście modelu | `max_tokens` 4000, effort `low`, timeout 60 s, 1 ponowienie | `extract.ts` |

Przekroczony albo niedostępny budżet = `AI_BUDGET_EXCEEDED` bez wywołania modelu.

## Włączenie (właściciel)

1. Decyzja o koszcie i dostawcy (#36), DPA/region/retencja Anthropic.
2. Ocena prawna informacji o AI (art. 50 AI Act) i wiersza A5 szkicu DPIA.
3. `AI_PROFILE_ASSIST_ENABLED=1` (+ istniejący `ANTHROPIC_API_KEY`), opcjonalnie
   `AI_PROFILE_ASSIST_MODEL`.

## Testy

- `tests/unit/profile-assist-prepare.test.ts` — minimalizacja (osoby trzecie, kontakty, NISS,
  polecenia dla AI, znaczniki; kontrola ujemna).
- `tests/unit/profile-assist-actions.test.ts` — flaga, atrapa nie w produkcji, rola, limit per
  konto, budżet (kontrola ujemna), payload bez danych osób trzecich, brak zapisu bez
  zatwierdzenia, log bez treści.
- `tests/unit/profile-assist-panel.test.tsx` — informacja o AI w 4 językach, domyślnie
  niezaznaczone, zapis tylko zaznaczonych, zachowanie odpowiedzi po błędzie.
- `tests/unit/ai-inventory.test.ts`, `tests/unit/ai-budget.test.ts` — wpis w inwentarzu, brak
  zapisu i wpływu na matching, lista funkcji w najnowszej migracji budżetu.
- `tests/e2e/profile-assist.spec.ts` — atrapa, 4 języki, 320 px, axe; `rls.sql` sekcja AIP37.
