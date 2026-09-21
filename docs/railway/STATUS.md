# Migracja Railway — kolejność pracy

Aktualizacja właściciela: jedna produkcja z main, bez stagingu. [Decyzje](DECYZJE.md) zastępują ten fragment pierwotnego planu.

Baza: b35087b, gałąź infra/railway oparta na pracach PR #8. Zmiany migracyjne są osobne; PR migracyjny zależy od tej bazy. Nie skonfigurowano jeszcze usług Railway ani DNS.

- [P0: Railway — plan migracji i pomiar bazowy](https://github.com/aktualnosci-be/pracujbe/issues/11)
- [P0: Railway — jawny APP_MODE i upload CV 5 MB](https://github.com/aktualnosci-be/pracujbe/issues/12)
- [P0: Railway — cron caller i oddzielne sekrety](https://github.com/aktualnosci-be/pracujbe/issues/13)
- [P0: Railway — production web i konfiguracja usług](https://github.com/aktualnosci-be/pracujbe/issues/14)
- [P1: Railway — CI i wdrażanie produkcji z main](https://github.com/aktualnosci-be/pracujbe/issues/15)
- [P1: Railway — odbiór produkcji i integracji](https://github.com/aktualnosci-be/pracujbe/issues/16)
- [P2: Railway — dzienna retencja i GC](https://github.com/aktualnosci-be/pracujbe/issues/17)
- [P1: Railway — domeny, cutover, rollback i obserwacja](https://github.com/aktualnosci-be/pracujbe/issues/18)
- [P2: Railway — IaC i cleanup po okresie stabilności](https://github.com/aktualnosci-be/pracujbe/issues/19)
- [P2: Railway — opcjonalne usprawnienia po migracji](https://github.com/aktualnosci-be/pracujbe/issues/20)
## Pierwszy etap implementacji

Przygotowano jawny APP_MODE, gotowość stagingu niezależną od indeksowania, limit żądania Server Actions 6 MB dla pliku CV do 5 MB oraz jednorazowy caller cron (POST, timeout 120 s, bez logowania sekretów). Oddzielne sekrety endpointów już istniały; opisano ich użycie na Railway. Legacy CRON_SECRET pozostaje na okres przejściowy.

Kontrola lokalna: lint, typecheck i 101 testów jednostkowych zaliczone. Testy regresyjne trybu i gotowości uruchomione przed poprawką wykazały 4 błędy, po poprawce wszystkie przechodzą. Nie potwierdzono jeszcze rzeczywistego uploadu CV z zalogowanym kontem ani integracji i prywatnej sieci Railway — odbiór w issues #14 i #16.

Build produkcyjny i Playwright: 20 zaliczonych, 1 pominięty. Testy przeglądarkowe używają danych demo, nie stanowią odbioru infrastruktury Railway.

Bramka CI (#15): automatyczne anulowanie ograniczono do PR. Push i uruchomienia ręczne mają osobne grupy run_id, aby nie usuwać również oczekujących przebiegów. Weryfikacja zachowania w rzeczywistych kolejnych pushach pozostaje częścią odbioru integracji Railway.

Nowy backend zatwierdzony dla pustego portalu: #23 migracje, #24 auth, #25 dane/RLS, #26 pliki, #27 odbiór i usunięcie Supabase. Railway: projekt captivating-vision, production/pracujbe, main, Wait for CI potwierdzone odczytem API. Domena pracuj.be dodana; wymagany CNAME xetenf6j.up.railway.app. Nie potwierdzono jeszcze DNS ani gotowości backendu.

Poprawka CI: build E2E przeniesiony do osobnego kroku z limitem 15 minut. Poprzednia awaria była timeoutem180s kompilacji w webServer. Lokalnie wariant startu istniejącego buildu: 20 E2E zaliczonych,1 pominięty; verify101 zaliczone. Wynik zdalnego CI po poprawce pozostaje do potwierdzenia.
