# Migracja Railway — kolejność pracy

Baza: b35087b, gałąź infra/railway oparta na pracach PR #8. Zmiany migracyjne są osobne; PR migracyjny zależy od tej bazy. Nie skonfigurowano jeszcze usług Railway ani DNS.

- [P0: Railway — plan migracji i pomiar bazowy](https://github.com/aktualnosci-be/pracujbe/issues/11)
- [P0: Railway — jawny APP_MODE i upload CV 5 MB](https://github.com/aktualnosci-be/pracujbe/issues/12)
- [P0: Railway — cron caller i oddzielne sekrety](https://github.com/aktualnosci-be/pracujbe/issues/13)
- [P0: Railway — staging web i konfiguracja usług](https://github.com/aktualnosci-be/pracujbe/issues/14)
- [P1: Railway — CI, gałęzie i ochrona staging](https://github.com/aktualnosci-be/pracujbe/issues/15)
- [P1: Railway — odbiór staging i integracji](https://github.com/aktualnosci-be/pracujbe/issues/16)
- [P2: Railway — dzienna retencja i GC](https://github.com/aktualnosci-be/pracujbe/issues/17)
- [P1: Railway — domeny, cutover, rollback i obserwacja](https://github.com/aktualnosci-be/pracujbe/issues/18)
- [P2: Railway — IaC i cleanup po okresie stabilności](https://github.com/aktualnosci-be/pracujbe/issues/19)
- [P2: Railway — opcjonalne usprawnienia po migracji](https://github.com/aktualnosci-be/pracujbe/issues/20)
## Pierwszy etap implementacji

Przygotowano jawny APP_MODE, gotowość stagingu niezależną od indeksowania, limit żądania Server Actions 6 MB dla pliku CV do 5 MB oraz jednorazowy caller cron (POST, timeout 120 s, bez logowania sekretów). Oddzielne sekrety endpointów już istniały; opisano ich użycie na Railway. Legacy CRON_SECRET pozostaje na okres przejściowy.

Kontrola lokalna: lint, typecheck i 101 testów jednostkowych zaliczone. Testy regresyjne trybu i gotowości uruchomione przed poprawką wykazały 4 błędy, po poprawce wszystkie przechodzą. Nie potwierdzono jeszcze rzeczywistego uploadu CV z zalogowanym kontem ani integracji i prywatnej sieci Railway — odbiór w issues #14 i #16.

Build produkcyjny i Playwright: 20 zaliczonych, 1 pominięty. Testy przeglądarkowe używają danych demo, nie stanowią odbioru infrastruktury Railway.
