# Harmonogram zadań przez Cloudflare Worker (Cron Triggers)

Zastępczy harmonogram dla dwóch zadań serwerowych pracuj.be, gdy plan Railway nie pozwala
dodać usług cron (`docs/railway/README.md`, `scripts/railway-cron-call.mjs`). Kod:
`infra/cloudflare-cron/` (`wrangler.toml`, `src/worker.mjs`), test
`tests/unit/cloudflare-cron-worker.test.ts`.

**Stan:** przygotowane w repozytorium, **niewdrożone**. Wdrożenie i sekrety ustawia właściciel
(kroki niżej). Zmiana nie dotyka konfiguracji Railway.

## Co robi worker

| Harmonogram (UTC) | Zadanie | Sekret (Worker secret) |
|---|---|---|
| `*/5 * * * *` (co 5 min) | `POST https://pracuj.be/api/email/process` | `EMAIL_QUEUE_SECRET` |
| `0 * * * *` (co godzinę) | `POST https://pracuj.be/api/maintenance` | `MAINTENANCE_SECRET` |
| `*/10 * * * *` (co 10 min) | `POST https://pracuj.be/api/translation/process` (#33; bez `AI_TRANSLATION_ENABLED` = `skipped`) | `MAINTENANCE_SECRET` |

Zasady takie jak w callerze Railway:

- jedno żądanie `POST` z nagłówkiem `Authorization: Bearer <sekret>`; każde zadanie dostaje
  **tylko swój** sekret (`src/lib/cron/secrets.ts`: sekret kolejki nie otwiera maintenance
  i odwrotnie, ta sama wartość w obu = oba zadania zamknięte);
- adres = `CRON_BASE_URL` (tylko `https://host`, bez ścieżki, query, fragmentu i danych
  logowania) + stała ścieżka z kodu — sekret nie trafi pod inny adres;
- bez podążania za przekierowaniem (3xx = błąd), treść odpowiedzi nie jest czytana;
- limit czasu `CRON_TIMEOUT_SECONDS` (1–600, domyślnie 120);
- logi: stały komunikat, nazwa zadania i kod HTTP — nigdy adres, sekret ani treść.

Wynik (jak kody wyjścia callera): `0` = HTTP 2xx, `1` = błąd sieci, HTTP spoza 2xx,
przekierowanie albo przekroczony czas, `2` = błędna konfiguracja (żądanie nie wychodzi).
Wynik ≠ 0 kończy przebieg wyjątkiem, więc Cloudflare pokazuje go jako nieudany (Workers →
pracujbe-cron → Logs / Cron Events).

Worker nie ma adresu HTTP (`workers_dev = false`, brak tras, brak obsługi `fetch`).

## Limit czasu kolejki poczty (#731)

`/api/email/process` obsługuje obie kolejki (`email_deliveries` i `auth.email_outbox`) w jednym
budżecie czasu `EMAIL_RUN_BUDGET_MS` = **90 s** (`src/lib/email/run-deadline.ts`), krótszym od
limitu workera `CRON_TIMEOUT_SECONDS` = **120 s**. Nie podnoś budżetu bez podniesienia limitu
workera (test `email-run-deadline` pilnuje: budżet ≤ limit − 20 s, dzierżawa 300 s > limit,
okno wysyłki 25 s ≥ sprawdzenie GET + POST EmailLabs po 10 s).

- Nowa wysyłka startuje tylko z oknem co najmniej 25 s do końca budżetu i do końca dzierżawy;
  jej termin nie wykracza poza budżet przebiegu. Rozłączenie callera (sygnał żądania) też
  zatrzymuje kolejne wysyłki.
- Rekordy, na które zabrakło czasu, wracają do kolejki **bez zużycia próby** i nie są liczone
  jako `failed`. Odpowiedź to wtedy `503` z licznikiem `deadlineDeferred` (oraz `leaseLost`
  w `auth`, gdy dzierżawa wygasła przed obsługą) — przebieg jest nieudany w Cron Events, choć
  część listów wyszła. To sygnał zaległości, nie awarii dostawcy.
- Dzierżawa (300 s) przeżywa cały przebieg, więc kolejny trigger (po 5 min) nie dostanie
  rekordu trzymanego przez trwający przebieg; claim z `SKIP LOCKED` dzieli resztę.

**Sprawdzenie zaległości po pierwszym uruchomieniu:** w Cron Events kolejne przebiegi
`*/5 * * * *` powinny wrócić do OK, gdy kolejka się opróżni (seria `503` = zaległość albo
wolny dostawca). `/api/health/ops` (z `HEALTH_CHECK_SECRET`) pokazuje wiek najstarszego
zlecenia obu kolejek (`email_queue_age`, `auth_email_queue_age`) — po opróżnieniu zaległości
wraca poniżej progu.

## Bramka hasła

`SITE_ACCESS_PASSWORD` działa w middleware, którego `matcher` pomija całe `/api/*`
(`src/middleware.ts`). Oba zadania autoryzują wyłącznie sekretem zadania — bez cookie bramki
(test `cloudflare-cron-worker.test.ts`, z kontrolą ujemną: strony nadal są za bramką).

## Wdrożenie (właściciel)

Wymaga konta Cloudflare (plan Free wystarcza: do 5 Cron Triggers na konto, limit czasu
przebiegu 15 min wg https://developers.cloudflare.com/workers/platform/limits/) i narzędzia
`wrangler` (`npx wrangler@4`, bez instalacji w projekcie).

1. `cd infra/cloudflare-cron && npx wrangler@4 login`
2. Sekrety — te same wartości co `EMAIL_QUEUE_SECRET` i `MAINTENANCE_SECRET` usługi web
   w Railway (dwie różne wartości; wklej przy pytaniu, nie w wierszu poleceń):
   - `npx wrangler@4 secret put EMAIL_QUEUE_SECRET`
   - `npx wrangler@4 secret put MAINTENANCE_SECRET`
3. Sprawdzenie bez wdrożenia: `npx wrangler@4 deploy --dry-run`.
4. Wdrożenie: `npx wrangler@4 deploy`.
5. Kontrola: po ≤ 5 min w Cloudflare (Workers → pracujbe-cron → Cron Events) przebieg
   `*/5 * * * *` z wynikiem OK; `/api/health` (ze szczegółami za `HEALTH_CHECK_SECRET`)
   i outbox `email_deliveries` pokazują przetworzone e-maile. Wynik HTTP nie zastępuje
   sprawdzenia dostarczenia e-maila.

Test lokalny harmonogramu: `npx wrangler@4 dev --test-scheduled`, potem
`curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` (z sekretami w
`.dev.vars` — plik lokalny, nie commituj; wskaż `CRON_BASE_URL` na środowisko testowe).

## Uwagi

- **Równoległy cron Railway:** jeśli kiedyś działa też cron Railway, oba harmonogramy mogą
  się nałożyć — zadania są idempotentne (claim kolejki i `SKIP LOCKED` w maintenance), ale
  docelowo zostaw jeden harmonogram.
- **Ochrona domeny w Cloudflare:** jeśli strefa `pracuj.be` ma Bot Fight Mode albo regułę
  WAF z wyzwaniem, żądanie workera może dostać 403 (w logach „błędem HTTP 403”). Wtedy dodaj
  regułę pomijającą dla `POST` na dwie ścieżki zadań i user-agenta
  `pracujbe-cloudflare-cron/1.0` (sam nagłówek nie jest zabezpieczeniem — chroni sekret).
- **Rotacja sekretu:** zmień wartość w Railway i `wrangler secret put` tego samego sekretu;
  do czasu obu zmian zadanie zwraca 401 (przebieg nieudany, bez skutków ubocznych).
- **Wyłączenie:** `npx wrangler@4 delete` albo usunięcie triggerów w panelu Cloudflare.
