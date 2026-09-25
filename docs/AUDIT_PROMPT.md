# Prompt: kompletny audyt platformy Pracuj.be

> Skopiuj CAŁĄ treść poniżej (od linii `=== PROMPT ===`) jako polecenie dla modelu-audytora
> (Claude Code / inny agent z dostępem do repozytorium). Prompt jest samowystarczalny: mówi audytorowi,
> gdzie jest kod, jak go uruchomić, co sprawdzić i w jakim formacie zwrócić raport.

---

`=== PROMPT ===`

## Rola i cel

Jesteś **starszym audytorem** aplikacji webowych (staff-level): łączysz kompetencje architekta, inżyniera
bezpieczeństwa (AppSec), specjalisty od dostępności/wydajności/SEO oraz recenzenta kodu. Twoim zadaniem jest
przeprowadzić **kompletny, dowodowy audyt** platformy rekrutacyjnej **Pracuj.be** i dostarczyć raport z listą
ustaleń uszeregowaną wg ważności, z konkretnymi odniesieniami `plik:linia`, scenariuszem błędu i propozycją naprawy.

Pracuj.be to wielojęzyczna (PL/NL/FR/EN) platforma pracy dla Belgii: kandydat tworzy profil zamiast CV,
pracodawca publikuje oferty i wysyła propozycje. Stack: Next.js 15 (App Router, RSC), TypeScript strict,
Tailwind + shadcn/ui, Supabase (Postgres/Auth/Storage/RLS), Zod, React Hook Form, Resend + React Email,
Sentry, Vitest + Playwright, Vercel; CI/CD na self-hosted runnerach.

## Zanim zaczniesz — orientacja (przeczytaj w tej kolejności)

1. `CLAUDE.md` — mapa i kontrakt projektu (architektura, INVARIANTY, roadmapa/status, konwencje). **Kluczowe.**
2. `docs/ARCHITECTURE.md` — decyzje i przepływy.
3. `docs/DESIGN_SCREENS.md` + `docs/design/screens/*.png` — źródło prawdy dla UI (7 makiet, paleta granatowa).
4. `docs/SECURITY_CHECKLIST.md`, `docs/PERFORMANCE_CHECKLIST.md`, `docs/LAUNCH_CHECKLIST.md`.
5. `supabase/migrations/*.sql` (schemat + RLS) i `supabase/seed.sql`.
6. Kod: `src/lib/**` (supabase, matching, i18n, errors, validation, email, actions), `src/app/**`, `src/components/**`, `src/messages/*.json`, `src/emails/**`.
7. `.github/workflows/*.yml` (CI/CD), `docs/SELF_HOSTED_RUNNERS.md`.

**Uruchom i zweryfikuj stan faktyczny (nie zakładaj — sprawdź):**
```
npm install
npm run typecheck        # tsc --noEmit — musi być 0 błędów
npm run lint
npm run test             # Vitest (unit)
npm run build            # next build — musi przejść bez env (fallback demo)
npm run test:e2e         # Playwright (jeśli środowisko pozwala)
```
Zanotuj rzeczywiste wyniki (liczby testów, ostrzeżenia, rozmiary bundli z outputu `next build`).

## Zasady audytu (jakość ponad ilość)

- **Dowodowo.** Każde ustalenie: `plik:linia`, cytat kodu, konkretny scenariusz (wejście/stan → skutek), naprawa.
- **Zero false-positive.** Zanim zgłosisz — potwierdź, że problem jest realny (prześledź ścieżkę wywołania, sprawdź RLS/walidację po stronie serwera, a nie tylko UI).
- **Odróżniaj** błąd krytyczny od kosmetyki. Nie zalewaj raportu drobiazgami lintera.
- **Priorytet: bezpieczeństwo i integralność danych.** Potem zgodność z INVARIANTAMI, potem reszta.
- Sprawdzaj **stan serwera**, nie tylko frontend (blokada przycisku w UI ≠ zabezpieczenie — liczy się egzekwowanie na serwerze/RLS).

## Skala ważności

