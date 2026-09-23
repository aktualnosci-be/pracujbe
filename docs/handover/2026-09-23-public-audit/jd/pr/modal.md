## Zmiana
`ApplyModal`:
- combobox kierunkowego ma nazwę `apply.dialCode` (pl „Kierunkowy kraju”, nl „Landnummer”, fr „Indicatif du pays”, en „Country calling code”) zamiast powtarzać „Telefon”,
- `aria-required="true"` na telefonie i zgodzie; gwiazdka `aria-hidden`,
- po błędzie serwera fokus przechodzi na komunikat `role="alert"` (`tabIndex=-1`, widoczny ring) zamiast spadać na kontener dialogu.

## Dlaczego
Closes #209. (Walidacja formatu telefonu i mapowanie `VALIDATION_FAILED` na pole to #145 — poza zakresem.)

## Testy
- Nowy `tests/e2e/apply-modal-a11y.spec.ts` (pl/nl/fr/en): combobox po nazwie `apply.dialCode`, brak comboboxa nazwanego „Telefon”, `aria-required` na telefonie i zgodzie, po wysyłce (w demo zawsze błąd serwera) alert ma fokus.
- Lokalnie zielone: lint, typecheck, `i18n-keys`, build, e2e `apply-modal-a11y`, `job-detail-*`, `flows` (18 passed).
- **Kontrola ujemna:** na buildzie z `main` 4/4 testy padają; z poprawką zielone.

## Ryzyko
Niskie. Nowy klucz i18n w 4 językach (blokada `locks/messages` zajęta przez agenta detail).

## Cofnięcie
Revert commita.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
