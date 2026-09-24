# Kryteria i procedura wydania 1.0.0

Dokument opisuje, kiedy Pracuj.be może dostać wersję `1.0.0` i jak ją wydać
(issue #103). Opiera się na stanie repozytorium z 24 września 2026, sekcji 11
`CLAUDE.md`, `docs/railway/STATUS.md` i otwartych issues. Nie jest decyzją o
wydaniu: `1.0.0` wymaga jawnej decyzji właściciela (§4, krok 1).

Do tego czasu każdy build ma automatyczną wersję `0.YYYYMMDD.M+SHA`
(`docs/DEPLOYMENT.md` → „Wersja widoczna w stopce”).

Powiązane: [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) (pełna lista
operacyjna, sekcja 15 = odbiór 1.0), [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md),
[`PERFORMANCE_CHECKLIST.md`](./PERFORMANCE_CHECKLIST.md),
[`railway/MIGRACJE_POSTGRESQL.md`](./railway/MIGRACJE_POSTGRESQL.md),
[`railway/BACKUP_RESTORE.md`](./railway/BACKUP_RESTORE.md).

Legenda: `[ ]` do sprawdzenia · `[x]` potwierdzone na produkcji Railway.
Zielony test w CI nie jest potwierdzeniem produkcji — punkty zaznacza się
dopiero po sprawdzeniu na wdrożonym SHA.

---

## 1. Checklisty

### 1.1 Bezpieczeństwo

Szczegóły: `SECURITY_CHECKLIST.md`. Dla 1.0 wymagane są co najmniej:

- [ ] `SECURITY_CHECKLIST.md` przejrzana pod kątem Railway; punkty odnoszące się
      do Supabase zastąpione odpowiednikami PostgreSQL/Better Auth albo oznaczone
      jako nieaktualne po #27.
- [ ] Invarianty 5–8 i 10 z `CLAUDE.md` §7 sprawdzone na produkcji: kontrola
      dostępu do danych w bazie, brak kluczy uprzywilejowanych w bundlu klienta,
      zero trackingu przed zgodą, brak technikaliów w komunikatach, prywatne pliki
      tylko przez podpisane adresy.
- [ ] Job `rls` (PostgreSQL 16) zielony dla wydawanego SHA; testy kontroli dostępu
      obejmują warstwę danych Railway (#25).
- [ ] Job `sca` zielony: brak podatności high/critical w zależnościach.
- [ ] Sekrety runtime tylko jako zmienne Railway, osobne na każdy endpoint cron
      (#13); brak sekretów w repozytorium i logach.
- [ ] Nagłówki bezpieczeństwa (CSP, HSTS, nosniff, referrer-policy,
      frame-ancestors) obecne na domenie produkcyjnej.
- [ ] Ochrona formularzy publicznych przed botami — #46 (albo jawne odłożenie).
- [ ] Znane otwarte ustalenia bezpieczeństwa rozpatrzone przez właściciela.
      Szczegóły podatności nie trafiają do tego dokumentu ani publicznych issues.

### 1.2 Dane i migracje (Railway PostgreSQL)

- [ ] Bootstrap pustej bazy i migracje — #23: `npm run db:migrate:production`
      stosuje bootstrap, historię domeny i migracje auth w jednej transakcji
      z kontrolą sum; ponowne uruchomienie nie zmienia bazy.
- [ ] Konta i sesje bez Supabase Auth — #24.
- [ ] Warstwa danych i kontrola dostępu bez PostgREST — #25; prywatne panele
      czytają i zapisują przez PostgreSQL, nie przez starego dostawcę.
- [ ] Prywatne CV bez Supabase Storage — #26; upload i pobranie przez prywatny
      bucket Railway sprawdzone zalogowanym kontem.
- [ ] Odbiór pełnego zastąpienia Supabase i cleanup — #27.
- [ ] Gotowość produkcyjna liczona według PostgreSQL, nie Supabase — #429:
      `APP_MODE=production` bez Supabase nie daje 503, a `/api/health`
      odzwierciedla realną dostępność bazy (healthcheck Railway).
- [ ] Loginy runtime zgodne z `railway/LOGINY_POSTGRESQL_ONE_OFF.md`; pule nie
      używają superusera ani właściciela bazy.
- [ ] Backup i próbny restore wykonane według `railway/BACKUP_RESTORE.md` — #47.
- [ ] Brak danych demonstracyjnych na produkcji (`is_demo = true` → 0 wierszy;
      Invariant #12); seed nie był uruchamiany na bazie produkcyjnej.
- [ ] Rollback opisany w `DEPLOYMENT.md` przećwiczony dla kodu; brak
      destrukcyjnego cofania schematu.

### 1.3 E-mail

- [ ] Wysyłka e-maili auth przez outbox na Railway — #78.
- [ ] Webhooki doręczeń, bounce, complaint i lista suppression — #44.
- [ ] Zgody, wypisanie i budżety wysyłki — #45 (albo jawne odłożenie).
- [ ] Cron wywołujący `/api/email/process` działa na Railway
      (`RESEND_SETUP.md` §6); kolejka `email_deliveries` nie narasta.
- [ ] Domena nadawcy zweryfikowana (SPF/DKIM/DMARC) — `RESEND_SETUP.md`.
- [ ] Invariant #1 na produkcji: aplikacja, zmiana statusu, propozycja i
      wiadomość docierają w języku **odbiorcy** przy nadawcy w innym języku.
- [ ] Retencja zakończonych dostaw zaplanowana — #17.

### 1.4 Dostępność

- [ ] Bramki axe w jobie `e2e` zielone dla wydawanego SHA (`a11y`,
      `a11y-public-routes`, `panel-a11y`, `admin-a11y`) — WCAG 2.x A/AA,
      bez naruszeń critical/serious.
- [ ] Ręczna kontrola klawiaturą i czytnikiem ekranu kluczowych przepływów:
      lista ofert → szczegół → aplikacja, rejestracja, onboarding, kreator oferty.
- [ ] Nowa identyfikacja wizualna wdrożona i sprawdzona pod kątem kontrastu — #5,
      #6, #7.

### 1.5 Wydajność

- [ ] Cele z `PERFORMANCE_CHECKLIST.md` §1 zmierzone na produkcji (Lighthouse
      mobile) dla strony głównej, listy ofert, szczegółu oferty i poradnika.
- [ ] Bramka wydajności w CI — #395 (albo jawne odłożenie z pomiarem ręcznym).
- [ ] Core Web Vitals mierzone mechanizmem produkcyjnym (`LAUNCH_CHECKLIST.md` §10).
- [ ] Strony publiczne serwowane statycznie/ISR zgodnie z `CLAUDE.md` §11
      (Etap 8), strażnik `public-cache-headers` zielony.

### 1.6 SEO

- [ ] Domena `pracuj.be` na Railway, SSL, jedna wersja kanoniczna — #18,
      `DOMAIN_SETUP.md`.
- [ ] `robots.txt` i `sitemap.xml` w wariancie produkcyjnym; panele, auth i
      strony prawne-placeholdery poza indeksem (Invariant #9).
- [ ] `hreflang` i canonical dla PL/NL/FR/EN.
- [ ] JobPosting JSON-LD na realnych ofertach, Article na poradnikach; brak
      JobPosting dla ofert demo.
- [ ] Google Search Console: domena zweryfikowana, sitemap zgłoszona.
- [ ] Strony Pomoc, Kontakt i Polityka prywatności opublikowane — #61. Treść
      prawną zatwierdza właściciel; ten dokument jej nie określa.

### 1.7 CI i wdrożenie

- [ ] Railway `production` wdrażana z `main` z `Wait for CI` — #14, #15.
- [ ] Odbiór produkcji i integracji — #16.
- [ ] Pełny przepływ kandydat ↔ pracodawca pod prawdziwymi sesjami i PostgreSQL
      w E2E — #351 (oraz onboarding — #66).
- [ ] Flaki E2E widoczne, nie maskowane ponowieniami — #375.

---

## 2. Blokery wydania 1.0.0

Propozycja klasyfikacji na podstawie priorytetów w tytułach issues. Ostateczną
listę zatwierdza właściciel w decyzji o wydaniu; odłożenie blokera wymaga
wpisu w tej decyzji.

### 2.1 Blokery (muszą być zamknięte)

| obszar | issues |
|---|---|
| Infrastruktura Railway | #11, #12, #13, #14 (P0) · #15, #16, #18 (P1) |
| PostgreSQL zamiast Supabase | #23, #24, #25 (P0) · #26, #27, #429 (P1) |
| Poczta | #78, #44 (P0) |
| Zakres bezpłatnego MVP | #51 (P0) |
| Obowiązki platformy i moderacja | #40, #41, #42 (P0) |
| Operacje | #47 (P1: czujki, backup/restore) |
| Weryfikacja przepływów | #351 (P1) |
| Strony informacyjne i prawne | #61 (P1; treść zatwierdza właściciel) |
| Identyfikacja wizualna | #7 (etap wdrożenia nowej marki) |

### 2.2 Do potwierdzenia przez właściciela

- #50 i #10 — dotyczą dawnego self-hosted CI; od 2026-09-23 CI działa na
  `ubuntu-latest`. Do zamknięcia albo aktualizacji zakresu.
- #90 (P0: pierwsze zweryfikowane firmy i oferty) — warunek biznesowy premiery,
  nie techniczny warunek builda.
- #43, #45, #46, #17, #395, #375, #66, #5, #6 — wymagane albo jawnie odłożone.

### 2.3 Poza zakresem 1.0 (nie blokują)

Funkcje i usprawnienia bez wpływu na kryteria z §1: #19, #20 (Railway po
okresie stabilności), #29–#38 (AI i tłumaczenia), #91–#101 (rozwój produktu),
#403, #310, #186, #181, #175, #127, #73, #376.

Issues zamknięte w kodzie, ale nadal otwarte na GitHubie (np. #97, #188 — opisane
jako zrobione w `CLAUDE.md` §11) należy zweryfikować i zamknąć przed decyzją.

---

## 3. Mechanizm wersji

`PRACUJBE_RELEASE_VERSION` to jedyne wejście, które może zmienić wersję builda
(`scripts/build-version.mjs`, `docs/DEPLOYMENT.md`):

- brak zmiennej albo pusta wartość → `0.YYYYMMDD.M+SHA` (major 0);
- dokładnie `1.0.0` → `1.0.0+SHA`; bez prawidłowego SHA build się przerywa;
- każda inna wartość → build kończy się błędem z nazwą zmiennej i listą
  dozwolonych wartości;
- `package.json` nie jest źródłem wersji.

Stopka po premierze: `v1.0.0+<8 znaków SHA> · <data buildu>`. Test E2E stopki
(`tests/e2e/smoke.spec.ts`) akceptuje tylko te dwa formaty, sprawdza format
daty buildu oraz — w CI — że SHA w stopce to `GITHUB_SHA` przebiegu.

Kolejna wersja (np. `1.0.1`) wymaga dopisania jej do `APPROVED_RELEASE_VERSIONS`
w osobnym PR.

---

## 4. Procedura wydania

1. **Decyzja właściciela.** Komentarz właściciela w issue wydania (albo wpis
   w `docs/railway/DECYZJE.md`) z listą zamkniętych i jawnie odłożonych blokerów
   z §2. Zapisz link.
2. **Changelog.** PR do `main` przenoszący treść z `## [Unreleased]` do
   `## [1.0.0] — RRRR-MM-DD` w `CHANGELOG.md` (opis zmian dla użytkowników
   i operatorów, bez szczegółów podatności) i zostawiający pustą sekcję
   `## [Unreleased]`.
3. **Zamrożenie commita.** Wydawanym SHA jest commit na `main` zawierający
   ten wpis, dla którego wszystkie joby `ci.yml` są zielone. Zapisz link do
   przebiegu CI.
4. **Zmienna builda.** W Railway `production` ustaw
   `PRACUJBE_RELEASE_VERSION=1.0.0` i wdroż wydawany SHA (redeploy tego SHA,
   bez nowego commita).
5. **Zgodność SHA.** Sprawdź, że:
   - wdrożenie Railway wskazuje wydawany SHA (zapisz link do wdrożenia);
   - stopka na `https://pracuj.be` pokazuje `v1.0.0+` i pierwsze 8 znaków
     tego SHA;
   - `GET /api/health` zwraca `{"status":"ok"}`.
6. **Tag.** Na dokładnie tym SHA utwórz i wypchnij adnotowany tag:

   ```bash
   git fetch origin main
   git tag -a v1.0.0 <SHA> -m "Pracuj.be 1.0.0"
   git push origin v1.0.0
   ```

   Tag nie może wskazywać innego commita niż wdrożony. Nie przesuwaj tagu po
   wypchnięciu; błąd naprawia kolejna wersja.
7. **Odbiór.** Uzupełnij `LAUNCH_CHECKLIST.md` §15 linkami: decyzja
   właściciela, zielone CI, wdrożenie z SHA, tag. Zamknij issue wydania.
8. **Po wydaniu.** Kolejne buildy z `main` przy ustawionej zmiennej mają
   `1.0.0+<nowy SHA>`. Nowa wersja (`1.0.1`, `1.1.0`) wymaga PR z wpisem
   w `APPROVED_RELEASE_VERSIONS`, sekcją w `CHANGELOG.md` i tą samą procedurą.

### Wycofanie

- Błędny build z `1.0.0`: przywróć poprzednie wdrożenie w Railway albo usuń
  zmienną i wdroż ponownie — stopka wraca do `0.YYYYMMDD.M+SHA`.
- Tag wypchnięty przed potwierdzeniem kroku 5: nie usuwaj go po cichu —
  opisz sytuację w issue wydania i ustal z właścicielem dalsze kroki.
