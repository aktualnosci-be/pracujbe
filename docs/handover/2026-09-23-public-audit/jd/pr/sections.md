## Zmiana
Komponent `Section` szczegółu oferty: na `lg` `summary` akordeonu jest ukryte (`lg:hidden`, więc poza kolejnością Tab), a nagłówek sekcji to osobny `h2` widoczny tylko na desktopie. W drzewie dostępności jest zawsze dokładnie jeden nagłówek sekcji. Akordeon na mobile bez zmian.

## Dlaczego
Closes #205. Na desktopie `summary` miało `pointer-events-none` i ukryty chevron, ale było przystankiem Tab; Enter/Spacja zwijały sekcję, której nie dało się rozwinąć myszą.

## Testy
- Nowy `tests/e2e/job-detail-sections.spec.ts`: 1280 px — 25 kroków Tab bez `SUMMARY`, Enter nie zamyka żadnego `details`, liczba nagłówków h2 bez zmian; 375 px — akordeon zwija/rozwija się z klawiatury i ma jeden nagłówek h2 o danej nazwie.
- Lokalnie zielone: lint, typecheck, build, e2e `job-detail-*`, `smoke` (10 passed).
- **Kontrola ujemna:** test desktopowy na buildzie z `main` → pada (fokus na 6 elementach `SUMMARY`); z poprawką zielony.

## Ryzyko
Niskie. Tytuł sekcji renderowany dwa razy w DOM, ale jeden z nich zawsze `display:none`.

## Cofnięcie
Revert commita.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
