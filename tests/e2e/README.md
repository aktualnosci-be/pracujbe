# Testy E2E (Playwright)

Suita działa na danych demonstracyjnych (bez Supabase) i **bez ponowień** (#447):
niestabilny test daje czerwone CI, więc asercje mają być jednoznaczne i odporne.

## Zasady selektorów i asercji (#376)

- **Role + nazwy z `src/messages/*.json`.** Kontrolki wybieramy `getByRole(…, { name })`,
  a nazwy bierzemy z plików komunikatów (`fixtures/messages.ts` → `messages(locale)`),
  nie wpisujemy ich na sztywno.
- **Zakaz `.first()` / `.nth()` / `.last()` na kontrolkach o znaczeniu** (przyciski zgód,
  akcje, przełączniki). Zmiana kolejności przycisków nie może po cichu zmienić scenariusza —
  np. baner cookies zamykamy przez `rejectOptionalCookies(page, locale)`.
- **Konkretne nagłówki.** Zamiast „jakikolwiek nagłówek jest widoczny” — nagłówek o
  oczekiwanym poziomie i treści (np. H1 pulpitu = `dashboard.greeting`) oraz brak
  komunikatu błędu (`role=alert`).
- **Asercje z ponawianiem.** `await expect(locator).not.toHaveCount(0)` zamiast
  `expect(await locator.count()).toBeGreaterThan(0)`; szukamy w obrębie właściwego
  regionu (lista wyników w `main`, stopka `contentinfo`), nie po fragmencie `href`.
- **Liczby z danych demo tylko ze wspólnego źródła.** Test nie wpisuje liczb ani kolejności
  rekordów demo; porównuje z tym samym źródłem danych (np. pulpit ↔ pełna lista ofert)
  albo wybiera rekord po nazwie (kandydat, oferta), a pole po etykiecie (`dt` → `dd`).
- **Kontrola ujemna** dla nowej kluczowej asercji: pokaż (lokalnie), że test robi się
  czerwony, gdy psujemy to, co sprawdza.