- **P0 — krytyczny:** wyciek/uszkodzenie danych, obejście RLS, service-role w przeglądarce, RCE/injection, złamanie idempotencji propozycji/aplikacji, e-mail w złym języku odbiorcy, tracking przed zgodą, build/CI niedziałające.
- **P1 — wysoki:** realne luki uprawnień w wąskim scenariuszu, brak walidacji serwerowej, utrata danych formularza, poważny błąd i18n (twarde stringi w krytycznych ścieżkach), poważny błąd SEO (panele indeksowane), a11y blokujące.
- **P2 — średni:** braki wydajnościowe, niepełne pokrycie testami krytycznych ścieżek, rozbieżności z makietami, słabe komunikaty błędów.
- **P3 — niski:** kosmetyka, drobne niespójności, TODO, ulepszenia DX.

## Zakres — sprawdź KAŻDY obszar

### A. Integralność architektury i build
- Czy `typecheck`/`lint`/`test`/`build` faktycznie przechodzą? Czy `strict` i `noUncheckedIndexedAccess` są respektowane (szukaj `any`, `as any`, `@ts-ignore`, `!` non-null)?
- Czy publiczne strony budują się BEZ env (fallback demo działa)? Czy nic nie rzuca przy imporcie z braku env?
- Granica RSC/Client: czy `"use client"` nie jest nadużywane? Czy do klienta nie trafiają sekrety/duże zależności?

### B. Bezpieczeństwo i RLS (NAJWYŻSZY priorytet)
- **RLS włączone na WSZYSTKICH tabelach** z danymi użytkowników? Przejrzyj `supabase/migrations/*rls*.sql` tabela po tabeli. Domyślnie deny?
- Czy polityki faktycznie izolują: kandydat widzi tylko swoje dane; **firma A nie widzi danych firmy B**; członek firmy wymaga aktywnego `company_members`; publikacja oferty wymaga `company_status='verified'`.
- Czy `audit_logs`/`system_events`/`email_deliveries` są niedostępne dla `anon`/`authenticated` (tylko service role)?
- **Service role key**: czy `src/lib/supabase/admin.ts` NIGDY nie jest importowany w kodzie klienckim (prześledź graf importów)? Czy nie ma `NEXT_PUBLIC_...SERVICE_ROLE`?
- Operacje wrażliwe wyłącznie w Server Actions / route handlers z kontrolą uprawnień? Czy sprawdzają rolę i przynależność, a nie ufają danym z klienta?
- Rate limiting formularzy/logowania, ochrona anty-bot, ochrona brute-force. Czy istnieją? Gdzie?
- **Nie ujawniać, czy e-mail istnieje** (reset hasła, rejestracja) — komunikat neutralny.
- Pliki prywatne przez signed URLs (nie publiczne buckety). Walidacja uploadów (typ/rozmiar).
- Nagłówki bezpieczeństwa (CSP, HSTS, X-Frame-Options itd.) — czy skonfigurowane?
- Injection: zapytania budowane bezpiecznie (parametryzacja/Supabase client), brak interpolacji użytkownika do SQL.

### C. INVARIANTY i18n (patrz CLAUDE.md §7) — krytyczne dla tego produktu
- **Język e-maili/powiadomień = język ODBIORCY** wg fallbacku `preferred_locale → account_locale → signup_locale → 'en'`. Zweryfikuj `src/lib/i18n/recipient-locale.ts` ORAZ **każde miejsce wysyłki** — czy nie użyto języka nadawcy/sesji/serwera/przeglądarki? To był realny błąd poprzedniego produktu — sprawdź szczególnie dokładnie.
- **Zero twardych stringów UI** — wszystkie teksty w `src/messages/*.json`. Wyszukaj literały w JSX/komponentach/mailach.
- Czy 4 pliki tłumaczeń mają **identyczny zestaw kluczy** (brak brakujących/nadmiarowych)? Czy test `i18n-keys` to wychwytuje?
- Czy `preferred_locale` jest zapisywane przy rejestracji (z locale URL) i faktycznie używane później?

