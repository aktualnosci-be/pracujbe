# Railway — przygotowanie przed uruchomieniem

Status: istnieje projekt captivating-vision, usługa pracujbe w production, źródło main i Wait for CI. Domena pracuj.be została dodana w Railway; potwierdzenie DNS i gotowego backendu pozostaje otwarte. Aktualne decyzje właściciela są w DECYZJE.md, a kolejność issues w STATUS.md. PLAN_MIGRACJI.md jest zachowanym materiałem historycznym i nie opisuje już celu.

Aktualna decyzja: wyłącznie bezpłatna produkcja z `main` na Railway, bez stagingu, Vercela, Supabase i monetyzacji. Patrz [DECYZJE.md](DECYZJE.md). Portal jest pusty, więc nie przenosimy kont ani danych. Supabase i Stripe pozostają jeszcze w kodzie tylko do kontrolowanego usunięcia w issues #23–#27 i #51.

## Pierwsze wdrożenie

`APP_MODE=production` i `NEXT_PUBLIC_SITE_URL=https://pracuj.be` ustaw w usłudze Railway. Automatyczne wykrywanie przez `VERCEL_ENV` zostaje usunięte. Po zmianie publicznego adresu wymagany jest ponowny build.

Web: Node22, Railpack, npm run build, npm run start, PORT dostarczony przez platformę, health /api/health. Przed połączeniem prywatnych cronów sprawdź nasłuch IPv4/IPv6 i referencję portu w rzeczywistej konfiguracji. PostgreSQL Railway jest docelową bazą, a prywatne pliki przechodzą do Railway Bucket. Nie konfiguruj Stripe ani płatnych funkcji; konfiguracja plików i bazy wymaga realizacji #23–#27.

## Cron

Komenda: node scripts/railway-cron-call.mjs. Zmienne tylko CRON_TARGET_URL i CRON_AUTH_SECRET. Dla e-maili kieruj POST do /api/email/process z EMAIL_QUEUE_SECRET; dla maintenance do /api/maintenance z MAINTENANCE_SECRET. Użyj domeny prywatnej web w tym samym środowisku. Najpierw wykonanie ręczne, potem harmonogram co5min / co godzinę UTC, restart NEVER. Nie uruchamiaj jednocześnie harmonogramów Vercel i Railway.

Skrypt kończy się kodem0 przy sukcesie,1 przy błędzie żądania/HTTP,2 przy błędnej konfiguracji. Timeout120s, bez przekierowań. Loguje kod HTTP, bez URL, tokenów i treści odpowiedzi. Wynik HTTP nie zastępuje sprawdzenia dostarczenia e-maila w outboxie.

### Maintenance: wygaszanie ofert (#72)

`/api/maintenance` wywołuje co przebieg także `expire_due_jobs()` (migracja `0085`, tylko `service_role`). Operacja zmienia wyłącznie oferty `active` z ustawionym `expires_at <= now()` na `expired` i zwraca ich liczbę; szkic, wstrzymana, zamknięta, bez daty i z datą przyszłą zostają bez zmian. Jest idempotentna: równoległe lub ponowione wywołanie pomija rekordy zablokowane przez inny przebieg (`SKIP LOCKED`) i nie wysyła powiadomień ani e-maili.

