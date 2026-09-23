## Zmiana
Sekcja „Zakwaterowanie i dojazd” na szczególe oferty: pary `dt`/`dd` bezpośrednio w `div`, który jest dzieckiem `dl`; ikona to dekoracja (`aria-hidden`) wewnątrz `dt`, pozycjonowana w lewym odstępie (wygląd bez zmian — sprawdzone zrzutami 375/1280 px). Nowa bramka axe dla szczegółu oferty w 4 językach.

## Dlaczego
Closes #204. axe: `definition-list` + `dlitem` (serious, WCAG 1.3.1) we wszystkich językach — jedyne naruszenia na stronie; szczegół oferty nie był objęty `a11y.spec.ts`.

## Testy
- Nowy `tests/e2e/job-detail-a11y.spec.ts`: axe (WCAG 2.x A/AA, critical/serious) na `/{pl,nl,fr,en}/oferty-pracy/bricklayer-brussels-1002` + test struktury par dt/dd.
- Lokalnie zielone: lint, typecheck, build, e2e `job-detail-*` (10 passed).
- **Kontrola ujemna:** te same testy na buildzie z `main` (bez poprawki) → 5/5 padają z `[serious] definition-list` / `dlitem`; z poprawką zielone.

## Ryzyko
Niskie — zmiana tylko znaczników jednej sekcji.

## Cofnięcie
Revert commita.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
