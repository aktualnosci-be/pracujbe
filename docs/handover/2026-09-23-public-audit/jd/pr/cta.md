## Zmiana
Mobilny pasek CTA na szczególe oferty (`page.tsx`, tylko JSX komponentu strony):
- przycisk zapisu w pasku jako ikona 48×48 (`iconOnly`); pełny opis stanu (`jobs.saveLogin` / `saveUnavailable`) zostaje w nazwie dostępnej,
- CTA „Aplikuj” zajmuje resztę szerokości (`min-w-0 flex-1`) w jednym wierszu,
- pasek sam rezerwuje miejsce pod całą stroną, także pod stopką (`max-lg:[body:has(&)]:pb-24`) i ustawia `scroll-padding-bottom` na `html` (`max-lg:[html:has(&)]:scroll-pb-28`), więc element z fokusem nie chowa się pod paskiem. Stary odstęp `h-20` (mniejszy niż pasek, bez stopki) usunięty. `globals.css` bez zmian — reguły generuje Tailwind z klas paska, działają tylko na stronie z paskiem i poniżej `lg`.

## Dlaczego
Closes #202. Przy 320 px w FR „Postuler maintenant” wychodziło poza ekran (right=363), pasek miał 127 px (251 px przy tekście 200%), a Tab chował fokus pod paskiem (WCAG 2.4.11), koniec stopki był przykryty.

## Testy
- Nowy `tests/e2e/job-detail-cta-bar.spec.ts`: przy 320 px w pl/nl/fr/en CTA w całości w viewporcie, ≥ 48 px, bez obcięcia etykiety, pasek ≤ 80 px, zapis ≥ 48×48 z nazwą; przy 375 px 70 kroków Tab bez fokusu pod paskiem + koniec stopki nad paskiem.
- Lokalnie zielone: lint, typecheck, build, e2e `job-detail-cta-bar`, `job-detail-passport`, `public-zoom`, `a11y` (42 passed). `npm test`: 588/589 — jedyny błąd `organic-story-assets` wynika z braku `chrome-headless-shell` w środowisku agenta (niezwiązane).
- **Kontrola ujemna:** przywrócony stary pasek (flex-1 zapis z etykietą, bez paddingu/scroll-padding, spacer h-20) z zachowanym `data-testid`, przebudowa → wszystkie 5 testów padają (pasek 87/87/167/127 px; lista elementów zasłoniętych przez pasek, m.in. „Wyślij wiadomość”, linki stopki). Po przywróceniu poprawki — zielone.

## Ryzyko
Niskie. Selektory `:has()` (Chromium/Safari/Firefox ≥ 121); w starszej przeglądarce zostaje brak odstępu jak wcześniej. Desktop bez zmian (`lg:hidden`).

## Cofnięcie
Revert commita; brak migracji i kluczy i18n.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
