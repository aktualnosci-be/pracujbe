# Cloudflare Turnstile — ochrona formularzy publicznych (#46)

Turnstile jest drugą warstwą ochrony formularzy publicznych obok limitów (`src/lib/rate-limit.ts`).
To **ochrona niezbędna, nie tracking** (Invariant #7): widżet ładuje się tylko na stronie
z chronionym formularzem, nie czeka na zgodę cookies i nie służy analityce ani marketingowi.

## Kod

| Plik | Rola |
|---|---|
| `src/lib/turnstile/policy.ts` | Nazwy akcji i polityka awarii dostawcy per przepływ (wspólne dla serwera i klienta). |
| `src/lib/turnstile/verify.ts` | `server-only`: siteverify, sprawdzenie akcji i hostname, `enforceTurnstile()` dla Server Actions. |
| `src/components/auth/TurnstileWidget.tsx` | Widżet (render explicit), komunikaty ładowania/wygaśnięcia/błędu, ponowne ładowanie. |
| `src/lib/actions/auth.ts` | `signIn`, `registerCandidate`, `registerEmployer`, `requestPasswordReset` — kolejność: rate limit → Turnstile → walidacja → Supabase Auth. |

Testy: `tests/unit/turnstile-verify.test.ts`, `tests/unit/auth-turnstile.test.ts`,
`tests/unit/auth-form-turnstile.test.tsx`. Żaden test nie łączy się z Cloudflare.

## Konfiguracja (env)

| Zmienna | Gdzie | Opis |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | build + runtime | Klucz witryny. Wbudowywany w bundle przy buildzie — po zmianie potrzebny nowy build. |
| `TURNSTILE_SECRET_KEY` | tylko serwer | Sekret siteverify. Nigdy jako `NEXT_PUBLIC_*`. |
| `TURNSTILE_ALLOWED_HOSTNAMES` | opcjonalnie | Dozwolone hostname tokenu, po przecinku. Domyślnie host `NEXT_PUBLIC_SITE_URL`. |

W panelu Cloudflare (Turnstile → widżet) dodaj domeny serwisu (np. `pracuj.be`, `www.pracuj.be`,
domena stagingu). Tryb widżetu: *Managed*.

## Stany

| Stan | Kiedy | Zachowanie |
|---|---|---|
| wyłączony | brak obu kluczy i `APP_MODE` ≠ `production` (demo, lokalnie, E2E) | widżet się nie pokazuje, weryfikacja pominięta |
| włączony | oba klucze ustawione | token wymagany i weryfikowany na serwerze |
| nieskonfigurowany | `APP_MODE=production` bez kluczy **albo** tylko jeden klucz (w każdym trybie) | traktowany jak awaria dostawcy — decyduje polityka przepływu (niżej) + zgłoszenie do Sentry |

`GET /api/health` (widok szczegółowy: poza produkcją lub z `x-health-token`) zwraca
`checks.turnstile: true|false` — tylko informację, czy ochrona jest włączona, bez kluczy.

## Polityka per przepływ

Brak tokenu, token nieprawidłowy, **ponownie użyty** (`timeout-or-duplicate`), wydany dla innej akcji
lub z obcej domeny jest **zawsze odrzucany** (`BOT_CHECK_FAILED`). Polityka dotyczy wyłącznie
awarii dostawcy (timeout 5 s, błąd sieci, HTTP ≠ 2xx, niepoprawna odpowiedź, `internal-error`,
błędny sekret) oraz braku konfiguracji w produkcji:

| Przepływ | Akcja | Awaria dostawcy | Uzasadnienie |
|---|---|---|---|
| logowanie | `login` | **fail-open** | awaria Cloudflare nie odcina istniejących kont; zostaje limit `signin` (fail-safe) i ochrona Supabase Auth |
| rejestracja (kandydat, pracodawca) | `register` | **fail-closed** (`BOT_CHECK_UNAVAILABLE`) | masowe zakładanie kont |
| reset hasła | `password_reset` | **fail-closed** | wysyłka e-maili do cudzych skrzynek |
| kontakt | `contact` | **fail-closed** | polityka gotowa; publicznego formularza kontaktu jeszcze nie ma |
| zgłoszenia | `report` | **fail-closed** | polityka gotowa; publicznego formularza zgłoszeń jeszcze nie ma |
| aplikowanie | — | nie dotyczy | wymaga zalogowanego kandydata (logowanie i rejestracja chronione) + limit `apply` + idempotencja w bazie |

Fail-open przy logowaniu obejmuje awarię **serwerowej** weryfikacji. Jeśli skrypt Turnstile nie
załaduje się w przeglądarce, formularz pokazuje komunikat z przyciskiem ponownego ładowania,
a wysyłka bez tokenu kończy się komunikatem przy widżecie (przycisk nie jest martwy).

## Jednorazowość i logi

- Cloudflare przyjmuje token raz; po każdej odpowiedzi serwera formularz resetuje widżet.
- Zapytanie siteverify ma losowy `idempotency_key`; nie wysyłamy IP klienta.
- Do Sentry trafia tylko przepływ, powód i kody błędów Cloudflare — nigdy token ani IP.
  Odrzucone tokeny nie są zgłaszane (zwykły ruch botów).

## CSP

`next.config.mjs`: `https://challenges.cloudflare.com` w `script-src` (skrypt `api.js`)
i `frame-src` (iframe wyzwania). Nic więcej nie jest potrzebne.

## Dostępność

Widżet jest w grupie z etykietą „Weryfikacja bezpieczeństwa”, komunikaty w regionie
`aria-live`, język widżetu = język strony. Poniżej 300 px szerokości kontenera używany jest
rozmiar `compact`, powyżej `flexible` (telefon, 200% powiększenia).
