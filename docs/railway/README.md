# Railway — przygotowanie przed uruchomieniem

Status: kod przygotowywany; nie utworzono usług ani nie przełączono DNS. Pełny plan właściciela jest w PLAN_MIGRACJI.md; kolejność issues w STATUS.md. Plan opisuje cel, a nie aktualnie wdrożoną infrastrukturę.

Aktualna decyzja: wyłącznie production z main, bez stagingu. Patrz [DECYZJE.md](DECYZJE.md). Supabase pozostaje w kodzie do osobnej decyzji i realizacji migracji.

## Pierwsze wdrożenie

Przed wdrożeniem zmian także na dotychczasowym hostingu ustaw APP_MODE=production w produkcji. Automatyczne wykrywanie przez VERCEL_ENV zostaje usunięte. NEXT_PUBLIC_SITE_URL musi być docelowym adresem HTTPS produkcji. Po jego zmianie wymagany jest ponowny build.

Web: Node22, Railpack, npm run build, npm run start, PORT dostarczony przez platformę, health /api/health. Przed połączeniem prywatnych cronów sprawdź nasłuch IPv4/IPv6 i referencję portu w rzeczywistej konfiguracji. Nie dodawaj Dockerfile, bazy, Redis ani wolumenu.

## Cron

Komenda: node scripts/railway-cron-call.mjs. Zmienne tylko CRON_TARGET_URL i CRON_AUTH_SECRET. Dla e-maili kieruj POST do /api/email/process z EMAIL_QUEUE_SECRET; dla maintenance do /api/maintenance z MAINTENANCE_SECRET. Użyj domeny prywatnej web w tym samym środowisku. Najpierw wykonanie ręczne, potem harmonogram co5min / co godzinę UTC, restart NEVER. Nie uruchamiaj jednocześnie harmonogramów Vercel i Railway.

Skrypt kończy się kodem0 przy sukcesie,1 przy błędzie żądania/HTTP,2 przy błędnej konfiguracji. Timeout120s, bez przekierowań. Loguje kod HTTP, bez URL, tokenów i treści odpowiedzi. Wynik HTTP nie zastępuje sprawdzenia dostarczenia e-maila w outboxie.

## Bezpieczny okres przejściowy

CRON_SECRET, vercel.json i workflow Vercela pozostają do czasu potwierdzenia Railway i procedury rollbacku (#13,#18,#19). Nie usuwaj sekretów z kont ani nie włączaj retencji produkcyjnej przy wdrożeniu samego kodu. Przyszłe IaC pobierz z działającego projektu; nie zapisuj sekretów w repo. Informację o terminie zakończenia starszego Config as Code z planu trzeba ponownie potwierdzić przed cleanupem.

## Źródła sprawdzone podczas implementacji

- https://docs.railway.com/cron-jobs — skończony proces, UTC, minimalny odstęp5min.
- https://docs.railway.com/infrastructure-as-code — aktualna dokumentacja IaC; snapshot po konfiguracji.
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions — limit body obejmuje multipart. Konfiguracja6MB nie zmienia aplikacyjnego limitu pliku5MB.

