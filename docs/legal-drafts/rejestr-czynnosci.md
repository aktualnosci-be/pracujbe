# Rejestr czynności przetwarzania — szkic roboczy

> **PROJEKT — do weryfikacji prawnika, nieopublikowany.**
> Wersja robocza 0.1 (2026-09-24), przygotowana do #485. To nie jest porada prawna ani gotowy
> rejestr z art. 30 RODO. Fakty techniczne pochodzą z kodu repozytorium i odsyłają do
> [`data-map.generated.md`](data-map.generated.md) (generowana z migracji: tabele, kolumny,
> kategorie, usługi zewnętrzne, zakres danych w e-mailach). Wszystko, czego nie da się ustalić
> z repozytorium, jest oznaczone **„do ustalenia przez właściciela/prawnika”**.
> Treść nie trafia do UI ani do polityki prywatności (#61) przed zatwierdzeniem.

## Jak czytać ten dokument

- **Z kodu** — to, co portal robi dziś technicznie (z odnośnikiem do pliku).
- **Do ustalenia** — decyzja prawna lub organizacyjna. Kolumna „Właściciel decyzji” wskazuje,
  kto ją podejmuje; nazwiska i daty wpisuje właściciel.
- Identyfikatory czynności (`account`, `applications`…) są te same co w
  `src/lib/privacy/data-map.ts` i w mapie danych.
- Zmiana schematu bez klasyfikacji zatrzymuje test `tests/unit/privacy-data-map.test.ts`;
  mapę odświeża `node scripts/privacy/data-map.mjs`. Ten szkic trzeba wtedy przejrzeć ręcznie.

## 1. Administrator i kontakt

| Pole | Wartość |
|---|---|
| Administrator (osoba prawna, adres, numer rejestrowy) | do ustalenia przez właściciela/prawnika |
| Przedstawiciel / inspektor ochrony danych (czy wymagany) | do ustalenia przez właściciela/prawnika |
| Kontakt w sprawach danych osobowych | do ustalenia przez właściciela/prawnika |
| Organ nadzorczy właściwy | do ustalenia przez właściciela/prawnika |
| Właściciel przeglądu rejestru i częstotliwość | do ustalenia przez właściciela |

## 2. Role: portal i pracodawca — fakty do rozstrzygnięcia

Kod pokazuje, **kto technicznie ma dostęp** do danych. Nie rozstrzyga, kto jest administratorem,
współadministratorem czy podmiotem przetwarzającym — to decyzja do ustalenia przez
właściciela/prawnika dla każdego przykładu poniżej.

| Przykład | Co robi kod | Rola portalu | Rola pracodawcy |
|---|---|---|---|
| **Profil widoczny dla firmy** | Kandydat włącza widoczność (`is_searchable`) tylko przy ukończonym profilu (`set_candidate_searchable`, 0029). Profil widzi członek firmy o statusie `verified`, chyba że kandydat zablokował firmę (polityka `candidate_profiles_select_employer`, 0078). | do ustalenia | do ustalenia |
| **Aplikacja** | Kandydat lub gość wysyła aplikację (`apply_to_job`, `confirm_guest_application`). Dane aplikacji (wiadomość, telefon, dostępność, odpowiedzi screeningowe) i profil kandydata widzą aktywni członkowie firmy z rolą owner/admin/recruiter (`company_can_view_candidate`, 0078; 0039). E-mail do tych osób zawiera imię i nazwisko kandydata oraz tytuł oferty (sekcja 4 mapy). | do ustalenia | do ustalenia — m.in. czy po otrzymaniu aplikacji pracodawca staje się odrębnym administratorem |
| **CV** | Plik leży w prywatnym buckecie; polityki pozwalają operować tylko właścicielowi (0018, `files_select`: właściciel albo plik publiczny). W schemacie nie ma dziś ścieżki pobrania CV przez firmę — model udostępniania to otwarty punkt P1-02 (CLAUDE.md). | do ustalenia | do ustalenia, zanim powstanie dostęp firmy do CV |
| **Dalsza rekrutacja** | Statusy aplikacji, propozycje pracy i wiadomości zapisywane w bazie portalu (`transition_application`, `send_offer`, `send_message`). Co pracodawca robi z danymi poza portalem — kod tego nie obejmuje. | do ustalenia | do ustalenia |
| **Usunięcie konta** | Brak funkcji eksportu i usunięcia konta (P1-17 otwarte, CLAUDE.md). W schemacie: `profiles` ma soft delete; usunięcie wiersza `profiles` kaskadowo usuwa m.in. aplikacje, propozycje i dopasowania kandydata (`on delete cascade`, 0005), a w wiadomościach, plikach, zgłoszeniach i audycie zeruje autora (`on delete set null`). Dane skopiowane do e-maili już wysłanych i do kopii zapasowych nie są objęte. | do ustalenia | do ustalenia — co z danymi, które firma już otrzymała |

Umowa między portalem a pracodawcą (powierzenie, udostępnienie, uzgodnienia współadministratorów):
**do ustalenia przez właściciela/prawnika**.

## 3. Czynności przetwarzania

Wspólne dla wszystkich czynności — podstawa z art. 6 RODO, test niezbędności/wyważenia,
okres retencji docelowej, transfery poza EOG i sposób realizacji praw osób:
**do ustalenia przez właściciela/prawnika**, chyba że wiersz mówi inaczej. „Retencja w kodzie”
opisuje wyłącznie to, co kod faktycznie usuwa lub wygasza.

Pola swobodne (`candidate_profiles.bio`, `applications.message`, `messages.body`,
`guest_application_requests.message`, odpowiedzi tekstowe screeningu, `reports.details`) oraz
treść CV nie mają filtra treści. Mogą więc zawierać dane z art. 9 lub 10 RODO wpisane przez
użytkownika. Ocena tego ryzyka i reguły postępowania: **do ustalenia przez prawnika**.

| ID | Czynność | Z kodu: dane i osoby | Z kodu: odbiorcy wewnątrz portalu | Usługi zewnętrzne | Retencja w kodzie | Zabezpieczenia w kodzie | Podstawa (art. 6/9/10) | Właściciel decyzji |
|---|---|---|---|---|---|---|---|---|
| `account` | Konto i uwierzytelnianie | Imię, nazwisko, e-mail, telefon, zdjęcie, rola, języki, skrót hasła, sesje z IP i User-Agent (`auth.*`, `profiles`) | Sam użytkownik; administratorzy przez serwer | Railway, Supabase, Resend, Cloudflare Turnstile | Sesje i weryfikacje wygasają (`expires_at`); konta nie są usuwane automatycznie | Better Auth, limiter, Turnstile na formularzach, RLS | do ustalenia | właściciel + prawnik |
| `candidate-profile` | Profil zawodowy kandydata | Miasto, region, promień, doświadczenie, dostępność, zawody, umiejętności, języki, certyfikaty z datami, prawo jazdy, oczekiwana pensja, opis | Kandydat; firmy `verified` przy widocznym profilu; firmy z relacją (aplikacja/propozycja) | Railway, Supabase | Brak | RLS, zapis tylko przez RPC (0028, 0029), blokady firm | do ustalenia | właściciel + prawnik |
| `cv-files` | Pliki CV | Plik PDF/DOC/DOCX, nazwa, rozmiar, suma SHA-256 | Tylko właściciel pliku (brak ścieżki dla firmy) | Supabase (Storage), Railway | Usunięcie przez właściciela | Prywatny bucket, podpisane URL-e 60 s, limit 5 MB, kontrola typu i magic bytes | do ustalenia | właściciel + prawnik |
| `applications` | Aplikacje na oferty | Wiadomość, telefon, dostępność, odpowiedzi screeningowe, status i historia, wynik dopasowania | Kandydat; owner/admin/recruiter firmy oferty | Railway, Supabase, Resend | Brak | RPC-only DML (0025), macierz statusów (0039), idempotencja | do ustalenia | właściciel + prawnik |
| `guest-applications` | Aplikacja bez konta | Imię i nazwisko, e-mail, telefon, wiadomość, odpowiedzi, snapshot zgody z IP i User-Agent | Gość (przez link); firma po potwierdzeniu | Railway, Supabase, Resend, Cloudflare Turnstile | Niepotwierdzone 7 dni, duplikaty 7 dni, token przejęcia 30 dni (`purge_guest_application_requests`) | Tylko hash tokenu w bazie, limity IP/adres, Turnstile | do ustalenia (retencja do potwierdzenia w polityce — #40) | właściciel + prawnik |
| `matching-search` | Dopasowanie i zapisane wyszukiwania | Wynik i uzasadnienie dopasowania, filtry wyszukiwań, alerty | Kandydat; firma — dopasowania w granicach widoczności | Railway, Supabase, Resend | Brak | Deterministyczny scoring bez AI (`src/lib/matching`) | do ustalenia | właściciel + prawnik |
| `employer-contact` | Kontakt pracodawca–kandydat | Propozycje z wiadomością, rozmowy, treść wiadomości, blokady firm | Strony rozmowy (aktywni członkowie firmy) | Railway, Supabase, Resend | Propozycje wygasają; brak usuwania | Aktywne członkostwo wymagane (0027), idempotentna wysyłka | do ustalenia | właściciel + prawnik |
| `companies` | Konta firm, zespół i weryfikacja | Dane firmy (nazwa, VAT, adres, e-mail, telefon), członkowie i role, zaproszenia e-mail, wyniki VIES | Członkowie firmy; administratorzy | Railway, Supabase, Resend, VIES | Zaproszenia wygasają po 14 dniach (bez usuwania) | Hierarchia ról (0086), audyt | do ustalenia | właściciel + prawnik |
| `email-notifications` | E-maile i powiadomienia | Adres, temat, payload szablonu, status doręczenia, blokady po odbiciach/skargach | Odbiorca; administratorzy (blokady) | Resend, Railway, Supabase | Brak dla `email_deliveries` (retencja odłożona); okna budżetu 1 dzień | Język odbiorcy, opt-out, wypisanie (RFC 8058), ponowna kontrola zgody przed wysyłką | do ustalenia | właściciel + prawnik |
| `consents` | Zgody cookies i akceptacja dokumentów | Kategoria i wersja zgody, identyfikator odwiedzającego, IP, User-Agent | Administratorzy przez serwer | Railway, Supabase | Brak; cookie zgody 180 dni | Zapis tylko przez RPC `record_consent` (0043) | do ustalenia | właściciel + prawnik |
| `dsa-moderation` | Zgłoszenia treści i moderacja | Dane zgłaszającego, opis, snapshot treści, decyzje z uzasadnieniem | Zgłaszający (numer + kod); administratorzy; właściciele firmy (uzasadnienie) | Railway, Supabase, Resend, Cloudflare Turnstile | Brak | Kod dostępu jako SHA-256, niezmienność wpisów | do ustalenia (także terminy z DSA — #40) | właściciel + prawnik |
| `security-audit` | Bezpieczeństwo, audyt, limity, logi | Dziennik audytu z IP/User-Agent i kopiami pól, klucze limitera, zdarzenia systemowe, kody błędów | Administratorzy | Railway, Supabase, Sentry | Brak dla audytu i limitera; `processed_webhooks_gc` istnieje, ale nie jest wywoływana | Redakcja zdarzeń Sentry, HMAC w limiterze PostgreSQL | do ustalenia | właściciel + prawnik |
| `ai-job-import` | Import ogłoszenia przez AI | Tekst ogłoszenia po redakcji kontaktów i identyfikatorów albo zrzut ekranu bez redakcji | Pracodawca (szkic) | Anthropic, Railway, Supabase | Portal nie zapisuje wejścia, tylko szkic | Flaga domyślnie wyłączona, limity per firma, bez publikacji | do ustalenia — patrz [dostawcy-i-transfery.md](dostawcy-i-transfery.md) | właściciel + prawnik |
| `job-statistics` | Statystyki ofert | Liczniki per oferta i dzień, bez identyfikatora osoby | Recruiter+ firmy | Railway, Supabase | Nonce deduplikacji 2 dni | Bez IP i cookies, filtr botów | do ustalenia, czy to w ogóle dane osobowe | właściciel + prawnik |
| `analytics-marketing` | Analityka i marketing | Zakres ustala skrypt dostawcy (GA, Meta Pixel) | — | Google Analytics, Meta Pixel | Cookie zgody 180 dni; wycofanie usuwa cookies | Ładowanie wyłącznie po zgodzie (Invariant #7) | do ustalenia | właściciel + prawnik |
| `backups` | Kopie zapasowe | Pełny zrzut bazy | Osoby z kluczem age | Railway (miejsce kopii do ustalenia) | 14 najnowszych kopii (domyślnie) | Szyfrowanie age, weryfikacja odtworzenia | do ustalenia | właściciel + prawnik |
| `billing-disabled` | Płatności | Brak aktywnego przepływu | — | Stripe (wyłączony) | — | Flaga `BILLING_ENABLED` domyślnie wyłączona | nie dotyczy do czasu włączenia | właściciel |

### Czynności z zakresu #485, których kod dziś nie wykonuje

| Czynność | Stan w repozytorium |
|---|---|
| Tłumaczenia treści przez AI | Brak w kodzie; plan w `docs/AI_MULTILINGUAL_PLAN.md`. Przed wdrożeniem nowy wpis i ocena dostawcy. |
| Autouzupełnianie profilu / import CV przez AI | Brak w kodzie. Import AI dotyczy wyłącznie ogłoszeń pracodawcy. Użycie danych kandydata wymaga osobnej oceny (#487, #488). |
| Eksport i usunięcie danych na żądanie | Brak (P1-17). |

## 4. Prawa osób — stan techniczny

| Prawo | Co jest w kodzie | Do ustalenia |
|---|---|---|
| Dostęp / kopia danych | Użytkownik widzi swoje dane w panelu; brak eksportu | procedura i termin |
| Sprostowanie | Edycja profilu, onboardingu, danych firmy | zakres dla danych już przekazanych firmie |
| Usunięcie | Usunięcie pliku CV; brak usuwania konta | procedura, wpływ na aplikacje, e-maile i kopie |
| Sprzeciw / wycofanie zgody | Centrum zgód cookies, wypisanie z e-maili, ukrycie profilu, blokada firmy | pozostałe czynności |
| Kontakt z administratorem | — | kanał i osoba |

## 5. Otwarte decyzje (lista kontrolna)

- [ ] Administrator, kontakt, ewentualny IOD (sekcja 1).
- [ ] Role portalu i pracodawcy dla czterech przykładów (sekcja 2).
- [ ] Podstawa z art. 6 osobno dla każdej czynności; test niezbędności/wyważenia dla art. 6(1)(b)/(f).
- [ ] Ocena art. 9/10 dla pól swobodnych i CV.
- [ ] Retencja docelowa każdej czynności, także `email_deliveries`, audytu, limitera i kopii.
- [ ] Umowy z usługami zewnętrznymi i transfery — [dostawcy-i-transfery.md](dostawcy-i-transfery.md).
- [ ] Przekazanie zatwierdzonego rejestru do #61 (informacje o prywatności) i #36 (bramki produkcyjne).
