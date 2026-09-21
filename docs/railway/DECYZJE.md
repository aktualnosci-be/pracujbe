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

## Supabase — ocena zastąpienia

Właściciel zapytał o rezygnację z Supabase na rzecz Railway. Jest to osobna
zmiana architektury, nie wykonana migracja. Obecny kod nadal korzysta
z Supabase Auth, PostgreSQL/RLS, API i prywatnego Storage.

Przed wyborem sposobu migracji trzeba ustalić, czy istnieją konta, CV,
płatności i inne dane do zachowania. Nie usuwamy integracji, polityk RLS,
sekretów ani danych na podstawie założenia, że instalacja jest pusta.

PLAN_MIGRACJI.md zachowuje oryginalny dokument jako materiał źródłowy.
Przy sprzeczności jego zaleceń o stagingu z niniejszą decyzją obowiązuje
jedna produkcja z main. Historyczne instrukcje stagingu w README nie są
już zadaniami do wykonania.
