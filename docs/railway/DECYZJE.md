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

## 22 września 2026 — Railway jest jedyną platformą docelową

Docelowy runtime, PostgreSQL, zadania cykliczne i prywatny magazyn plików
utrzymujemy w Railway. Cloudflare obsługuje DNS domeny `pracuj.be`, ale nie jest
drugim środowiskiem aplikacji. Vercel i Supabase są wyłącznie elementami
zastępowanego stanu kodu; nie rozwijamy dla nich nowych integracji. Ich usunięcie
następuje po przełączeniu odpowiadających przepływów i testach regresyjnych,
żeby nie zostawić martwych formularzy ani pozornie działających zapisów.

Produkcja wdraża się z `main` po zielonym CI. Nie tworzymy stagingu. Testy
integracyjne i migracyjne korzystają z izolowanych, nietrwałych baz testowych,
a nie z produkcyjnego PostgreSQL Railway.

## 22 września 2026 — bezpłatny MVP, bez monetyzacji

Na obecnym etapie portal rozwijamy bez sprzedaży ofert, abonamentów, pakietów
ani dostępu premium. Stripe, checkout, cennik oraz ograniczenia zależne od
subskrypcji nie są częścią aktywnego produktu. Kod finansowy może zostać
zachowany tymczasowo wyłącznie na potrzeby bezpiecznego, osobnego usunięcia;
nie wolno go konfigurować ani eksponować użytkownikom. Szczegóły i kryteria
odbioru prowadzi issue #51.

Powrót do monetyzacji wymaga nowej, jawnej decyzji właściciela i osobnego planu.
Nie realizujemy zaleceń audytu dotyczących Stripe, pakietów, płatnego pilota,
faktur ani celów przychodowych.

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

PLAN_MIGRACJI.md zachowuje oryginalny dokument jako materiał historyczny.
Przy sprzeczności jego zaleceń o Supabase, Vercelu, stagingu, Stripe lub
monetyzacji z niniejszą decyzją obowiązuje Railway-only, bezpłatna produkcja
z `main`. Historyczne instrukcje nie są zadaniami do wykonania.