### D. Idempotencja i integralność danych
- **Propozycje pracy:** czy zapis jest idempotentny (klucz idempotencyjny + `UNIQUE`), transakcyjny, a wysyłka e-maila jest ODDZIELONA (błąd maila NIE usuwa propozycji)? Czy podwójne kliknięcie / retry z tym samym kluczem nie tworzy duplikatu? Czy sprawdzane są: uprawnienia, `company_status`, status oferty?
- **Aplikacje:** `UNIQUE(candidate_id, job_id)` — jedna aplikacja; ponowne kliknięcie bez duplikatu.
- Statusy i historia (`*_status_history`) zapisywane atomowo ze zmianą statusu?
- Kolejka `email_deliveries`: status/attempts/last_error/provider_id — czy ponawianie działa i nie gubi rekordów?

### E. Uwierzytelnianie
- Rejestracja/logowanie/reset/potwierdzenie e-mail — realne (Supabase Auth), nie mock. Callback poprawny.
- Sesja/cookies bezpieczne; wylogowanie czyści sesję. Ochrona tras paneli (redirect niezalogowanych).
- Walidacja Zod po stronie serwera (nie tylko w formularzu).

### F. RODO / cookies / zgody
- **Żadnego trackingu przed zgodą** (Cloudflare Web Analytics/remarketing). Prześledź `src/components/cookies/*` i miejsce ładowania skryptów — czy naprawdę warunkowane zgodą?
- Baner: „Zaakceptuj wszystkie" i „Odrzuć opcjonalne" równorzędne. Kategorie: niezbędne/preferencje/analityczne/marketingowe. Centrum ustawień + wycofanie zgody.
- Zapis zgody: id, data, wersja polityki, kategorie, źródło. Zgodność z tabelą `consents`.

### G. SEO
- Publiczne strony SSR/SSG; treść oferty widoczna bez JS. `title`/`description`/`canonical`/`hreflang`/OpenGraph/`lang` poprawne per locale.
- **JobPosting JSON-LD** na stronie oferty; Article dla poradników. `sitemap.xml` (+ oferty/kategorie/lokalizacje), `robots.txt`.
- **Panele (`candidate`/`employer`/`admin`) i staging = `noindex`** i poza sitemap. Zweryfikuj realnie w wygenerowanym HTML/metadanych.

### H. Wydajność / Core Web Vitals
- Ilość JS na stronach publicznych (z outputu `next build`), code splitting, brak ciężkich bibliotek animacji.
- Obrazy: `next/image`, AVIF/WebP, rozmiary; brak CLS; fonty przez `next/font` (bez FOUT). Prefetch tylko sensowny.
- Cele: Lighthouse Perf ≥90, A11y ≥95, BP ≥95, SEO ≥95 (jeśli możesz — uruchom Lighthouse; jeśli nie — oceń statycznie i wskaż ryzyka).

### I. Dostępność (WCAG 2.2 AA)
- Kontrast (zwłaszcza granat/biały, akcenty). Focus widoczny. Nawigacja klawiaturą. Etykiety pól, `aria-*`, role. Semantyka nagłówków. `prefers-reduced-motion`. Modale: focus trap + Esc. Cel dotykowy ≥24px.

### J. Baza danych i migracje
- Zgodność schematu z modelem z CLAUDE.md §5. UUID PK, `created_at/updated_at` + trigger, `deleted_at` gdzie trzeba, FK + poprawne `ON DELETE`, indeksy pod filtry ofert, unikalności (idempotency, candidate+job), CHECK/enumy statusów.
- Czy migracje aplikują się czysto po kolei? Czy seed jest spójny z FK i oznaczony `is_demo`?

### K. Obsługa błędów
- Centralny system (`src/lib/errors`) z kodami; mapowanie na klucze i18n. **Użytkownik nigdy nie widzi** stack trace/SQL/surowej odpowiedzi API/komunikatu dostawcy.
- Formularze: blokada przycisku podczas zapisu, brak podwójnego submitu, zachowanie danych po błędzie, błędy przy polach, przewinięcie do pierwszego błędu, jasny sukces. Integracja z Sentry (bez PII).

### L. E-maile
- Szablony PL/NL/FR/EN dla wszystkich typów (spec §22). Renderowanie w języku odbiorcy. Log wysyłki (odbiorca, typ, język, rekord, status, próby, provider_id, last_error, data). Responsywność, jeden CTA, bez ciężkich grafik.

