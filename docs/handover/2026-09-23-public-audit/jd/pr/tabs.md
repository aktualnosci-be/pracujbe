## Zmiana
Nawigacja po sekcjach szczegółu oferty:
- kotwica „Podobne oferty” renderowana tylko, gdy sekcja `#podobne` istnieje,
- `<nav aria-label>` z nowego klucza `job.sectionsNav` (pl „Sekcje oferty”, nl „Onderdelen van de vacature”, fr „Sections de l’offre”, en „Job sections”) zamiast etykiety pierwszej pozycji,
- usunięte stałe `aria-current` i stałe wyróżnienie pierwszej pozycji (strona nie śledzi bieżącej sekcji); wyróżnienie przy hover.

## Dlaczego
Closes #207.

## Testy
- Nowy `tests/e2e/job-detail-tabs.spec.ts`: pl/nl/fr/en × (oferta z podobnymi, oferta bez podobnych `office-cleaner-brussels-1004`) — nawigacja znaleziona po nazwie `job.sectionsNav`, każda kotwica ma cel, brak `aria-current`.
- Lokalnie zielone: lint, typecheck, `i18n-keys`, build, e2e `job-detail-*` (13 passed).
- **Kontrola ujemna:** na buildzie z `main` 8/8 testów pada; z poprawką zielone.

## Ryzyko
Niskie. Nowy klucz i18n we wszystkich 4 językach (blokada `locks/messages` zajęta przez agenta detail).

## Cofnięcie
Revert commita.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
