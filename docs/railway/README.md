# Railway — przygotowanie przed uruchomieniem

Status: istnieje projekt captivating-vision, usługa pracujbe w production, źródło main i Wait for CI. Domena pracuj.be została dodana w Railway; potwierdzenie DNS i gotowego backendu pozostaje otwarte. Aktualne decyzje właściciela są w DECYZJE.md, a kolejność issues w STATUS.md. PLAN_MIGRACJI.md jest zachowanym materiałem historycznym i nie opisuje już celu.

Aktualna decyzja: wyłącznie bezpłatna produkcja z `main` na Railway, bez stagingu, Vercela, Supabase i monetyzacji. Patrz [DECYZJE.md](DECYZJE.md). Portal jest pusty, więc nie przenosimy kont ani danych. Supabase i Stripe pozostają jeszcze w kodzie tylko do kontrolowanego usunięcia w issues #23–#27 i #51.

## Pierwsze wdrożenie

`APP_MODE=production` i `NEXT_PUBLIC_SITE_URL=https://pracuj.be` ustaw w usłudze Railway. Automatyczne wykrywanie przez `VERCEL_ENV` zostaje usunięte. Po zmianie publicznego adresu wymagany jest ponowny build.

Web: Node22, Railpack, npm run build, npm run start, PORT dostarczony przez platformę, health /api/health. Przed połączeniem prywatnych cronów sprawdź nasłuch IPv4/IPv6 i referencję portu w rzeczywistej konfiguracji. PostgreSQL Railway jest docelową bazą, a prywatne pliki przechodzą do Railway Bucket. Nie konfiguruj Stripe ani płatnych funkcji; konfiguracja plików i bazy wymaga realizacji #23–#27.

## Cron

Komenda: node scripts/railway-cron-call.mjs. Zmienne tylko CRON_TARGET_URL i CRON_AUTH_SECRET. Dla e-maili kieruj POST do /api/email/process z EMAIL_QUEUE_SECRET; dla maintenance do /api/maintenance z MAINTENANCE_SECRET. Użyj domeny prywatnej web w tym samym środowisku. Najpierw wykonanie ręczne, potem harmonogram co5min / co godzinę UTC, restart NEVER. Nie uruchamiaj jednocześnie harmonogramów Vercel i Railway.

Skrypt kończy się kodem0 przy sukcesie,1 przy błędzie żądania/HTTP,2 przy błędnej konfiguracji. Timeout120s, bez przekierowań. Loguje kod HTTP, bez URL, tokenów i treści odpowiedzi. Wynik HTTP nie zastępuje sprawdzenia dostarczenia e-maila w outboxie.

## Stan przejściowy kodu

Workflow Vercela został usunięty: repozytorium nie publikuje już zielonego
wyniku „Deploy”, gdy wdrożenie zostało pominięte z powodu braku tokenu.
`vercel.json` oraz integracje Supabase i Stripe pozostają długiem migracyjnym,
bo ich przepływy są jeszcze używane. Usuwamy je dopiero razem z zastępującym
je przepływem i testem regresyjnym. Nie konfiguruj sekretów Vercela ani nie
uruchamiaj drugiej produkcji. Przyszłe IaC pobierz z działającego projektu
Railway; nie zapisuj sekretów w repo.

## Źródła sprawdzone podczas implementacji

- https://docs.railway.com/cron-jobs — skończony proces, UTC, minimalny odstęp5min.
- https://docs.railway.com/infrastructure-as-code — aktualna dokumentacja IaC; snapshot po konfiguracji.
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions — limit body obejmuje multipart. Konfiguracja6MB nie zmienia aplikacyjnego limitu pliku5MB.

