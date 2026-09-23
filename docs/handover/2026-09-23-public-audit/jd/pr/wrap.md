## Zmiana
Panel boczny szczegółu oferty: tytuły podobnych ofert i nazwa firmy w karcie kontaktu `break-words` zamiast `truncate`; przycisk „Wyślij wiadomość” może się zawinąć (`h-auto min-h-12 whitespace-normal`).

## Dlaczego
Closes #211. Przy tekście 200% treść była ucinana wielokropkiem (np. „Monter rusztowań – Antwerpia” 386/158 px), a test wykazał też obcięcie „Wyślij wiadomość” (264/252) — WCAG 1.4.4/1.4.10.

## Testy
- Nowy `tests/e2e/job-detail-text-zoom.spec.ts`: 1280 px (pl) i 640 px (fr) z `font-size: 200%` — żaden `p/h2/a` w panelu bocznym nie ma `scrollWidth > clientWidth`.
- Lokalnie zielone: lint, typecheck, build, e2e `job-detail-*` (7 passed).
- **Kontrola ujemna:** na buildzie z `main` oba testy padają; z poprawką zielone.

## Ryzyko
Niskie — dłuższe tytuły zajmą więcej linii w panelu bocznym.

## Cofnięcie
Revert commita.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