`/api/maintenance` po wygaszeniu ofert wywołuje też `process_saved_search_alerts(500)` (migracja `0092`, #100, tylko `service_role`): dla zapisanych wyszukiwań z nadszedłym terminem (`next_run_at`) wybiera nowe aktywne oferty tą samą funkcją co lista (`get_public_jobs`), rejestruje parę wyszukiwanie+oferta (bez ponownej wysyłki), tworzy jedno powiadomienie in-app i kolejkuje jeden e-mail `jobMatch` (outbox, język odbiorcy, opt-out `email_job_matches`). Digest najwyżej raz na dobę albo tydzień na wyszukiwanie. Nie wymaga nowej usługi ani zmiennej — wystarczy istniejący harmonogram co godzinę; e-maile wysyła cron `/api/email/process`.

- **Harmonogram:** osobna usługa cron (np. `cron-maintenance`) bez publicznej domeny; komenda `node scripts/railway-cron-call.mjs`, `CRON_TARGET_URL=http://<prywatna domena web>:<port>/api/maintenance`, `CRON_AUTH_SECRET` = `MAINTENANCE_SECRET` usługi web (inny niż `EMAIL_QUEUE_SECRET`), harmonogram `0 * * * *` (co godzinę, UTC), restart NEVER. Najpierw jedno wywołanie ręczne.
- **Obserwowalność:** odpowiedź 200 zawiera tylko liczniki (`expiredJobs`, `releasedDiscounts`, `releasedCheckouts`, `savedSearchDigests`) — bez danych ofert i bez sekretu; skrypt crona loguje sam kod HTTP. Błąd któregokolwiek zadania → 503 i zdarzenie Sentry `maintenance.gc` z polem `task` (`jobExpiry` dla wygaszania, `savedSearchAlerts` dla alertów wyszukiwań), a cron kończy się kodem 1 (nieudane wykonanie w Railway). Brak service-role w produkcji → 503 `unconfigured`.
- **Niezależność od crona:** publiczna lista, szczegół, aplikowanie (`job_is_public`) i dopasowanie (`get_job_match_profile`) same filtrują `expires_at > now()`; panel pracodawcy liczy i pokazuje aktywną ofertę po terminie jako wygasłą, zanim przebieg zmieni rekord. Opóźniony lub wyłączony cron nie otwiera dostępu do wygasłej oferty.
- **Cykl życia:** publikacja szkicu z minioną datą i wznowienie wstrzymanej oferty po terminie są odrzucane (`JOB_EXPIRED`); ponowne otwarcie (także aktywnej lub wstrzymanej po terminie) usuwa minioną datę.
- **Rollback:** wyłącz harmonogram usługi cron (operacja nie ma efektów ubocznych poza zmianą statusu). Zmiany SQL cofa wyłącznie nowa migracja naprawcza (`drop function public.expire_due_jobs()`, `drop index public.idx_jobs_active_expires_at`, odtworzenie `publish_job` z `0073` i `set_job_status` z `0062`); zastosowanej migracji `0085` nie edytuj. Oferty już zmienione na `expired` pracodawca otwiera ponownie z listy ofert.

## Operacje (#47)

Lista kontrolna konfiguracji usługi production (ustawienia, zmienne wymagane przy `APP_MODE=production`, crony — same nazwy, bez wartości): [KONFIGURACJA_PRODUKCJI.md](KONFIGURACJA_PRODUKCJI.md).

Test wdrożeniowy produkcji (tryb, SHA artefaktu, panele bez sesji, indeksowanie) i odbiór #12: [TEST_WDROZENIOWY.md](TEST_WDROZENIOWY.md).

Czujki `/api/health/ops`, kopie zaszyfrowane z retencją, okresowe odtworzenie i pomiar wyszukiwania opisuje [OPERATIONS.md](OPERATIONS.md). Kroki infrastruktury (sekret, login monitoringu, uptime, cron kopii) są w sekcji 5 tego dokumentu i nie zostały wykonane.

## Cutover, rollback i smoke test (#16, #18)

Kolejność włączania `APP_MODE=production`, Better Auth i Resend, rollback (wyzerowanie zmiennych, redeploy ostatniego dobrego wdrożenia) i obserwację po wdrożeniu opisuje [CUTOVER_ROLLBACK.md](CUTOVER_ROLLBACK.md). Smoke test produkcji (poza CI): `node scripts/railway/prod-smoke.mjs`.

## Stan przejściowy kodu

Workflow Vercela został usunięty: repozytorium nie publikuje już zielonego
wyniku „Deploy”, gdy wdrożenie zostało pominięte z powodu braku tokenu.
`vercel.json` oraz integracje Supabase i Stripe pozostają długiem migracyjnym,
bo ich przepływy są jeszcze używane. Usuwamy je dopiero razem z zastępującym
je przepływem i testem regresyjnym. Nie konfiguruj sekretów Vercela ani nie
uruchamiaj drugiej produkcji. IaC usług z tego repo (`pracujbe`, `db-migrator`) jest w
`.railway/railway.ts` — niewłączone; opis, strażnik i kroki włączenia w
[IAC.md](IAC.md). Nie zapisuj sekretów w repo.

## Źródła sprawdzone podczas implementacji

- https://docs.railway.com/cron-jobs — skończony proces, UTC, minimalny odstęp5min.
- https://docs.railway.com/infrastructure-as-code — aktualna dokumentacja IaC; snapshot po konfiguracji.
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions — limit body obejmuje multipart. Konfiguracja6MB nie zmienia aplikacyjnego limitu pliku5MB.