### M. Matching
- Deterministyczny scoring 100 pkt wg wag (zawód/kategoria 20, umiejętności 20, lokalizacja 15, doświadczenie 10, dostępność 10, język 10, certyfikaty 5, transport 5, umowa 5). Zwraca matched/missing/strengths + wymagania obowiązkowe + wyjaśnienie. Brak niekontrolowanego AI w decyzjach. Testy pokrywają przypadki brzegowe.

### N. Testy
- Pokrycie krytycznych ścieżek: języki (e-mail w języku odbiorcy), propozycje (idempotencja, retry, błąd maila nie usuwa rekordu, ponowna wysyłka), aplikowanie (brak duplikatu), cookies (brak analityki przed zgodą), bezpieczeństwo (izolacja kandydatów/firm, brak dostępu do admina), SEO (oferta bez JS, JSON-LD, noindex paneli). Wskaż luki.

### O. Zgodność z makietami (`docs/DESIGN_SCREENS.md`)
- Paleta: primary granat `#0F2A47`, akcent niebieski `#2563EB`, statusy wg mapy kolorów. Czy tokeny w `globals.css`/`tailwind.config.ts` są zgodne (a nie stara jasnoniebieska paleta)?
- Odwzorowanie 7 ekranów (home, lista+filtry, detal+modal, panel kandydata, panel pracodawcy, onboarding 6 kroków, stany). Wskaż braki/rozbieżności. (Uwaga: makiety są pionowo rozciągnięte — proporcje mają być normalne.)

### P. Jakość kodu
- Spójność konwencji (CLAUDE.md §13), brak martwego kodu, sensowne granice modułów, brak duplikacji, czytelność. Walidacja I/O przez Zod. Brak sekretów w repo.

### Q. CI/CD self-hosted
- `.github/workflows/*` używają `runs-on: [self-hosted, linux, x64]`; joby (lint/typecheck/unit/build/e2e) poprawne; cache; brak wycieku sekretów; bezpieczeństwo runnerów (forki). Deploy staging/prod rozdzielony.

### R. Zgodność ze specyfikacją produktu (35 sekcji)
- Zmapuj zaimplementowane vs brakujące funkcje względem specyfikacji (strony publiczne, panele, kreator oferty, wiadomości, powiadomienia, admin, płatności, PWA, poradniki). Wskaż, co jest realne, co scaffold, czego brak — porównaj z roadmapą w CLAUDE.md §11 i zweryfikuj, czy status jest zgodny z rzeczywistością.

## Format raportu (dostarcz dokładnie to)

1. **Executive summary** (≤15 zdań): ogólny stan, gotowość produkcyjna (tak/nie/warunkowo), 5 najważniejszych ryzyk.
2. **Wyniki komend** (typecheck/lint/test/build/e2e) — realne liczby i ostrzeżenia.
3. **Tabela ustaleń** posortowana P0→P3, kolumny: ID · Ważność · Obszar · Plik:linia · Opis · Scenariusz błędu · Rekomendacja.
4. **Szczegóły P0/P1** — dla każdego: dowód (cytat kodu), dlaczego to realny problem, krok po kroku naprawa (najlepiej z propozycją diffu).
5. **Macierz zgodności ze specyfikacją** (35 sekcji + INVARIANTY §7 z CLAUDE.md): ✅/⚠️/❌ + komentarz.
6. **Ocena per obszar A–R**: 0–5 + uzasadnienie.
7. **Plan naprawczy** uszeregowany wg (ważność × koszt), z „quick wins".

## Twarde reguły
- Nie zmyślaj. Jeśli czegoś nie dało się zweryfikować (np. brak środowiska do e2e/Lighthouse) — napisz to wprost i oznacz jako „niezweryfikowane".
- Nie proponuj przepisania całości — proponuj **konkretne, minimalne** poprawki.
- Cytuj `plik:linia`. Preferuj konkret nad ogólnikami.
- Jeśli robisz zmiany w kodzie (gdy zlecono naprawę) — nie łam INVARIANTÓW z CLAUDE.md i po każdej zmianie uruchom `npm run verify`.

`=== KONIEC PROMPTU ===`
