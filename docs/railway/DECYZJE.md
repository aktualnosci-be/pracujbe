# Aktualne decyzje wdrożeniowe

## 21 września 2026 — jedna produkcja

Jawna decyzja właściciela zastępuje fragmenty pierwotnego planu:

- jedyne środowisko Railway: production;
- jedyna gałąź wdrożeniowa: main;
- nie tworzymy stagingu ani gałęzi develop na potrzeby wdrożenia;
- zmiany przechodzą przez PR, testy lokalne i GitHub CI;
- automatyczne wdrożenie main czeka na zakończenie wymaganych testów;
- domena zarządzana w Cloudflare ma zostać podłączona do Railway;
- podłączenie domeny nie jest dowodem gotowości aplikacji ani zgodą na utratę danych.

Testy integracyjne nadal wymagają izolowanych danych testowych. Brak stagingu
nie upoważnia do uruchamiania seedów lub destrukcyjnych testów na produkcji.
Dokładna domena i jej obecne wykorzystanie pozostają do ustalenia.

## Supabase — zatwierdzone zastąpienie, pusta instalacja

Właściciel zatwierdził PostgreSQL na Railway i potwierdził, że portal jest
pusty. Nie ma istniejących kont ani danych do migracji. Docelowo usuwamy
Supabase Auth, API i Storage, zastępując wszystkie ich funkcje. Obecny kod
nadal korzysta z Supabase — decyzja nie oznacza zakończonej implementacji.

Etapy: #23 bootstrap bazy i migracje, #24 konta/sesje, #25 serwerowa warstwa
danych i RLS, #26 prywatne pliki, #27 odbiór całości i usunięcie SDK.
Nie tworzymy płatnych usług bez osobnego upoważnienia. Zachowujemy kontrolę
dostępu i procesy domenowe podczas wymiany backendu.

Odczyt kodu wykazał 44 pliki src odwołujące się do Supabase. Testowy shim
nie jest produkcyjnym backendem: nie ma haseł ani sesji, tożsamość ustawia
parametrem testu, a migracja Storage pomija wykonanie bez schematu storage.
Bootstrap musi uwzględnić role i właścicieli funkcji SECURITY DEFINER oraz
oddzielić migratora od zwykłych żądań. Testy muszą dowieść braku wycieku
tożsamości w puli połączeń i prywatności nowego magazynu CV.

PLAN_MIGRACJI.md zachowuje oryginalny dokument jako materiał źródłowy.
Przy sprzeczności jego zaleceń o stagingu z niniejszą decyzją obowiązuje
jedna produkcja z main. Historyczne instrukcje stagingu w README nie są
już zadaniami do wykonania.
