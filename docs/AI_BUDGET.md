# Budżet kosztów AI (#36)

Globalny, twardy limit wydatków na wywołania modeli AI — wspólny dla wszystkich funkcji
z inwentarza (`src/lib/ai/inventory.ts`). Migracja `0120_ai_budget.sql`.

## Jak działa

1. **Rezerwacja przed API.** Wywołanie modelu jest owinięte w `withAiBudget`
   (`src/lib/ai/budget.ts`). Najpierw `ai_budget_reserve(feature, model, szacunek)` pod
   blokadą doradczą sumuje wydatki doby i miesiąca i odrzuca rezerwację, która
   przekroczyłaby którykolwiek limit (`AI_BUDGET_EXCEEDED`). Równoległe żądania nie
   przekroczą limitu razem.
2. **Szacunek = górna granica.** Wejście: prompt + schemat + materiał (tekst: 1 token na
   2 znaki, obraz: 6000 tokenów), wyjście: pełne `max_tokens`. Stawki w
   `src/lib/ai/pricing.ts`; nieznany model = najwyższa stawka z tabeli.
3. **Rozliczenie.** Po odpowiedzi `ai_budget_settle` zapisuje tokeny z `usage` dostawcy
   i rzeczywisty koszt (także przy odmowie modelu — tokeny są naliczane). Bez `usage`
   (przerwane połączenie, błąd) koszt = kwota rezerwacji. Rezerwacja nigdy nierozliczona
   liczy się dalej w całości.
4. **Fail-closed.** Przekroczony limit, limit `0`, brak wiersza limitu, brak bazy zadań
   serwerowych (`DATABASE_SERVICE_URL`) albo błąd rezerwacji = brak wywołania API.
   W imporcie ogłoszenia użytkownik widzi `errors.aiBudgetExceeded` (wypełnij ręcznie).

Doba i miesiąc liczone w Europe/Brussels. Kwoty w mikro-USD (1 USD = 1 000 000) — koszt
dostawcy jest naliczany w USD.

## Limity

Wartości startowe (zachowawcze, do decyzji właściciela): **10 USD / dobę, 100 USD / miesiąc**.
Zmiana (właściciel, połączenie z uprawnieniami service_role lub właściciela schematu):

```sql
update public.ai_budget_limits set limit_micro_usd = 20000000, updated_at = now() where period = 'day';
-- wyłącznik wszystkich funkcji AI:
update public.ai_budget_limits set limit_micro_usd = 0, updated_at = now() where period = 'day';
```

Panel nie ma formularza zmiany limitów — celowo (raport jest tylko do odczytu).

## Dane

`ai_usage_ledger`: funkcja, model, status, wynik (enum), tokeny wejścia/wyjścia, koszt,
doba, znaczniki czasu. **Bez** treści, promptu, odpowiedzi, adresu, identyfikatora osoby
i firmy. RLS wymuszone, bez polityk; tylko RPC `SECURITY DEFINER` (service_role, stan
budżetu także `pracujbe_ops`). Mapa danych: `src/lib/privacy/data-map.ts`.

Retencja rejestru: brak automatycznego usuwania (same liczniki, bez danych osobowych);
raport czyta ostatnie 31 dni i 12 miesięcy.

## Porzucone rezerwacje (#609)

Jeśli proces kończy się MIĘDZY rezerwacją a rozliczeniem (crash, restart, redeploy,
timeout), wiersz zostaje w stanie `reserved` i bez GC liczyłby się do budżetu bezterminowo.
`/api/maintenance` woła co godzinę `ai_budget_release_stale_reservations` (0134,
service_role): rezerwacja starsza niż 60 minut, wciąż `reserved`, jest rozliczana jako
`outcome='failed'`, `cost_micro_usd=0` — wiersz (ślad audytowy) zostaje w rejestrze, ale
przestaje liczyć się do wydanego budżetu, więc limit doby/miesiąca wraca do użycia. TTL
(60 min) jest wyraźnie dłuższy niż próg ostrzeżenia `staleReservations` w `ai_budget_status`
(15 min), żeby GC nie zwolniło rezerwacji trwającego jeszcze wywołania. Idempotentne
(`FOR UPDATE SKIP LOCKED`, filtr po statusie) — kolejne przebiegi i przebiegi równoległe nie
rozliczają tego samego wiersza dwukrotnie.

## Raport i monitoring

- **Panel** `/admin/koszty-ai` (tylko admin, tylko odczyt): wydatek dziś / w miesiącu
  względem limitu, dzienne agregaty per funkcja (wywołania, udane, nieudane, w toku,
  tokeny, koszt), sumy miesięczne. Źródło: `ai_cost_report` (loader
  `src/lib/data/admin-ai-costs.ts`).
- **`/api/health/ops`**: `ai_budget_exhausted` (alarm, 503) — limit doby lub miesiąca
  wyczerpany, limit 0 albo brak limitu (funkcje AI zablokowane);
  `ai_budget_near_limit` (ostrzeżenie) — ≥ 80%; `ai_budget_stale_reservation`
  (ostrzeżenie) — rezerwacja bez rozliczenia > 15 min (proces padł w trakcie wywołania);
  `ai_budget_unavailable` (ostrzeżenie) — stanu nie da się odczytać. Stan (same liczby)
  w polu `aiBudget` odpowiedzi.

## Funkcje objęte budżetem

- Import ogłoszenia (#465): `withJobImportBudget` (`src/lib/ai/job-import-usage.ts`).
- Asystent treści oferty (#37): bramka `src/lib/ai-assist/budget.ts` (rezerwacja → bilet →
  rozliczenie), szacunek `src/lib/ai-assist/cost.ts`.
- Import CV kandydata (#487, #498): `withAiBudget` w `src/lib/actions/cv-import.ts`, szacunek
  `src/lib/cv-import/cost.ts` (prompt + schemat + zminimalizowany tekst + `max_tokens`).
- Tłumaczenia (#514): jeszcze nie — hook poniżej.

## Nowa funkcja AI (hook, np. tłumaczenia #514)

```ts
import { withAiBudget } from '@/lib/ai/budget';
import { estimateMicroUsd } from '@/lib/ai/pricing';

const result = await withAiBudget(
  { feature: 'content_translation', model, estimateMicroUsd: estimateMicroUsd(model, { inputTokens, maxOutputTokens }) },
  async (reportUsage) => {
    const response = await client.messages.create({ /* … */ });
    reportUsage({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    return response;
  },
  (r) => (r.ok ? 'ok' : 'failed'),
);
```

`AiBudgetError` (`exceeded`/`unavailable`) w workerze = błąd przejściowy (ponów później,
bez utraty źródła). Po podpięciu ustaw `costBudgeted: true` w inwentarzu — strażnik
`ai-inventory.test.ts` wymaga tego dla każdej funkcji ze statusem `behind_flag`.
Nowy identyfikator funkcji = także lista w CHECK `ai_usage_ledger_feature` i w
`ai_budget_reserve` (nowa migracja; test `ai-budget.test.ts` porównuje listy).

## Otwarte

- Limity per firma / profil (dziś tylko limity godzinowe i dobowe importu per firma
  w `rate_limit_hit` i globalny budżet).
- Weryfikacja stawek z aktualnym cennikiem przed włączeniem (cennik w kodzie).
- Rabaty Batch i cache promptu w tłumaczeniach — rozliczenie obsługuje pola cache `usage`.
