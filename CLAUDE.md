# CLAUDE.md — Pracuj.be

> **Przeznaczenie tego pliku.** To jest mapa i kontrakt projektu dla kolejnych modeli
> (Claude Code / inne LLM) oraz ludzi kontynuujących pracę. Zanim cokolwiek zmienisz —
> przeczytaj ten plik w całości. Opisuje: czym jest produkt, jak zbudowana jest aplikacja,
> jakie są niezmienne reguły (invariants), co jest już zrobione, a co pozostaje do zrobienia
> (roadmapa etapów 1–8 ze specyfikacji).

---

## 0. TL;DR dla modelu kontynuującego pracę

Railway jest jedynym docelowym hostingiem: jedna usługa `production` wdrażana
z `main`, z włączonym natywnym `Wait for CI`. Plan, issues i instrukcje są w
`docs/railway/README.md` oraz `docs/railway/STATUS.md`. `APP_MODE=production`
ustaw jawnie w Railway; `VERCEL_ENV` nie wybiera trybu aplikacji. Pozostałości
Vercela usuwaj dopiero razem z zastępującym je przepływem migracyjnym.
Blokery startu (kod vs właściciel/infra/prawnik, stan 27.09.2026: produkcja na migracji 0148,
brak usług cron — zastępczy Worker Cloudflare gotowy, niewdrożony — tryb demo za
bramką hasła): `docs/LAUNCH_CHECKLIST.md` §1.
**Decyzja produktowa: portal ogłoszeniowy (#1128)** (28.09.2026). Pracuj.be publikuje oferty,
a kandydat aplikuje bezpośrednio u ogłoszeniodawcy. Funkcje rekrutacyjne (aplikowanie przez
portal, matching, profile/CV dla firm, propozycje, wiadomości, screening) są wyłączone
fail-closed — nie włączaj ich „przy okazji” (Invariant #13, `docs/PRODUCT_DECISIONS.md`,
lista kontrolna `docs/LAUNCH_CHECKLIST.md` §1c).

1. **Stack:** Next.js 15 (App Router, React Server Components) · TypeScript `strict` · Tailwind + shadcn/ui · PostgreSQL Railway · Better Auth · Zod · React Hook Form · Resend + React Email · webhook błędów Discord · Vitest + Playwright · Railway.
2. **CI działa na GitHub-hosted runnerach (`ubuntu-latest`, decyzja właściciela 2026-09-23; repo publiczne, minuty darmowe — 2026-09-27); wdrożenie prowadzi natywna integracja Railway** (patrz `.github/workflows/*`, `docs/DEPLOYMENT.md` i sekcja „CI/CD" niżej). Nie wypychaj pustych commitów ani push-ów „na odświeżenie”.
3. **Niezmienne reguły (NIGDY nie łam):** patrz sekcja „Invariants". Najważniejsze: język e-maili = język odbiorcy; wysyłka propozycji idempotentna; brak service-role key w przeglądarce; brak trackingu przed zgodą; RLS na wszystkim; żadnych tekstów UI na sztywno.
4. **Gdzie co jest:** patrz „Struktura katalogów".
5. **Co dalej:** patrz „Roadmapa / status" — sekcja z checkboxami. Wybierz kolejny niezaznaczony punkt.
6. **Zawsze uruchom przed commitem:** `npm run verify` (lint + typecheck + unit). E2E gdy dotykasz przepływów.
7. **Praca wieloma sesjami:** prace idą równolegle w wielu sesjach Claude Code, a jedna
   sesja-integrator scala PR-y, prowadzi kolejkę migracji i rutyny. Podręcznik (role,
   stałe decyzje właściciela, procedura scalania, kolejka migracji, szablon sesji,
   Railway): `.claude/skills/integration-loop/SKILL.md`. Sesja potomna: nie scalaj,
   migracja na numerze tymczasowym, ostateczny nada integrator.

---

## 1. Produkt

**Pracuj.be** — lekki, wielojęzyczny portal ogłoszeń o pracę (decyzja produktowa: portal
ogłoszeniowy, #1128), przede wszystkim dla osób
szukających pracy w **Belgii** i belgijskich pracodawców. Grupa docelowa: Polacy w Belgii,
obcokrajowcy, pracownicy fizyczni/techniczni/produkcja/magazyn/kierowcy/budowa/gastronomia/
sprzątanie, praca sezonowa, osoby bez profesjonalnego CV.

**Kluczowa obietnica:** oferty pracy w Belgii w czterech językach — przeglądanie, filtry,
zapisane wyszukiwania z powiadomieniami i kontakt **bezpośrednio z ogłoszeniodawcą** (jego
kanał aplikowania: strona, e-mail albo telefon, #1129).

**Model (od 28.09.2026, #1128):** portal nie przyjmuje aplikacji, nie udostępnia firmom profili
ani CV, nie liczy dopasowań, nie wysyła propozycji i nie prowadzi rozmów kandydat–pracodawca.
Dawny wyróżnik „profil zamiast CV + matching” jest wyłączony (kod zostaje, fail-closed).
Odznaka weryfikacji = administrator sprawdził dane rejestrowe (tożsamość) firmy, nie ocena firmy.

**Pozycjonowanie:** prostota, zaufanie, przejrzystość, szybkość, bezpieczeństwo. Prościej
niż LinkedIn/Indeed/StepStone. Użytkownik rozumie stronę w kilka sekund.

**Ekspansja (przyszłość):** NL, LU, DE, FR, PL, reszta UE. Architektura ma to umożliwiać
(kraje/regiony/miasta jako dane, nie hardcode).

---

## 2. System wizualny (identyfikacja)

> AKTUALIZACJA 2026-09-21: nowym źródłem wyglądu jest docs/design/people-passport/README.md i zatwierdzony prototyp. Biel, czerwień, czerń i logo .be na czerwonym kafelku zastępują historyczną paletę. Wdrożenie etapowe: issues #2–#7; historyczne checklisty nie oznaczają ukończenia nowego stylu.

Źródło wyglądu: `docs/design/people-passport/README.md` i prototyp w tym katalogu. Starsze makiety w `docs/design/screens/` mają wartość historyczną.

**Zasady:** białe tło, oszczędna czerwień, czarny tekst, zaokrąglone elementy i fotografie ludzi w pracy. Bez ciężkich gradientów i nadmiaru dekoracji. Karty ofert mają układ paszportu z czytelnymi polami; przy braku wynagrodzenia pozostałe pola wykorzystują miejsce.

**Paleta:** tokeny w `src/app/globals.css`, mapowane przez Tailwind. Kolor marki: czerwień około `#D92932`, tekst około `#151515`, tło `#FFFFFF`. Kolory semantyczne sukcesu, ostrzeżeń i błędów zachowują swoje znaczenie. Nie wpisuj hexów w komponentach. Kontrast WCAG 2.2 AA obowiązkowy.

**Typografia:** lokalny DM Sans jak w prototypie (`next/font/local`, podzbiór ~42 KB z polskimi znakami, osie wght 400–800 i opsz; sekcje `.pp-*` mają `font-optical-sizing: none` = opsz 9, czyli plik, który prototyp dostaje z Google Fonts; SIL OFL 1.1 — `assets/fonts/DMSans-OFL.txt`, przepis `scripts/subset-font.py`). Zmiana fontu wymaga sprawdzenia czytelności, budżetu fontów i CLS (`perf-budget-static.mjs`, `perf-lab.mjs`).

**Kalka prototypu (#5/#7, decyzja właściciela 2026-09-24: „kalka jeden do jednego”):** nagłówek, hero, wyszukiwarka, „Najnowsze oferty”, karta-paszport, „W czym jesteś dobry?” i dolny pasek stopki mają reguły przepisane dosłownie z `docs/design/people-passport/prototype` (style.css → directions.css → people.css → conditions.css → extended.css) jako klasy `.pp-*` w `src/app/globals.css`; kolory tylko jako tokeny `--pp-*` w `:root`. Progi `@container` prototypu (1050/950/850/760/600/500 px) są media queries. Siatka ofert = to, co prototyp renderuje: 2 kolumny, 1 ≤ 950 px (conditions.css nadpisuje 3 kolumny z people.css); lista z filtrami 1 kolumna. Odstępstwa (tylko wymogi repo): #777 → #767676 (AA), fokus widoczny, stany demo i statusy karty w wierszu firmy, przycisk menu ≤ 850 px, sekcje aplikacji spoza prototypu pod „W czym jesteś dobry?”. Zmieniając te widoki, porównuj zrzuty 1280/390 px z prototypem (nakładka); nie owijaj kart ramką `divide-y` (podwójne krawędzie).

**Weryfikacja (#7):** matryca zgodności z prototypem `docs/design/people-passport/MATRIX.md` (każdy ekran prototypu i trasa aplikacji, 1280/390 px, % pikseli > 40/255 + style kluczowych elementów), pomiar do powtórzenia `node scripts/design/compare-prototype.mjs` (poza CI, aplikacja w trybie demo). Lista ofert: nagłówek `.pp-list-header` + wyszukiwarka `.pp-search` jak na stronie głównej; strony treściowe: H1 `.pp-page-title`; podstrony paneli: `H1_EXTENDED` (40/30 px). Stara paleta (granat #0F2A47/#2563EB) i Inter usunięte — strażnik `tests/unit/legacy-palette.test.ts` z kontrolą ujemną.

**Logo:** komponent `src/components/brand/Logo.tsx` — czarne „pracuj” i białe „.be” na czerwonym, zaokrąglonym kafelku. Favicon, ikony PWA i `og.png` (#7) = ten sam znak z konturów DM Sans 800 (`scripts/brand-glyphs.py` → `assets/brand/logo-glyphs.json` → `scripts/generate-icons.mjs`; opis `public/ICONS_README.md`, strażnik `brand-assets.test.ts`).

**E-maile (#7):** layout `src/emails/_components.tsx` = kalka `prototype/materials/newsletter.html` (tło #f4f4f4, biała kolumna 600 px, logo jak w nagłówku, H1 36 px, akapity 16 px/1,7 #666, przycisk z promieniem 11 px, sekcje „paszportu” z linią #e5e5e5, stopka #f8f8f8). Kolory wyłącznie z `emailPalette` (test `email-palette.test.tsx` odrzuca inne, z kontrolą ujemną). Odstępstwa klienta pocztowego: style inline + tabele, bez webfontów (`'DM Sans', Arial, sans-serif`), #777 → #767676, tekst stopki #6b6b6b (AA na #f8f8f8); bez nadtytułu „PRACA W BELGII” i czerwonej drugiej linii nagłówka (treść maili bez zmian). Typografię pól paszportu porównuje z prototypem test `email-passport-prototype.test.tsx` (z kontrolą ujemną). Dostępność maili: `EmailLayout` wymaga `title` (= temat, `EmailShell` liczy go tak samo jak `renderEmail`) → `<title>`, `<html lang>` = język odbiorcy z jawnym `dir="ltr"`, preheader ukryty i pominięty w text/plain (`data-skip-in-text`, bez znaków wypełniacza), logo = link z `aria-label` „Pracuj.be” (znak z tekstu, bez obrazka). Test `email-a11y.test.tsx` renderuje każdy typ z `src/emails/wiring.ts` × 4 języki i sprawdza: lang/dir, `<title>` = temat, brak niewypełnionych tokenów, preheader zgodny z `copy.ts` w języku odbiorcy, alt obrazów, nazwę logo, href i czytelną nazwę każdego linku (lista „kliknij tutaj” PL/NL/FR/EN), `role="presentation"` tabel, kontrast każdego tekstu ≥ AA (kolor i tło ze stylów inline, 3:1 dla dużego tekstu) oraz text/plain z tym samym zbiorem linków i nazw linków co HTML; kontrole ujemne dla każdej reguły. Nowe typy w `wiring.ts` wchodzą do testu same.

---

## 3. Architektura techniczna

- **Framework:** Next.js 15, App Router, React 19, React Server Components domyślnie.
  Klienckie komponenty (`"use client"`) tylko gdy naprawdę potrzebne (formularze, interakcje).
- **Rendering:** publiczne strony SSR/SSG (oferty statycznie generowane/rewalidowane), panele SSR + wyspy klienckie.
- **Język/typy:** TypeScript `strict: true`. Walidacja I/O przez **Zod** (jedno źródło typów: `z.infer`).
- **UI:** Tailwind CSS + **shadcn/ui** (dostępne komponenty Radix). Komponenty w `src/components/ui`.
- **Dane (#25):** PostgreSQL Railway bez PostgREST — `src/lib/db/portal.ts` (`getPortalIdentity` z sesji Better Auth,
  `withPortalTransaction` = RLS jako użytkownik, `withServiceRole` = osobna pula `DATABASE_SERVICE_URL` tylko dla
  workera/webhooków/crona/odczytów admina), zapytania `src/lib/db/sql.ts`. Konwencje: `docs/railway/WARSTWA_DANYCH.md`.
  Testy: atrapa `tests/helpers/fake-db.ts`, PG16 `tests/integration/portal-*.test.ts`.
- **Auth/Storage:** konta i sesje **Better Auth** na PostgreSQL Railway (#24, `src/lib/auth/*`), pliki CV w prywatnym
  buckecie Railway (#26, `src/lib/files/*`). **Supabase usunięte (#27)** — brak SDK, zmiennych i hooka GoTrue; strażnik
  `tests/unit/no-supabase-runtime.test.ts` (z kontrolą ujemną) odrzuca import `@supabase/*`, zmienne i hosty Supabase
  w `src/`. Katalog `supabase/` to wyłącznie migracje SQL i testy RLS (nazwa historyczna).
- **Bezpieczeństwo danych:** **Row Level Security** na każdej tabeli. Operacje wrażliwe = Server Actions/Route Handlers.
- **Formularze:** React Hook Form + Zod resolver. Server Actions do zapisu.
- **E-mail:** **Resend** + **React Email** (szablony w `src/emails`), wysyłka przez kolejkę (`email_deliveries`).
- **Błędy/monitoring:** webhook Discorda `ERROR_WEBHOOK_URL` (#571, `src/lib/error-webhook`, tylko serwer; Sentry usunięte; błędy przeglądarki przez `POST /api/client-error`). Centralny system błędów `src/lib/errors`, `captureError` w `src/lib/error-report.ts`.
- **Testy:** **Vitest** (unit/integration) + **Playwright** (e2e). Patrz `tests/`.
- **Hosting:** **Railway**, jedna produkcja z `main`; natywne `Wait for CI` blokuje wdrożenie do zielonego CI. Migracje SQL są wersjonowane w repozytorium.
- **Tryb produktu (#1136):** jedno źródło `src/lib/portal-mode.ts` — `PORTAL_LEGAL_MODE=RECRUITMENT` (dokładnie) włącza
  funkcje rekrutacyjne, każda inna wartość/brak = `CLASSIFIEDS_ONLY` (decyzja produktowa: portal ogłoszeniowy, fail-closed
  także w demo/dev/testach). API: `isRecruitmentEnabled()`, `assertRecruitmentEnabled()` (`AppError(RECRUITMENT_DISABLED)`,
  `errors.recruitmentDisabled`), `notFoundUnlessRecruitment()`; lista `RECRUITMENT_FEATURES`. Tryb w `/api/health` tylko za
  sekretem. Vitest domyślnie ogłoszeniowy (`withRecruitmentMode()` z `tests/helpers/portal-mode.ts` dla starych przepływów),
  serwery Playwright jawnie `RECRUITMENT` (nadpisanie `E2E_PORTAL_LEGAL_MODE=`). Strażnik CI: `tests/legal/classifieds-only.test.ts`
  (projekt Vitest `legal`, job `unit`; dawne `it.todo` kolejnych PR-ów #1128 zamienione na odnośniki do testów,
  strona pozytywna — ścieżki aktywne bez `RECRUITMENT_DISABLED` — w `tests/legal/classifieds-active-paths.test.ts`, #1249).
  Wyłączone w trybie ogłoszeniowym (#1141/#1144/#1132, warstwa aplikacji, bez migracji): akcje `sendOffer`/`respondToOffer`/
  `loadMoreProposals`, `applyToJob`/`transitionApplication`/`withdrawApplication`, odczyty historii zgłoszeń kandydata
  i pracodawcy, aplikacja gościa (`submit`/`confirm`/`claimGuestApplication`, `stageGuestLink`) → `RECRUITMENT_DISABLED`
  przed limiterem/Turnstile/bazą (`tests/legal/classifieds-process-off.test.ts`, kontrola ujemna w trybie RECRUITMENT);
  trasy `/employer/aplikacje[/id]`, `/candidate/aplikacje[/id]`, `/candidate/propozycje`, `/aplikacja/potwierdz|przejmij`
  → 404; nawigacja (`recruitmentEnabled` z layoutu do `EmployerShell`/`CandidateShell`), sekcja zgłoszeń pulpitu
  pracodawcy, baner propozycji i podgląd zgłoszeń pulpitu kandydata ukryte (loadery niewołane); powiadomienia
  o zgłoszeniach/propozycjach prowadzą do pulpitu. Blokady RPC i wygaszanie e-maili: #1140/#1145.
  Konto kandydata bez profilu zawodowego i komunikacja bez zdarzeń rekrutacyjnych (#1142/#1145, migracja `0175`): nawigacja z jednego źródła `src/lib/candidate-nav.ts` (tryb ogłoszeniowy = pulpit, zapisane oferty, zapisane
  wyszukiwania, ustawienia), pulpit `CandidateAccountDashboard` (zapisane oferty/wyszukiwania; loadery profilu, CV, zgłoszeń,
  propozycji i wiadomości niewołane), `/candidate/onboarding` i `/candidate/profil` → 404, `saveOnboardingStep` →
  `RECRUITMENT_DISABLED` przed bazą, stary `next` do kreatora po potwierdzeniu e-maila → pulpit; ustawienia bez sekcji
  widoczności profilu. Baza: `ensure_candidate_profile` ze strażnikiem (każde RPC profilu), BEFORE INSERT na
  `candidate_profiles`/`candidate_skills|languages|certificates`, BEFORE UPDATE pól zawodowych przez klienta; trigger
  `trg_aa_recruitment_mode` na `notifications` pomija typy procesu (`application_*`, `offer_*`, `message_received`,
  encje `application`/`offer`/`conversation`/`job_terms`, `job_match` spoza zapisanego wyszukiwania); kolejka e-mail
  wygasza szablony z `email_recruitment_template()` (lustro `src/lib/email/recruitment-templates.ts`) jako
  `suppressed_feature_disabled` przy claimie i tuż przed wysyłką. Preferencje e-mail w trybie bez kategorii
  zgłoszeń/propozycji/wiadomości (`emailFieldsFor`; zapis bierze ich wartości z bazy `FOR UPDATE`), linki starych
  powiadomień → pulpit, demo bez zdarzeń procesu, teksty alertów „z zapisanych wyszukiwań”. Dowód: `rls.sql` sekcje
  CA1142/NT1145 (kontrole ujemne: bez strażnika krok 3 zapisuje; tryb RECRUITMENT), rollback `0175_…down.sql`
  (`classifieds-account-rollback.sql`), unit `classifieds-candidate-account`, `classifieds-notifications`, strażnik
  `legal`, E2E `classifieds-candidate-account` (z `E2E_PORTAL_LEGAL_MODE=`).
- **Tryb w bazie i dwuklucz (#1140/#1143, migracja `0171`):** singleton `portal_legal_mode`
  (domyślnie `CLASSIFIEDS_ONLY`), `recruitment_enabled()` fail-closed (brak wiersza/błąd = false). Tryb efektywny =
  env `RECRUITMENT` ORAZ baza `RECRUITMENT` (`src/lib/ops/portal-mode.ts`). W trybie ogłoszeniowym baza odrzuca nowe dane
  procesu (`RECRUITMENT_DISABLED`): BEFORE INSERT na `applications`/`offers`/`matches`/`conversations`/`messages`/
  `message_attachments`/`application_screening_answers`/`guest_application_requests` (także service_role; wyjątek
  `pracujbe.allow_recruitment_write` tylko dla superusera — seed), BEFORE UPDATE (zmiana statusu aplikacji poza
  wycofaniem, przejęcie aplikacji gościa, odpowiedź na propozycję); polityki RESTRICTIVE + `company_can_view_candidate`/
  `candidate_profile_is_searchable`/`is_conversation_member`/`can_attach_in_conversation`/`get_job_match_profile` —
  firma nie widzi danych procesu ani profili, kandydat widzi własną historię. Zmiana trybu tylko RPC
  `admin_set_portal_legal_mode` (service_role, uzasadnienie, CAS `STALE_STATE`, audyt; trigger blokuje bezpośredni zapis),
  skrypt `scripts/db/set-portal-legal-mode.mjs`, procedura `docs/railway/OPERATIONS.md` §6. `/api/health/ops`: alarm
  `portal_legal_mode_mismatch` (env ≠ baza, `ops_metrics().portalLegalMode`); `/api/maintenance` pomija materializację
  dopasowań (`recruitmentTasks: { skipped: 'classifieds_only' }`); `restore-backup.sh` wymusza `CLASSIFIEDS_ONLY`
  (chyba że `RESTORE_KEEP_PORTAL_MODE=1`). Testy przepływów rekrutacyjnych włączają `RECRUITMENT` jawnie (rls.sql na
  starcie, `startPortalDb`, `test-e2e-real`). Dowód: `rls.sql` sekcje CL1128/PLM (kontrole ujemne: brak wiersza, zdjęty
  strażnik `send_offer`, zdjęta polityka, zdjęty trigger trybu), rollback `supabase/rollback/0171_…down.sql`, unit
  `portal-mode-dual-key`, `maintenance-portal-mode`, `ops-health-route`, `test:backup`. Dane istniejące (#1150): tylko
  blokada nowych danych, bez zamrażania (brak danych produkcyjnych).
  Matching wyłączony w trybie ogłoszeniowym (#1131/#1133/#1139, bez migracji): `/api/maintenance` nie woła
  `runMatchRecompute` (`matches: "disabled"`, sam `runMatchRecompute` też sprawdza tryb), `getMyJobMatch(Action)` →
  `disabled` bez transakcji, brak `job-match-slot` i `MatchBar` na `JobCard`; `/employer/kandydaci[/id]` i
  `/candidate/oferty-polecane` → 404 (`notFoundUnlessRecruitment`), loadery rankingu/szczegółu kandydata → `disabled`,
  przegląd/lista ofert bez pól `matchedCandidatesCount`/`matched` (kafelek i kolumna znikają), pulpit pracodawcy bez
  „Top dopasowani” (`EmployerTopMatched`), pulpit kandydata bez polecanych (`CandidateRecommendedPreview`), nawigacja
  shelli z propsem `recruitmentEnabled` (domyślnie `false`). Dowód: `tests/unit/classifieds-matching-off.test.ts`
  (kontrole ujemne w trybie `RECRUITMENT`), strażnik `legal` (importy `MatchBar`/`SendOfferButton` tylko w chronionych
  segmentach, `public.matches` tylko za bramką), E2E `classifieds-matching-off` (z `E2E_PORTAL_LEGAL_MODE=`).
- **AI tylko na treści ogłoszenia, billing bez dostępu do kandydatów (#1152/#1153, migracja `0176` — po 0175,
  zależna od 0171):** inwentarz AI ma pole `allowedInClassifieds` (`true` tylko dla wejść z
  `CLASSIFIEDS_ALLOWED_INPUTS` = treść ogłoszenia; strażnik `ai-inventory` z kontrolą ujemną); wspólna bramka
  `isAiFeatureEnabled(id)` (`src/lib/ai/feature-gate.ts`) = flaga funkcji × tryb, użyta w konfiguracji importu
  ogłoszeń, asystenta, tłumaczeń i kontroli treści (bez zmian zachowania w trybie ogłoszeniowym; import CV bramkuje
  #1163). Tłumaczenie profili kandydatów = osobna funkcja `candidate_profile_translation` (`not_wired`, #34; budżet
  AI rozlicza ją osobno, `translationFeatureFor`), worker odrzuca takie zadanie bez modelu (`recruitment_disabled`).
  Baza: strażnik `trg_aa_recruitment_mode` na `translation_sources`/`_revisions`/`_jobs` odrzuca encję
  `candidate_profile`, `claim_translation_jobs` jej nie wydaje (fail-closed), CHECK
  `plan_entitlements_no_candidate_access` (`candidate_access` zawsze false). (Flaga billingu `isBillingEnabled()`/`BILLING_ENABLED`
  usunięta razem z kodem billingu w `0177`.) Usunięte martwe klucze `billing.standardFeat3`/`proFeat3`, `dashboard.featCvAccess`. Dowód:
  `rls.sql` sekcja CLAIB (kontrole ujemne: rollback 0176, CHECK zdjęty), rollback `0176_…down.sql` (w
  `portal-legal-mode-rollback.sql` przed 0173), unit `ai-feature-gate`, `ai-inventory`, `billing-disabled`.
- **Bez bazy profili i pytań screeningowych (#1135/#1137, migracja `0173`, na 0171):** w trybie
  ogłoszeniowym `set_candidate_searchable(true)` → `RECRUITMENT_DISABLED` (wyłączenie działa), strażnik
  `trg_aa_recruitment_mode_searchable` odrzuca `is_searchable = true` każdą ścieżką (wyjątek seedu jak w 0171),
  `company_can_see_match_candidate` = false; bez jednorazowego zerowania flag (odczyt firm zamyka 0171). Pytania:
  `set_job_screening_questions` z niepustą listą → `RECRUITMENT_DISABLED`, wstawienie do `job_screening_questions`
  pomijane (duplikat oferty powstaje bez pytań), `get_public_job_screening_questions` pusty, `enforce_screening_review`
  nie blokuje publikacji ofert z pytaniami sprzed trybu, decyzja przeglądu (`screening_question_reviews`) odrzucona;
  pytania i przeglądy sprzed trybu zostają. Aplikacja: `/candidate/ustawienia` bez sekcji widoczności (akcja
  `setProfileVisibilityAction` → `RECRUITMENT_DISABLED` bez bazy), kreator (prop `screeningEnabled` z serwera, domyślnie
  wyłączony) bez edytora pytań w kroku 7 i bez klucza `screening_questions` w zapisie (`updateJobDraft` odrzuca pytania
  przed bazą), `/admin/pytania` = 404 i bez pozycji w nawigacji, `decideScreeningReview` → `RECRUITMENT_DISABLED`.
  Dowód: `rls.sql` sekcje CLVIS/CLSCR (kontrole ujemne: zdjęty strażnik, polityka z 0078, tryb RECRUITMENT blokuje
  publikację), rollback `supabase/rollback/0173_…down.sql` (przed 0171 w `portal-legal-mode-rollback.sql`), unit
  `profile-visibility`, `save-job-draft-step`, `screening-review`, `job-wizard-screening-mode`, strażnik
  `classifieds-only` (w tym `GUARDED_ROUTES` `admin/pytania`), E2E `classifieds-profile-screening` (`E2E_PORTAL_LEGAL_MODE=`).
  Stare pytania i przeglądy sprzed trybu ukryte wszędzie (decyzja właściciela 28.09, bez migracji,
  warstwa aplikacji): w trybie ogłoszeniowym loadery nie wołają zapytań o nie — szczegół publiczny
  oferty (`getJobBySlug`), kreator (`getJobDraft`, `screeningQuestions: []`, zapis kroku 7 nie rusza
  wierszy), odpowiedzi w szczegółach zgłoszeń i na liście kandydata (`screeningCount` = 0),
  kolejka admina (`listScreeningReviews` pusta; dziennik audytu zostaje kompletny w obu trybach),
  powiadomienia `screening_review` (dzwonek, pełna lista, licznik), błąd publikacji z przeglądem
  pytań (→ `INTERNAL`, bez odczytu). Wiersze zostają w bazie; tryb `RECRUITMENT` bez zmian. Dowód:
  unit `classifieds-screening-hidden`, PG16 `portal-screening-banner` (sekcja „stare pytania ukryte”),
  strażnik `classifieds-only` (bramka `isRecruitmentEnabled('screening')` przy każdym odczycie,
  kontrola ujemna).
- **Bez wiadomości i CV (#1134/#1138, migracja `0174`, na 0171):** akcje
  `messages.ts`/`message-attachments.ts` → `RECRUITMENT_DISABLED` jako pierwszy krok (bez bazy, limitera, bucketu),
  loadery rozmów bez zapytań (lista pusta, licznik 0), segmenty `candidate|employer/wiadomosci` = 404 (layout,
  przed `loading.tsx`), `/api/files/message/<id>` = 404, nawigacja bez „Wiadomości”, szczegół oferty bez „Wyślij
  wiadomość”/„Kontakt przez platformę”, linki powiadomień/e-maili o rozmowie → pulpit. Upload CV (akcja +
  `storeCandidateCv`) → `RECRUITMENT_DISABLED`; pobranie/usunięcie własnych plików zostaje (`CvUpload` bez
  `allowUpload` = lista istniejących plików; profil jest w trybie 404 (#1142), więc lista jest w
  `/candidate/ustawienia` jako sekcja `variant="settings"` z kotwicą `#pliki-cv`, także pusta — #1226; dowód: unit
  `classifieds-candidate-cv-files` (kontrole ujemne: RECRUITMENT, `allowUpload`), strażnik `legal`, E2E
  `classifieds-candidate-account`) oraz w sekcji „Twoje pliki” pulpitu konta `CandidateAccountDashboard`
  (decyzja właściciela 29.09.2026: tylko gdy są pliki albo odczyt się nie udał; unit
  `classifieds-candidate-account` z kontrolą ujemną RECRUITMENT = wgrywanie). Import CV przez AI: `cvImportProvider()` =
  null w trybie (mimo `AI_CV_IMPORT_ENABLED`), akcje bez modelu i budżetu, `import-cv` = 404, wpis inwentarza AI
  `classifiedsModeGuard`. Baza (uzupełnia 0171): `newMessage` w kolejce wygaszany (`suppressed_recruitment_disabled`),
  trigger `trg_aa_recruitment_mode_cv` na `files` (nowe CV odrzucone dla każdej roli), `apply_candidate_cv_proposals`
  = nakładka ze strażnikiem (`_impl` bez EXECUTE dla klientów). Dowód: `rls.sql` sekcja CL174 (kontrole ujemne),
  rollback `0174_…down.sql`, unit `classifieds-messaging-cv-off`, strażnik `legal`, E2E `classifieds-messaging-cv-off`.
- **CI w trybie ogłoszeniowym (#1166, bez migracji):** job `e2e-classifieds` („E2E classifieds (CLASSIFIEDS_ONLY)”,
  wynik w wymaganym checku „E2E (Playwright)”) — serwer `E2E_PORTAL_LEGAL_MODE=CLASSIFIEDS_ONLY` na buildzie z jobu
  build: projekt `chromium` sam wybiera `CLASSIFIEDS_SPECS` z `playwright.config.ts` (`CLASSIFIEDS_ONLY_SPECS` —
  `classifieds-*`, `job-detail-employer-apply`, poza shardami; `CLASSIFIEDS_SHARED_SPECS` — a11y/SEO/panele, w obu
  trybach; shard z serwerem ogłoszeniowym = błąd), potem fixture (`CLASSIFIEDS_FIXTURE_SPECS`: lejek „Aplikuj
  u pracodawcy” w `job-funnel-no-storage` — kliknięcie = `apply_started` tylko po zgodzie, bez cookies/storage).
  `perf-lab.mjs`: LCP/CLS/TBT i INP listy w `CLASSIFIEDS_ONLY`, INP ApplyModal na drugim serwerze `RECRUITMENT`
  (tryb sprawdzany na szczególe). Strażnik `check-ci-workflows.mjs` (+ kontrole ujemne w `ci-workflows-guard.test`).
  Ten sam build w dwóch trybach lokalnie: najpierw `rm -rf .next/cache/isr-handler` (strony ISR drugiego trybu).
- **Pulpity w trybie ogłoszeniowym (bez migracji):** w miejscu dawnych sekcji rekrutacyjnych — pulpit pracodawcy
  (`/employer`, kolumna boczna w miejscu „Top dopasowani”): `EmployerListingStats` = skrót statystyk ogłoszeń, do
  3 najczęściej oglądanych ofert z ostatnich 30 dni z wyświetleniami i kliknięciami „Aplikuj u pracodawcy”
  (`getTopListingJobs` na `getJobFunnel` = lejek ofert pod RLS, bez tabel procesu; member = `denied`, awaria = `error`
  z ponowieniem, brak ruchu = osobny komunikat) i jeden odnośnik „Zobacz szczegóły” → `/employer/statystyki` (dawna
  karta-odnośnik `EmployerFunnelSection` w trybie ogłoszeniowym nic nie renderuje). Pulpit konta kandydata
  (`CandidateAccountDashboard`, w miejscu polecanych): `CandidateSavedSearchJobs` = do 3 najnowszych ofert z zapisanych wyszukiwań kandydata
  (`loadSavedSearchJobs`: 3 najnowsze wyszukiwania, filtry z `saved_searches.query` przez `parseJobListQuery`, publiczne
  `get_public_jobs` dla `candidateId` — firmy zablokowane pomija baza; sort „najnowsze”, bez wyniku/dopasowania), linki
  „Pokaż oferty: {nazwa}” w języku zapisu (#823), bez wyszukiwań zachęta z linkiem do `/oferty-pracy`, awaria = błąd z
  ponowieniem (nie pusta lista; wyszukiwania czytane raz, przekazane do `loadSavedSearchJobs`); powitanie pracodawcy bez „rekrutacji”
  (`employerGreetingSubListing*`). Tryb `RECRUITMENT`: stare sekcje. Dowód: unit `classifieds-employer-stats`, `classifieds-candidate-saved-search-jobs`, `classifieds-candidate-account`, `legal`
  `classifieds-panels` (kontrole ujemne), E2E `classifieds-dashboards` (`E2E_PORTAL_LEGAL_MODE=`, axe 320/1280 px).
- **Resztki trybu ogłoszeniowego (#1211/#1212/#1213/#1225, migracja `0204` — numer tymczasowy):** szablony
  odpowiedzi (narzędzie wiadomości) — `/employer/szablony` = 404 (`notFoundUnlessRecruitment('messaging')`, wpis
  w `GUARDED_ROUTES`), pozycja nawigacji tylko przy `recruitmentEnabled`, akcje `saveMessageTemplate`/
  `deleteMessageTemplate` → `RECRUITMENT_DISABLED` jako pierwszy krok; baza: `save_/delete_company_message_template`
  = nakładki ze strażnikiem trybu (treść 0170 w `*_impl` bez EXECUTE dla klientów), BEFORE INSERT
  `trg_aa_recruitment_mode` na `company_message_templates`/`_variants` (każda rola, wyjątek seedu jak 0171; UPDATE/
  DELETE bez strażnika — kaskady działają). Dowód: `rls.sql` sekcja CLTPL (kontrole ujemne: bez triggera, bez
  nakładki), rollback `0204_…down.sql` (`classifieds-message-templates-rollback.sql`, także w
  `portal-legal-mode-rollback.sql`). E-maile spoza `RECRUITMENT_EMAIL_TEMPLATES`: treść bazowa `copy.ts` = portal
  ogłoszeń, dawne brzmienie w `EmailCopy.recruitment` (wybór w `resolveCopy` przy `isRecruitmentEnabled()`) —
  `jobPublished`, `companyVerified`, `inactiveAccountWarning`. Ekrany konta: `AgeAttestationSettings`,
  `CompanyBlocksSettings`, `AccountDataSettings`, `JobCompanyBlockControl`, `TeamMembers`, `JobWizard` (podtytuł
  edycji) z propsem `recruitmentEnabled` (domyślnie `false` → klucze `*Listing`), `roleDescKey(role, recruitment)`,
  `RecruiterOnlyNote` sam czyta tryb. Strażnik `classifieds-copy.test.ts` (e-maile spoza procesu i klucze `*Listing`,
  kontrole ujemne: dawne brzmienia = czerwony). **Do akceptacji właściciela:** nowe brzmienia.
- **i18n:** `next-intl`, routing z prefiksem locale (`/pl`, `/nl`, `/fr`, `/en`), teksty w `src/messages/*.json`.

---

## 4. Struktura katalogów

```
pracujbe/
├─ CLAUDE.md                      # ten plik — mapa/kontrakt projektu
├─ README.md                      # szybki start + skrypty
├─ .github/workflows/             # CI na ubuntu-latest (GitHub-hosted)
│  └─ ci.yml                      # lint · typecheck · unit · e2e · build
├─ docs/                          # dokumentacja rozszerzona
│  ├─ ARCHITECTURE.md             # architektura, dostęp do danych, role
│  ├─ DEPLOYMENT.md · DOMAIN_SETUP.md
│  ├─ railway/                    # PostgreSQL, Better Auth, bucket, migracje, STATUS.md, OPERATIONS.md
│  ├─ DATABASE.md · DATA_RETENTION.md · GUEST_APPLY.md · JOB_FUNNEL.md · TELEMETRY_PRIVACY.md
│  ├─ EMAILLABS_SETUP.md · RESEND_SETUP.md · TURNSTILE.md · CSP_NONCE_ANALYSIS.md
│  ├─ AI_*.md · ESCO.md · PRODUCT_DECISIONS.md · RELEASE_1_0.md
│  ├─ SECURITY_CHECKLIST.md · PERFORMANCE_CHECKLIST.md · LAUNCH_CHECKLIST.md
│  ├─ design/people-passport/     # źródło wyglądu (prototyp, MATRIX.md)
│  ├─ legal-drafts/               # PROJEKTY dokumentów prawnych (nieopublikowane)
│  ├─ STAGING.md                  # staging wycofany (decyzja 2026-09-21)
│  └─ ARCHIWALNE: SUPABASE_SETUP.md (stan sprzed #27), SELF_HOSTED_RUNNERS.md (CI przed 2026-09-23),
│     audit/, REMEDIATION-2026-07-23*.md, DESIGN_SCREENS.md
├─ database/
│  ├─ bootstrap/                  # role i tożsamość (stały bootstrap)
│  └─ auth/                       # schemat Better Auth (`auth.*`)
├─ supabase/                      # nazwa historyczna — tylko SQL, bez Supabase w runtime (#27)
│  ├─ migrations/                 # *.sql wersjonowane (kolejność wg prefiksu, przeplatane z database/)
│  ├─ tests/                      # rls.sql, role-guard.sql (npm run test:rls)
│  ├─ rollback/                   # ręczne skrypty wycofania (np. 0097 ESCO)
│  └─ seed.sql                    # dane demonstracyjne (oznaczone is_demo=true)
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx               # root layout (html/lang ustawiane w [locale])
│  │  ├─ [locale]/                # wszystkie strony z prefiksem języka
│  │  │  ├─ layout.tsx
│  │  │  ├─ page.tsx              # strona główna
│  │  │  ├─ (public)/...          # oferty, kategorie, miasta, poradniki, o nas...
│  │  │  ├─ (auth)/...            # logowanie, rejestracja, reset, potwierdzenie
│  │  │  ├─ candidate/...         # panel kandydata (noindex)
│  │  │  ├─ employer/...          # panel pracodawcy (noindex)
│  │  │  └─ admin/...             # panel administratora (noindex)
│  │  ├─ api/                     # route handlers (webhooki, kolejka e-mail, itp.)
│  │  ├─ sitemap.ts / robots.ts
│  ├─ components/
│  │  ├─ ui/                      # shadcn/ui
│  │  ├─ brand/                   # Logo, znaki
│  │  ├─ public/                  # komponenty stron publicznych
│  │  └─ cookies/                 # baner + centrum zgód
│  ├─ lib/
│  │  ├─ i18n/                    # konfiguracja next-intl, locale, fallback e-mail
│  │  ├─ matching/                # deterministyczny scoring dopasowania
│  │  ├─ email/                   # wysyłka + kolejka + wybór języka odbiorcy
│  │  ├─ errors/                  # centralny system błędów + kody
│  │  └─ validation/              # schematy Zod
│  ├─ emails/                     # szablony React Email (PL/NL/FR/EN)
│  ├─ messages/                   # pl.json, nl.json, fr.json, en.json
│  └─ types/                      # typy współdzielone, generowane z DB
├─ tests/
│  ├─ unit/                       # Vitest
│  └─ e2e/                        # Playwright
├─ .env.example
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
├─ vitest.config.ts
└─ playwright.config.ts
```

---

## 5. Model danych (PostgreSQL Railway)

UUID PK wszędzie, `created_at`/`updated_at` (trigger `set_updated_at`), soft-delete
(`deleted_at`) tam gdzie potrzebne, FK z kontrolowanym `ON DELETE`, statusy jako enumy/CHECK,
indeksy pod filtry ofert. Pełny DDL w `supabase/migrations/`.

Tabele (grupy):

- **Tożsamość/role:** `profiles` (1:1 z `auth.users`, pole `role`, `preferred_locale`,
  `account_locale`, `signup_locale`), `candidate_profiles`, `employer_profiles`.
- **Firmy:** `companies` (status weryfikacji), `company_members` (rola w firmie, aktywność).
- **Oferty:** `jobs`, `job_translations`, `job_requirements`, `job_skills`.
- **Słowniki:** `categories`, `occupations`, `skills`, `languages`, `certificates`, `locations`.
- **Profil kandydata (relacje):** `candidate_skills`, `candidate_languages`, `candidate_certificates`.
- **Procesy:** `applications`, `application_status_history`, `matches`, `saved_jobs`,
  `offers`, `offer_status_history`.
- **Komunikacja:** `conversations`, `conversation_members`, `messages`,
  `notifications`, `notification_preferences`, `email_deliveries`.
- **Pliki/zgody/zgłoszenia:** `files`, `consents`, `consent_versions`, `reports`.
- **Płatności:** schemat billingu (`subscriptions`, `payments`, `invoices`, `discount_codes`, `checkout_intents`, `discount_redemptions`) usunięty migracją `0177` (#51); zostaje katalog limitów `plan_entitlements`.
- **Audyt:** `audit_logs`, `system_events`.

Statusy (enumy):
- `application_status`: draft, submitted, viewed, shortlisted, interview, offer_sent, offer_accepted, offer_declined, rejected, withdrawn, hired.
- `offer_status`: draft, sent, viewed, accepted, declined, expired, cancelled.
- `company_status`: unverified, pending, verified, rejected, suspended.
- `job_status`: draft, active, paused, closed, expired.

---

## 6. Role i uprawnienia

Role (`profiles.role`): `candidate`, `employer`, `admin`. Architektura przewiduje też:
`moderator`, `recruiter`, `company_member`, `company_owner` (poprzez `company_members.role`).

Zasada uprawnień (egzekwowana przez RLS + walidację w Server Actions):
- Kandydat: edytuje wyłącznie własne dane; widzi własne aplikacje/wiadomości.
- Pracodawca/członek firmy: dostęp tylko do danych własnej firmy; wymaga aktywnego `company_members`.
- Firma A nie widzi danych firmy B.
- Admin: operacje przez kod serwerowy (service role), każda wrażliwa akcja → `audit_logs`.

---

## 7. INVARIANTS — reguły, których NIGDY nie łam

Te reguły wynikają wprost ze specyfikacji i z błędów poprzedniego produktu. Łamanie ich to bug.

1. **Język komunikacji = język ODBIORCY.** E-maile i powiadomienia zawsze w języku odbiorcy.
   Fallback: `recipient.preferred_locale → account_locale → signup_locale → 'en'`.
   NIGDY nie używaj języka nadawcy / sesji pracodawcy / admina / przeglądarki nadawcy / domyślnego serwera.
   Implementacja: `src/lib/i18n/recipient-locale.ts`. Test: `tests/unit/recipient-locale.test.ts`.
2. **Brak tekstów UI na sztywno.** Wszystkie stringi w `src/messages/*.json`. Test wykrywa brakujące/nieużywane klucze
   (`i18n-usage`, `i18n-unused-keys`) i literały tekstowe w JSX (`i18n-jsx-literals`, #1114 — wyjątki jawne, z powodem).
3. **Wysyłka propozycji idempotentna.** Server action z kluczem idempotencyjnym + transakcja.
   Zapis w DB niezależny od wysyłki e-mail (e-mail w kolejce `email_deliveries`, ponawialny).
   Podwójne kliknięcie / retry z tym samym kluczem = brak duplikatu.
4. **Aplikowanie idempotentne.** Unikat `(candidate_id, job_id)` — jedna aplikacja.
5. **RLS wszędzie.** Każda tabela z danymi użytkownika ma polityki. Domyślnie deny.
6. **Uprawnienia service_role tylko na serwerze.** Pula `withServiceRole` (`DATABASE_SERVICE_URL`, `src/lib/db/portal.ts`, `server-only`) nie może trafić do bundle klienta.
7. **Zero trackingu przed zgodą.** Beacon Cloudflare Web Analytics (#570 — zamiast Google Analytics i Meta Pixel, usunięte) ładuje się dopiero po zgodzie w kategorii `analytics` (kategorii `marketing` nie ma).
8. **Użytkownik nie widzi technikaliów.** Żadnego stack trace/SQL/surowej odpowiedzi API/komunikatu dostawcy.
   Błędy przez centralny system (`src/lib/errors`), user-facing komunikat z klucza tłumaczenia.
9. **Panele = `noindex`.** `candidate/*`, `employer/*`, `admin/*`, staging — wyłączone z indeksowania i sitemap.
10. **Pliki prywatne przez signed URLs.** Bez publicznych bucketów dla danych wrażliwych.
11. **Formularze:** blokada przycisku podczas zapisu, brak podwójnego kliknięcia, zachowanie danych po błędzie,
    błędy przy polach, przewijanie do pierwszego błędu, jasny sukces.
12. **Dane demonstracyjne oznaczone** (`is_demo = true`) — łatwe do odfiltrowania/usunięcia.
13. **Tryb ogłoszeniowy (#1128).** Decyzja produktowa: portal ogłoszeniowy. Funkcje rekrutacyjne
    wyłączone fail-closed (jedno źródło `src/lib/portal-mode.ts` #1136, blokady w bazie #1140,
    strażnik CI `tests/legal/classifieds-only.test.ts` #1146). Teksty publiczne bez obietnic
    dopasowania, aplikowania przez portal i widoczności profilu — strażnik
    `tests/unit/classifieds-copy.test.ts` (#1149/#1151). Ponowne włączenie tylko nową decyzją
    właściciela i dwoma kluczami (#1143).

---

## 8. Matching (dopasowanie) — deterministyczny

> **Wyłączone w trybie ogłoszeniowym (#1128, #1131).** Kod zostaje; wynik nie jest liczony ani
> pokazywany, `matches` nie są materializowane.

`src/lib/matching/score.ts`. **Bez niekontrolowanego AI** przy decyzjach. Suma 100 pkt:

| kryterium | pkt |
|---|---|
| zawód i kategoria | 20 |
| umiejętności | 20 |
| lokalizacja (promień) | 15 |
| doświadczenie | 10 |
| dostępność | 10 |
| język | 10 |
| certyfikaty | 5 |
| transport / prawo jazdy | 5 |
| warunki umowy | 5 |

Wynik zwraca: `score` (%), listy `matched` / `missing` / `strengths`, oznaczenie wymagań
obowiązkowych oraz krótkie wyjaśnienie (np. „Dobre dopasowanie: spełniasz 8 z 10 najważniejszych wymagań").

---

## 9. Przepływy krytyczne

**Przepływ ogłoszeniowy (aktywny, #1128):** pracodawca zakłada konto firmy → weryfikacja firmy
przez administratora → kreator oferty z kanałem aplikowania (https / e-mail / telefon, co
najmniej jeden, #1129) → publikacja → kandydat wyszukuje i filtruje (zapisane wyszukiwania
i alerty z własnych filtrów, #1148) → „Aplikuj u pracodawcy” prowadzi poza portal (#1130).

**Kandydat → oferta → pracodawca** (wyłączone w trybie ogłoszeniowym, #1128):
1. Kandydat: rejestracja → onboarding (6 krótkich kroków, każdy zapisywany) → profil (wskaźnik kompletności).
2. Kandydat aplikuje (idempotentnie) → `applications(status=submitted)` → powiadomienie + e-mail do pracodawcy (w języku pracodawcy).
3. Pracodawca zmienia status → `application_status_history` + powiadomienie/e-mail do kandydata (w języku kandydata).
4. Pracodawca wysyła propozycję (idempotentnie) → `offers(status=sent)` → powiadomienie + kolejka e-mail.
5. Kandydat akceptuje/odrzuca → `offer_status_history` + powiadomienie do pracodawcy.

**Wysyłka e-mail (kolejka):**
`enqueueEmail({ type, recipientProfileId, relatedId, payload })` →
wyznacz locale odbiorcy (fallback) → wstaw `email_deliveries(status=queued)` →
worker/route handler renderuje React Email w locale odbiorcy → Resend → zapisz
`status/provider_id/attempts/last_error`. Błąd = retry, nie usuwa rekordu źródłowego.

**Propozycja (idempotentnie; tylko tryb `RECRUITMENT`, #1141):** patrz Invariant #3. Kolejność w server action:
autoryzacja → status firmy `verified` → status oferty `active` → walidacja kandydata →
`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` w transakcji →
historia → notyfikacja → enqueue e-mail.

---

## 10. CI/CD — GitHub-hosted (WAŻNE)

CI chodzi na **GitHub-hosted runnerach `ubuntu-latest`** (decyzja właściciela z 2026-09-23;
wcześniej jeden współdzielony self-hosted runner serializował wszystkie przebiegi — #50).
Od 2026-09-27 repo jest publiczne, więc minuty hostowanych runnerów są darmowe: workflow
optymalizujemy pod czas przebiegu (równoległe joby), nie pod liczbę minut.
Wdrożenie obsługuje natywna integracja Railway. Zobacz:
- `.github/workflows/ci.yml` — `runs-on: ubuntu-latest`; `install` → `lint`/`typecheck`/`unit`/`migrations`,
  równolegle `sca` i `rls`; `build` po zielonym lint+typecheck+unit; po `build` równolegle:
  - `e2e-shard` („E2E shard i/3”) — zestaw demo `playwright.config.ts` (projekt `chromium`)
    w 3 shardach podzielonych PO CZASIE testów, nie po ich liczbie (`--shard` dzieli pliki
    alfabetycznie, a najdłuższe przeglądy axe leżą blisko siebie w alfabecie — 7,4/2,5/5,1 min).
    `E2E_DEMO_SHARD=1|2|3` wybiera w konfiguracji jedną z dwóch jawnych list najdłuższych
    speców (`DEMO_SHARD_1_SPECS`/`DEMO_SHARD_2_SPECS`, ~280 s każda) albo (shard 3) całą
    resztę — dopełnienie obu list, nowy spec trafia tam sam, bez dopisywania (jak część 1
    trybu `full` w `playwright.applications-fixture.config.ts` niżej); bez `--shard`
    w komendzie. Każdy shard zapisuje raport cząstkowy (blob, `E2E_BLOB_NAME`);
  - `e2e-perf` („E2E perf (lab CWV + INP)”) — pomiary czasu w jednym miejscu: projekt
    `chromium-timing` (`--no-deps`, INP dialogu #393) i `perf-lab.mjs` (lab CWV + INP-proxy #395);
  - `e2e-fixtures` („E2E fixtures (full 1/2|full 2/2|error 1/1)”) — `playwright.applications-fixture.config.ts`
    (`next dev`, dane fikcyjne); tryb `full` w 2 częściach (`TEST_APPLICATIONS_FIXTURE_PART`,
    jawna lista części 2 `FULL_PART_2` w konfiguracji — `--shard` dzieli po liczbie testów
    i oba speci lejka trafiały do jednego shardu), każda część zapisuje blob jak shardy demo;
  - `e2e-real` („E2E real flow (PostgreSQL 16)”) — `npm run test:e2e:real` na usłudze
    `postgres:16` (#351, #66); od #1239 **blokujący** (bez `continue-on-error`, po 12/12 zielonych
    przebiegach `main`; zależność jobu zbiorczego `e2e`) i w dwóch krokach: RECRUITMENT (przepływy
    rekrutacyjne) oraz `E2E_PORTAL_LEGAL_MODE: CLASSIFIEDS_ONLY` (`saved-search-classifieds`, #1148);
  - `e2e` („E2E (Playwright)”, wymagany check o stałej nazwie) — job zbiorczy z `always()`,
    pada, gdy którykolwiek shard/pomiar/część fixture/przepływ real nie jest `success`; łączy bloby
    (`playwright merge-reports --config playwright.merge.config.ts`: html + raport flaków #375).
    `failOnFlakyTests` obowiązuje w każdym shardzie.
- `.github/workflows/backup-image.yml` („Backup image (build + scan)”, #751) — OSOBNY workflow
  (decyzja właściciela 2026-10-02: skan obrazu kopii nie blokuje wdrożenia web): build
  `docker/backup/Dockerfile` od zera, smoke, SBOM i skan z bramką; przy zmianie obrazu/skryptów
  (`paths`), ręcznie i co tydzień (opis `docs/railway/BACKUP_RESTORE.md`).
- `docs/DEPLOYMENT.md` — jedna produkcja Railway z `main`, z włączonym `Wait for CI`.
- `scripts/check-ci-workflows.mjs` — strażnik uruchamiany w jobie `lint` (test z kontrolami
  ujemnymi: `tests/unit/ci-workflows-guard.test.ts`). Pilnuje też (#1241/#1246/#1247/#1250):
  `forbidOnly: !!process.env.CI` w KAŻDEJ konfiguracji Playwrighta uruchamiającej testy (demo,
  fixture, real-flow) i regułę ESLint `no-restricted-syntax` w `tests/**` (`.only`, statyczne
  `.skip`/`.fixme`, `xit`/`fit`; warunkowe `test.skip(warunek, 'powód')` dozwolone); zgodność
  `FIXTURE_ONLY_SPECS` z `ERROR_SPECS ∪ FULL_SPECS`; w jobie „Migration runner” osobny krok
  ciągłości numeracji (`scripts/db/check-migration-numbering.mjs` — numer tymczasowy w PR = ten
  krok czerwony z założenia, na `main` luka = błąd), integrację bez `runtime-logins.test.ts`
  (wynik reszty nie ginie pod luką) i test operatora loginów tylko przy ciągłej numeracji;
  każdą akcję przypiętą do 40-znakowego SHA z komentarzem wersji (`# v7.0.1`; aktualizacja =
  nowy SHA + komentarz, np. `git ls-remote --tags https://github.com/actions/<akcja>.git`).

**Reguły CI:**
- Nazwy jobów (checków) są stałe — wymagają ich scalanie i Railway `Wait for CI`. Liczba
  shardów zmienia się w jednym miejscu (nazwa, macierz, `DEMO_SHARDS`/jawne listy speców
  w `playwright.config.ts`) — strażnik pilnuje zgodności; części fixture'ów: macierz
  `include` = części dozwolone w konfiguracji fixture (strażnik).
- Każdy job ma `timeout-minutes`. Nowy push do PR anuluje trwający przebieg tego PR;
  przebiegi `main` nigdy nie są anulowane (Railway potrzebuje wyniku każdego SHA).
- Nie wypychaj pustych commitów ani push-ów „na odświeżenie”; ponawiaj tylko uzasadnione joby.
- Powrót na self-hosted tylko na wyraźną prośbę właściciela (`docs/SELF_HOSTED_RUNNERS.md` — archiwalnie).
- PR z forków dostają pełne CI (#671): `pull_request` (nigdy `pull_request_target`/`workflow_run`),
  token `contents: read`, żadnych sekretów, uprawnień jobu ani `environment` w `ci.yml`, bez warunków
  `head.repo` pomijających forki (strażnik `check-ci-workflows.mjs`, kontrole ujemne). Krok wymagający
  sekretów = osobny workflow uruchamiany po akceptacji. Pierwszy przebieg PR nowego współtwórcy
  zatwierdza opiekun (Settings → Actions → „Require approval for fork pull requests”). Self-hosted
  runner dla publicznego repo z forkami jest niedopuszczalny (strażnik odrzuca `self-hosted`).

---

## 11. Roadmapa / status (etapy 1–8 wg specyfikacji)

Legenda: `[x]` zrobione · `[~]` częściowo/scaffold · `[ ]` do zrobienia.
**Model kontynuujący: wybierz pierwszy niezaznaczony punkt, zrób, zaznacz, zaktualizuj ten plik.**

> **Tryb ogłoszeniowy (#1128, 28.09.2026).** Pozycje oznaczone „wyłączone w trybie ogłoszeniowym”
> opisują zachowany kod funkcji rekrutacyjnych, które nie działają produkcyjnie. Historia zostaje;
> nie wznawiaj tych funkcji bez nowej decyzji właściciela.

> 🔒 **Audyt bezpieczeństwa 2026-07-23** (`docs/audit/audyt-2026-07-23.md`) + remediacja
> (`docs/REMEDIATION-2026-07-23.md`). Zamknięte P0-01..04 oraz P1-01..14 i P2-01 (migracje
> `0011`–`0016` zweryfikowane testami adwersaryjnymi na PostgreSQL 16 — teraz również **w CI**,
> job `rls` na usłudze `postgres:16`, `supabase/tests/*`). Domknięte od poprzedniej fali:
> widoki publiczne firm/ofert (P1-03/04 → `0014`), outbox e-mail (P1-13 → `0012`/`outbox.ts`),
> revoke trackerów + serwerowy log zgód (P1-08/09), pełna CSP (P2-01 → `next.config.mjs`,
> wariant nonce/strict-dynamic = follow-up z E2E), integracyjne testy RLS w CI. Zależności:
> Dependabot 0 critical / 0 high (23 moderate wymagają majorów next-intl v4 / Sentry v9+ — osobna
> migracja). Statusy poniżej rozdzielają `schema/scaffold` od `backend flow` i `tested` —
> nie oznaczaj funkcji jako gotowej bez działającego przepływu.
>
> 🔒 **Audyt multidyscyplinarny 2026-07-24** (8 dziedzin, adwersaryjna weryfikacja; 45 potwierdzonych:
> 0×P0, 7×P1, 14×P2, 24×P3). Remediacja: migracje `0020`/`0021` + naprawy app-layer. Zamknięte P1:
> maszyna stanów offers/applications egzekwowana w BAZIE (koniec fałszowania akceptacji oferty i skoków
> statusu przez pracodawcę bezpośrednim PATCH — dowód: `supabase/tests/rls.sql` sekcja I), opt-out e-mail
> (`enqueue_email` czyta `notification_preferences`), spójny `get_public_jobs_count` (locale), StatusPill
> kontrast AA, e-maile Auth w języku odbiorcy (Send Email Hook `/api/auth/email-hook`). P2/P3: revoke PII,
> relacja send_offer, respond_to_offer guard, atomowy claim outboxa + `get_conversation_summaries` (0021),
> indeksy trigram, React `cache()` w panelach, lejek z historii, focus-trap/aria/ARIA, rate-limit IP,
> timingSafeEqual, magic-bytes uploadu, JSON-LD escape, noindex auth, OG/hreflang. **Odłożone (P3, świadomie):**
> `is_demo` na tabelach procesowych (Inv. #12 — prod nie ładuje seed), retencja `email_deliveries` (cron),
> nonce/strict-dynamic CSP (E2E). Weryfikacja: tsc/lint/vitest/build + RLS+seed (PG16) + Playwright — zielone.
>
> 🔒 **Weryfikacja remediacji 2026-07-24** (adwersaryjna kontrola napraw 0020–0022 + email-hook; 6 potwierdzonych:
> 0×P0, 0×P1, 2×P2, 4×P3). Domknięte migracją `0023` + app-layer: (P2) `get_conversation_summaries` usunięto
> `counterparty_name` (SECURITY DEFINER omijało RLS na `profiles` — kandydat mógł wprost pobrać imię+nazwisko
> rekrutera; app-layer i tak rozwiązuje drugą stronę pod RLS); (P2) email-hook obcina prefiks `v1,whsec_`
> (Supabase podaje sekret z `v1,`) — inaczej wszystkie e-maile Auth failowały weryfikację; (P3) email-hook:
> kontrola świeżości `webhook-timestamp` (±300 s, anty-replay) + fail-closed 500 zamiast „cichego" 200 przy
> dryfcie env; (P3) `getMyApplications` używa nowego `get_applied_jobs_display` (własne aplikacje niezależnie
> od statusu oferty — koniec pustych tytułów dla ofert zamkniętych/unverified; dowód: `rls.sql` I9); (P3)
> nieaktualny komentarz outbox.ts. Weryfikacja: tsc/lint/vitest/build + RLS+seed (PG16) + Playwright — zielone.
>
> 🔒 **Audyt zewnętrzny 2026-07-24** (`AUDYT_APLIKACJI_PRACUJBE_...md`, ~60 ustaleń: 0×P0, ~14×P1,
> ~20×P2, reszta P3; NO-GO na produkcję). Teza: **niespójna granica zaufania** — flow mają bezpieczne
> RPC, ale RLS/granty pozwalały klientowi na bezpośredni DML omijający walidację/limity/powiadomienia.
> Remediacja falami (weryfikacja adwersaryjna na PG16 przed każdą naprawą):
> **Wave A (0025) — ZROBIONE:** RPC-only DML — `revoke insert/update/delete` na applications/offers/
> conversations/conversation_members/messages od anon/authenticated (zostaje SELECT pod RLS; SECURITY
> DEFINER RPC + triggery integralności piszą dalej). `withdraw_application` RPC (koniec bezpośredniego
> PATCH aplikacji). SEC-01: `rate_limit_hit` odebrany anon/authenticated → woła go tylko service_role
> (admin client); usunięto zduplikowany limiter w `actions/jobs.ts`. Dowód: `rls.sql` sekcja J
> (J1–J8: bezpośredni INSERT/UPDATE/DELETE odrzucany, withdraw RPC działa/idempotentny/nie-cudzy,
> limiter tylko service_role).
> **Wave B (0026) — ZROBIONE:** SEC-03 — `get_public_jobs`/`_count` clamp p_limit∈[1,100],
> p_offset≤10000, keyword/city ≤100 znaków (`left`), locale z allow-listy. SEC-04 — twarde sufity
> długości pól tekstowych jako CHECK na tabelach (applications.message/phone/idem, offers.message/idem,
> messages.body, companies.name/vat) — egzekwowane niezależnie od ścieżki (RPC/trigger/definer). Dowód:
> `rls.sql` sekcja K (K1 clamp limitu, K1b długi keyword, K1c allow-lista locale, K2/K2b CHECK długości).
> **Wave D (0027) — ZROBIONE:** SEC-08 — dostęp do rozmowy firmowej wymaga AKTYWNEGO członkostwa
> (`is_conversation_member` gejtuje po `company_id`: aktywny członek LUB strona kandydata; były pracownik
> z `is_active=false` traci dostęp — jeden chokepoint domyka RLS odczytu i RPC send_message/mark_read).
> SEC-11 (część) — `company_can_view_candidate` filtruje `deleted_at is null` (soft-deleted relacja nie
> daje PII; okno retencji czasowej = decyzja polityki, odłożone). Dowód: `rls.sql` sekcja L. **Legal
> (FUN-09) — safe default:** strony prawne/informacyjne (placeholder) → `noindex` (`_legal/legal-page.tsx`)
> i usunięte z sitemap; E2E asercja noindex regulaminu.
> **Wave E1 (0028) — ZROBIONE:** FUN-04 — koniec cichej utraty danych onboardingu: transakcyjne RPC
> `set_candidate_skills/languages/certificates` (replace-all, dedup, RPC-only DML na relacjach
> kandydata); kroki 3/5 realnie zapisują. Dowód: `rls.sql` sekcja M.
> **Wave E1b (0029) — ZROBIONE:** FUN-05 — kompletność liczona w DB (`finish_onboarding`), a nie
> ustawiana przez klienta; guard trigger blokuje `authenticated` przed zmianą `profile_completed`/
> `is_searchable` (kolumnowy REVOKE nie działa przy grancie table-level); `set_candidate_searchable`
> (opt-in tylko dla kompletnego profilu). Dowód: `rls.sql` sekcja N.
> **Wave E2 (0030) — ZROBIONE:** FUN-03 — relacje `job_languages`/`job_certificates` (RLS jak
> job_skills); kreator (krok 7) realnie zapisuje języki i certyfikaty; `get_public_job` zwraca
> języki (koniec pustej listy), `get_job_match_profile` zwraca języki+certyfikaty → matching je
> uwzględnia. Dowód: `rls.sql` sekcja O.
> **Wave E3 (0031) — ZROBIONE:** FUN-01 — transakcyjne `publish_job` (autoryzacja + firma
> verified + status=draft + KOMPLETNOŚĆ: tytuł/miasto/region bez placeholderów, tłumaczenie,
> wymaganie obowiązkowe) + guard trigger `guard_job_publish` (aktywacja oferty tylko przez RPC;
> klient nie ustawi status='active' bezpośrednio). Dowód: `rls.sql` sekcja P. FUN-02 (pełna
> transakcyjność per-krok) — częściowo: publish atomowy, relacje replace-all; pełne owinięcie
> każdego kroku w RPC = follow-up.
> **Wave C1 (0032) — ZROBIONE:** SEC-10 (owner invariants) — trigger `enforce_owner_invariants`
> na company_members: rolę owner nadaje/odbiera tylko aktywny owner; nie można zdemotować/
> usunąć/dezaktywować OSTATNIEGO aktywnego ownera (koniec przejęcia firmy przez admina i
> osierocenia firmy). Dowód: `rls.sql` sekcja Q.
> **Wave C2 (0033) — ZROBIONE:** SEC-09 (capability RBAC) — `can_manage_jobs`/`is_job_manager`
> (recruiter+ = owner/admin/recruiter). ZAPIS ofert (jobs + job_translations/requirements/skills/
> languages/certificates), `publish_job` i dostęp do PII kandydata (`company_can_view_candidate`)
> wymagają recruiter+ — zwykły `member` traci prawa rekrutacyjne (odczyt ofert firmowych zostaje).
> Dowód: `rls.sql` sekcja R. Bramkowanie propozycji/zmian statusu do recruiter+ = follow-up C3
> (te ścieżki już wymagają członkostwa i idą przez SECURITY DEFINER RPC).
> **Wave F — SEC-19 (fail-closed env) — ZROBIONE:** jawny `APP_MODE` (`env.appMode`/`isProductionMode`/
> `isAppReady`); w trybie produkcyjnym brak konfiguracji Supabase → middleware zwraca **503
> maintenance** (nie fikcyjny tryb demo), a `GET /api/health` → 503 `{status:"unconfigured"}`
> (readiness dla monitoringu). Demo (lokalnie/staging/E2E) bez zmian. Zweryfikowane runtime
> (503 na stronie i /api/health).
> **Wave F — FUN-06 (matching) — ZROBIONE (część):** `scoreMatch` — praca zdalna znosi
> ograniczenie lokalizacji (pełne punkty), promień dojazdu (`radiusKm>=50` przy dopasowaniu
> regionu → pełne punkty), wymagania OBOWIĄZKOWE jako próg (niespełnione → wynik nie „good",
> cap 65). `get_job_match_profile` zwraca `remote` (0034). i18n `match.criteria` (remoteJob/
> withinCommuteRadius). Testy: matching.test 10 (było 7). **Odłożone (FUN-06):** poziomy
> języków/certyfikatów (wymaga rozszerzenia MatchCandidate/MatchJob o levele) + geokodowanie.
> **Wave F — FUN-07 (multi-company) — ZROBIONE:** jeden cookie-aware kontekst aktywnej firmy
> (`src/lib/company-context.ts`, cookie `pb_active_company` WALIDOWANA względem członkostw —
> nie ufamy jej), akcja `setActiveCompany` (walidacja + cookie + revalidate), REALNY przełącznik
> `CompanySwitcher` w sidebarze; wszystkie pickery (jobs createDraft, employer/company/billing
> loadContext, company action) czytają aktywną firmę zamiast „pierwszego członkostwa"; panel
> pokazuje realną firmę i użytkownika (koniec atrapy „AGO Jobs & HR / Jan Kowalski" — FUN-13).
> **Wave F — SEC-17 (seed) — ZROBIONE:** seed DEMO ma bezpiecznik — odmawia uruchomienia na
> bazie z realnymi (nie-demo) firmami/ofertami (ochrona przed przypadkowym seedem znanych kont
> na staging/produkcji); czysta/lokalna/CI baza przechodzi. Test negatywny w `test-seed.sh`.
> **P1 możliwe autonomicznie — ZAMKNIĘTE** (SEC-01/03/04/05/06/07/08/09/10/17/19, FUN-01/03/04/
> 05/06(część)/07). **FUN-08 (billing) — HISTORYCZNE, WYŁĄCZONE (#51):** dawny Stripe
> checkout/webhook nie działa w bezpłatnym MVP (patrz Etap 7, „Płatności”). **P1 wymagające infra/treści (otwarte):** CI-01/02/07
> (separacja runnerów + twarda bramka RLS/Storage — infra), FUN-09 (realna treść prawna — noindex
> safe default zrobiony). **P2/P3 — ZROBIONE:** SEC-16 (0035, in_app opt-out trigger),
> SEC-15 (outbox: sprawdzanie błędów zapisu po wysyłce + log do reconciliacji), SEC-14 (0036,
> `processed_webhooks` dedup po event.id/webhook-id + limit rozmiaru body dla Stripe/email-hook;
> dowód rls.sql T). **C3 (0037) — ZROBIONE:** propozycje (enforce_offer_integrity
> INSERT → can_manage_jobs) i zmiany statusu aplikacji (transition_application → is_job_manager)
> wymagają recruiter+; respond_to_offer (kandydat) bez zmian. Dowód: rls.sql sekcja U.
> **CI-08 (SCA) — ZROBIONE:** osobny job `sca` (`scripts/sca-audit.sh`, `npm audit
> --package-lock-only`) na self-hosted runnerze blokuje CI przy PRAWDZIWYCH podatnościach
> high/critical (obecnie 0). Audyt z lockfile = deterministyczne drzewo (omija błąd „Invalid
> package tree" przy artefakcie node_modules); skrypt parsuje JSON i blokuje tylko na realnych
> podatnościach — niestabilny/wygaszany endpoint audytu npm (400/5xx) nie wywala CI.
> **Utwardzenie klasyfikatora (#643, bez migracji):** `scripts/lib/sca-audit-outcome.mjs` odczytuje
> `metadata.vulnerabilities.high/critical` tylko jako nieujemną, skończoną liczbę całkowitą (brak
> pola = 0); tekst, liczba ujemna, ułamek, `NaN`/`Infinity`, tablica, obiekt czy `boolean` w tym
> polu dają `unrecognized` (blokuje CI) zamiast dawnego `Number(value) || 0`, które cicho zamieniało
> taką wartość w zero i mogło dać `clean` bez dowodu. Dowód: `tests/unit/sca-audit-outcome.test.ts`
> (kontrole ujemne). **QA-01 (a11y w CI) —
> ZROBIONE:** bramka axe-core (`@axe-core/playwright`) w `tests/e2e/a11y.spec.ts` (uruchamiana w
> jobie `e2e`) blokuje przy naruszeniach WCAG 2.x A/AA critical/serious na home/liście ofert/
> logowaniu/rejestracji; domknięte realne naruszenia kontrastu tokenami: `--muted-foreground`
> przyciemniony do AA (`#566881`), nowy `--accent-on-dark` (`#60A5FA`) dla „.be" na granatowej
> stopce, tekst akcentu na tincie `bg-accent/10` → `text-accent-dark`, tekst stanu (verified/%,
> „zawsze wł.") → `-text` warianty (`text-success-text`), usunięty zdublowany landmark `<main>`
> na stronie głównej. **Pozostałe follow-up (nieautonomiczne):** SEC-12 (skan CV — wymaga AV/usługi
> zewn.), FUN-02 (pełna transakcyjność każdego kroku kreatora — duży refactor), CI-01/02/07
> (separacja runnerów + twarda bramka RLS/Storage — infra), FUN-09 (treść prawna do zatwierdzenia),
> perf/CWV (Lighthouse w CI — pozostała część audytu H).

> 🔒 **Audyt gotowości produkcyjnej 2026-07-24** (`audyt_produkcja_pracujbe.md`, NO-GO: 4×P0,
> 25×P1, 22×P2, 5×P3; teza „krytyczne procesy zwracają sukces mimo niespójnego zapisu").
> Remediacja falami, każda weryfikowana adwersaryjnie na PG16 (sekcje rls.sql V–X) + tsc/lint/
> vitest/build/E2E:
> **P0 (0038 + webhook-inbox.ts) — WSZYSTKIE ZAMKNIĘTE:** P0-01/02 — inbox webhooków ze stanem
> (processing→completed); duplikatem do pominięcia jest tylko `completed`, więc awaria w trakcie
> pozwala na reprocessing (koniec trwałej utraty płatności/e-maili Auth). P0-03 — Stripe sync
> sprawdza KAŻDY błąd DB i propaguje (500→retry); płatność idempotentna per faktura (koniec
> dubletów invoice.paid+payment_succeeded). P0-04 — nieskonfigurowany webhook w produkcji → 503
> (nie „ciche" 200 gubiące płatności). Testy: webhook-inbox (6).
> **P1 — ZAMKNIĘTE (autonomiczne, DB+app, dowód rls.sql V–X):** P1-01 (0039: odczyt applications/
> offers/matches/rozmów tylko recruiter+ — koniec wycieku PII do zwykłego membera; apply_to_job
> powiadamia tylko recruiter+), P1-02 (get_conversation_summaries gejtowane bieżącym dostępem —
> b. członek nie widzi podglądu), P1-03 (0040: edycja firmy tylko owner/admin), P1-04 (rola
> candidate egzekwowana w ensure_candidate_profile/apply_to_job; layout odsyła admina), P1-05
> (transition_application: macierz przejść + FOR UPDATE + CAS — koniec hired→rejected itp.),
> P1-06 (withdraw tylko ze stanów aktywnych), P1-07 (onboarding sprawdza wynik finish_onboarding),
> P1-08 (onboarding wczytuje relacje — koniec kasowania skills/languages/certs przy wznowieniu),
> P1-10 (kreator edytuje tylko draft — JOB_NOT_DRAFT), P1-17 (worker e-mail 503 przy realnym
> problemie + idempotency key Resend), P1-18 (readiness: service-role + https URL; /api/health
> checks), P1-19 (jedno źródło środowiska isProductionDeployment — spójne HSTS/noindex/robots/
> sitemap), P1-23 (0041: idempotencja aktywnej pary + wygaśnięcie + CAS propozycji). P2-19 (UUID
> w respondToOffer), P3-03 (X-Frame-Options DENY).
> **P1 — DOMKNIĘTE w kolejnej fali (0042–0044 + strony paneli):** P1-11 (0042: publikacja wymaga
> opisu+obowiązków; widełki już CHECK-iem), P1-13 (realne strony paneli: kandydat aplikacje/
> oferty-polecane/zapisane/propozycje/profil + getSavedJobs/getMyOffers; pracodawca oferty/
> kandydaci/aplikacje/statystyki; /help→/pomoc), P1-14 (usunięte nieaktywne UI z dashboardu —
> checkboxy/bulk/menu-TODO → podgląd read-only), P1-16 (0042: companies.provider_customer_id +
> reużycie klienta + idempotency key + guard aktywnej subskrypcji + locale URL), P1-22 (0044:
> głębsza walidacja OOXML DOCX + flaga scan_status/kwarantanna; kolejność delete DB→Storage;
> **AV = świadomie odłożone, usługa zewn.**), P1-24 (0043: RPC-only record_consent — niezmienny
> receipt visitor/wersja/IP/UA; **treść prawna nadal placeholder+noindex, do zatwierdzenia**).
> P1-15 (0045: tabela discount_redemptions + reserve/finalize/release; startCheckout rezerwuje
> i ZATRZYMUJE na nieprawidłowym kodzie; webhook finalizuje; dowód rls.sql sekcja Z).
> P1-12 (0046: get_public_jobs/_count z KOMPLETEM filtrów sidebara + sort w SQL; strona liczy
> wyniki/licznik/paginację w SQL — koniec liczenia nad wycinkiem 200; facety = podpowiedź nad
> próbką; dowód rls.sql sekcja AA), P1-09 (0047: atomowe RPC replace relacji kreatora —
> set_job_requirements/skills/languages/certificates; koniec opróżniania relacji przy częściowej
> awarii; dowód sekcja BB; pełne per-krok owinięcie update+relacje = drobny follow-up).
> Dowód całości: rls.sql sekcje P/Y/Z/AA/BB. **WSZYSTKIE autonomiczne P1 ZAMKNIĘTE.**
> **P1 NIE-AUTONOMICZNE (pozostają — wymagają Ciebie/infry/zewn.):** P1-20/21/25 (twarda bramka
> RLS + migracje/rollback w deployu + ephemeral runners = infra), P1-22-AV (skan antywirusowy =
> usługa zewn.; walidacja+kwarantanna gotowe), P1-24-treść (realna treść prawna = prawnik;
> techniczny receipt gotowy).
> **P1 NIE-AUTONOMICZNE:** P1-20/21/25 (twarda bramka RLS + migracje/rollback w deployu +
> ephemeral runners = infra), P1-22-AV (skan antywirusowy = usługa zewn.), P1-24-treść (realna
> treść prawna = prawnik).
>
> 🔒 **Audyt niezależny 2026-07-24 (AUDIT_REPORT, NO-GO: 2×P0, 25×P1, 14×P2, 4×P3, 4×P4).**
> Remediacja falami (migracje `0048`–`0051`), każda zweryfikowana adwersaryjnie na PG16 (rls.sql
> sekcje CC–EE + D4b) + tsc/lint/vitest/build:
> **P0 — OBA ZAMKNIĘTE:** P0-01 (checkout w produkcji wymaga STRIPE_WEBHOOK_SECRET —
> `isBillingProviderReady`, inaczej `BILLING_UNAVAILABLE`; koniec pobrania płatności bez
> synchronizacji subskrypcji). P0-02 (`0050`: `checkout_intents` + partial-unique 'pending' per
> firma + `begin_checkout` z advisory lock i kontrolą aktywnej sub → stabilny intent_id = klucz
> idempotencji Stripe; webhook domyka `complete_checkout`; dwa równoległe checkouty nie tworzą
> dwóch subskrypcji — `CHECKOUT_IN_PROGRESS`; dowód sekcja DD).
> **P1 autonomiczne — ZAMKNIĘTE:** P1-07 (loader onboardingu: jawny wynik demo/ok/error — błąd
> odczytu → retry, NIGDY pusty edytor kasujący dane replace-all), P1-08 (`0051`: umiejętność
> realnie przechodzi mandatory↔optional — usuwamy etykietę z drugiego zakresu przed insertem;
> dowód EE), P1-09 (koniec danych demo jako realnych: realna nazwa użytkownika lub neutralna
> etykieta „Twoje konto"; realne imię w powitaniu pracodawcy; liczniki kategorii/miast REALNE
> `get_public_jobs_count` spójne z filtrem linku, albo pomijane w demo), P1-11 (`0048`: wygasłe
> oferty znikają z `job_is_public`/`get_public_jobs`/`_count`/`get_public_job` — filtr
> `expires_at`; dowód CC), P1-13 (sitemap ofert stronicowany do 5000), P1-22 (błąd
> `finalize_discount` w webhooku → 500/retry zamiast cichego połknięcia).
> **P2/P3 autonomiczne — ZAMKNIĘTE:** P2-03 (`0049`: send_offer domyślny expires_at
> `least(job, now()+30d)`; dowód D4b), P2-05 (twardy limit body webhooków przy STREAMINGU —
> `readTextWithLimit`, nie tylko po Content-Length), P3-01 (/api/health publicznie tylko `status`;
> szczegóły za `HEALTH_CHECK_SECRET`/poza produkcją), P3-02 (allowlista next/image + CSP img-src
> zawężone do hosta Supabase), P3-03 (usunięto sztuczny `lastModified=now` ze stron statycznych),
> P3-04 (billing nie połyka błędów DB — INTERNAL vs NOT_FOUND).
> **P1 NIE-AUTONOMICZNE / duże funkcje (OTWARTE — wymagają Ciebie/produktu/infry/prawnika):**
> P1-01 (entitlements planów — brak warstwy policy/limitów), P1-02 (dostęp firmy do CV = model
> grantów + AV, usługa zewn.), ~~P1-03 (pipeline materializacji `matches`)~~ — zrobione (migracja `0147`, Etap 5), P1-04 (edycja/wznowienie
> draftu + cykl życia oferty), ~~P1-05/P1-06 (paginacja + widoki szczegółu aplikacji/kandydata)~~ — zamknięte: kandydat
> (szczegół zgłoszenia `/candidate/aplikacje/[id]`, historia stronicowana) i pracodawca (Etap 4, migracja `0152`),
> P1-10 (kanoniczny model miast — zrobione: `jobs.location_id`, migracja `0153`, patrz Etap 2), P1-14 (realne statystyki/lejek), P1-15 (treść prawna = prawnik), P1-16
> (receipt akceptacji regulaminu przy rejestracji), P1-17 (eksport/usunięcie konta GDPR — część
> techniczna dla kandydata zrobiona w #486, dla pracodawcy w 0161, patrz Etap 7),
> P1-18 (moderacja zgłoszeń end-to-end — decyzja z egzekucją #42 zrobiona, odwołania #43 otwarte), P1-19 (webhook Resend bounce/complaint = zewn.),
> P1-20 (harmonogram workera e-mail = cron/infra), P1-21 (reconciliacja faktur + PDF),
> P1-23/24/25 (twarde bramki CI RLS/E2E + migracje w deployu + ephemeral runners = infra),
> P2-06 i P4-* (atomowy lease inboxa, alerty/CWV; P2-13 zarządzanie zespołem zamknięte w #403); P2-04 (paginacja
> admina) zamknięte w #418.
> P1-12 (JSON-LD `validThrough` z `expires_at`, `baseSalary.value.unitText` z `salary_period`) —
> zamknięte: `get_public_job` zwraca obie kolumny od 0114, JSON-LD #313/#22; dowód `rls.sql` sekcja JP12
> (kontrola ujemna: definicja bez `expires_at`) i `jobs-postgres.test` (wiersz → JSON-LD).

### Etap 1 — fundament
- [x] Architektura, stack, konfiguracja projektu (Next 15, TS strict, Tailwind)
- [x] System wizualny: tokeny kolorów, typografia (DM Sans od #5/#7; wcześniej Inter), globals.css
- [x] i18n: routing `[locale]`, next-intl, pliki `pl/nl/fr/en`, middleware
- [x] Model danych: migracje SQL (schemat + enumy + indeksy)
- [x] RLS: polityki bazowe
- [x] Role i routing paneli (candidate/employer/admin, noindex)
- [x] CI (`ci.yml`, od 2026-09-23 na `ubuntu-latest`) + natywne wdrożenie Railway z `main`
- [x] Centralny system błędów + kody + kanał błędów (webhook Discorda od #571; wcześniej Sentry)
- [x] shadcn/ui — zestaw komponentów w `src/components/ui` (API shadcn, styl „Ludzie i praca”, tokeny,
  bez hexów): button, input, textarea, label, checkbox (Radix), select (własny, API Radix Select;
  `aria-labelledby` listy zawsze wskazuje na faktycznie wyrenderowany `id` triggera, także gdy
  wywołujący nadpisuje wygenerowany `id` — regresja #819, test `select-trigger-id`),
  card, badge (`success` = `success-text` na `success/10`, AA), toast, light-dialog (#393) +
  confirm-dialog, stepper, status-pill, match-bar, stat-card oraz **skeleton**, **table**
  (domyślne klasy = `TH`/`TD`/`TD_WRAP` z `panel-styles.ts`, `TableRowHeader` = `<th scope="row">`),
  **pagination** (nav + lista, bez `Slot` — zostaje serwerowy) i **alert** (baza `NOTICE`, warianty
  note/error/success, `error` = `role="alert"`). Podmienione ręczne odpowiedniki bez zmiany wyglądu:
  tabele `/admin/uzytkownicy` i `/admin/firmy`, `AdminPager`, szkielet `MessagesLoading`, błędy
  zespołu (`TeamMembers`/`TeamInvite`/`MyTeamInvitations`), `RecruiterOnlyNote`. Test `ui-kit`
  (klasy identyczne z kalką, kontrole ujemne) + strażnik: surowy `<table>` tylko w `ui/table.tsx`.
  Świadomie BEZ nowych pakietów Radix (budżet JS #395, INP #393): natywne `<select>`/radio w formularzach
  GET i server actions (działają bez JS, strony admina serwerowe), własne menu z pełnym ARIA
  (`ApplicationActions` #341, `ApplicationStatusMenu`, `LocaleSwitcher` na stronach publicznych),
  dialogi na `LightDialog`; tabs/tooltip/dropdown-menu dodawać dopiero z realnym użyciem (tooltip na
  dotyku = ryzyko a11y). Publiczne `Pagination` (lista ofert) zostaje osobne.

### Redesign wg makiet — HISTORYCZNE (`docs/DESIGN_SCREENS.md`), zastąpione „Ludzie i praca”
> Obowiązujący wygląd = kalka prototypu `docs/design/people-passport/prototype` („04 Ludzie i praca”,
> sekcja 2): biel, czerwień `#D92932`, czerń `#151515`, DM Sans. Granatowa paleta (#0F2A47/#2563EB)
> i Inter zostały usunięte z kodu (strażnik `tests/unit/legacy-palette.test.ts` z kontrolą ujemną).
> Matryca zgodności ekranów z prototypem (1280/390 px, nakładka zrzutów + style kluczowych
> elementów): `docs/design/people-passport/MATRIX.md`, pomiar `node scripts/design/compare-prototype.mjs`
> (poza CI). Poniższe punkty opisują strukturę komponentów z dawnych makiet — wygląd każdego z nich
> jest już w stylu paszportu (#2–#7).
- [x] ~~Paleta granatowa~~ → tokeny „Ludzie i praca” w `globals.css` (`--primary` #D92932, `--pp-*` prototypu) + `tailwind.config.ts`, `manifest.ts` theme_color #D92932
- [x] Komponenty z makiet: JobCard(wiersz+hover), FilterSidebar+FilterSheet, StatusPill, StatCard, MatchBar, Stepper, DashboardShell(sidebar+bottom tab bar), NotificationsDropdown, Toast, ApplyModal, RecruitmentFunnel, PricingPackageCard
- [x] Odwzorowanie 7 ekranów (home, lista+filtry, detal+modal, panel kandydata, onboarding, panel pracodawcy, stany cookies) — **UI gotowe**; panele na danych DEMO (podpięcie realnych danych = warstwa backendu, niżej)
- [x] Restrukturyzacja layoutów: root=(html/body/providery/cookies), `(public)/layout`=Header+Footer, `(auth)/layout` minimalny, panele=własny layout (DashboardShell, noindex)

### Etap 2 — strony publiczne
- [x] Strona główna (hero + sekcje) SSR — redesign wg makiety 01
  Teksty jako portal ogłoszeń (#1149, #1151, bez migracji): strona główna (hero, karta
  „Zapisane wyszukiwania” w slocie `.p-profile-note` → lista ofert, kroki „Jak to działa?”:
  znajdź → sprawdź warunki → aplikuj u pracodawcy → zacznij pracę), metadane i manifest PWA
  (`metadata.home*`), landingi, stopka (także stopka e-maili), poradnik o języku, powitanie
  e-mail, `/dla-pracodawcow` (sekcje „Twoje ogłoszenie” i „Kontakt z kandydatami”: kanał
  aplikowania, statystyki ogłoszenia, zespół), `/pomoc` (jak aplikować, czy portal przekazuje
  dane, po co konto; znaczenie weryfikacji z kotwicą `#weryfikacja` — `src/lib/help-anchors.ts`),
  banery statusu firmy i rejestracja bez „propozycji”. Odznaka `job.verified` = „Tożsamość firmy
  zweryfikowana”, na szczególe oferty link „Co oznacza weryfikacja?” → `/pomoc#weryfikacja`.
  Nieużywane klucze `home.benefit*` usunięte. Strażnik `tests/unit/classifieds-copy.test.ts`:
  zakazane frazy per język na przestrzeniach publicznych (`home`, `metadata`, `landing`,
  `footer`, `employers`, `help`, `guides`, `companyProfile` + wybrane klucze `jobs`/`job`/
  `auth`/`company`), treści poradników i stopce/powitaniu e-mail; kontrole ujemne („dopasowanie
  87%” w `home.*`, przywrócone `employers.contactProposalsDesc` i in. = czerwony). Klucze paneli
  i funkcji rekrutacyjnych (`job.match*`, `apply.*`, `dashboard.*`) — osobne PR-y #1128.
  **Do akceptacji właściciela:** nowe brzmienia (lista w PR).
  Hero (#166) wg `people.js`: teza w trzech wierszach, czerwona akcja „Przeglądaj oferty” +
  link do `/rejestracja`, podpis „ilustracyjne” na zdjęciu; E2E `home-hero.spec` (4 języki,
  320/1440 px, axe, kontrola ujemna).
  Wyszukiwarka `HeroSearch` bez JavaScriptu (#815, bez migracji): formularz ma teraz natywne
  `method="get"` i zlokalizowane `action="/{locale}/oferty-pracy"` — bez skryptu przeglądarka
  sama wysyła `keyword`/`city` na listę ofert (jak wyszukiwarka listy, `oferty-pracy/page.tsx`);
  z JavaScriptem `handleSubmit` nadal przechwytuje wysyłkę i nawiguje przez `useRouter`
  (`@/i18n/navigation`, bez przeładowania). Dowód: E2E `home-search-no-js.spec` (4 języki,
  `javaScriptEnabled: false`, kontrola ujemna: formularz bez `action`/`method` wraca na `/{locale}`).
- [x] Lista ofert + filtry (FilterSidebar/FilterSheet, chipy, sort, paginacja) — wg makiety 02; infinite scroll opcjonalnie później
  Wynagrodzenie (#188, 0080): suwak = EUR brutto/mies.; filtr, sort „najwyższe wynagrodzenie”,
  licznik i facety porównują ekwiwalent miesięczny (month bez zmian, year ÷ 12). Stawek
  godzinowych nie przeliczamy (godziny pracy to wolny tekst) — jak oferty bez kwoty nie odpadają
  z filtra i są na końcu sortowania; opis `filters.salaryPeriodNote` pod suwakiem. Lustro TS dla
  demo: `src/lib/salary-compare.ts`. Dowód: `rls.sql` sekcja SAL, `salary-compare.test.ts`.
  Jednostka filtra (0091): przełącznik „Miesięcznie / Za godzinę” (URL `salaryUnit=hour`,
  RPC `p_salary_unit`, widełki 10–40 EUR/godz.). Godzinowo porównujemy tylko stawki godzinowe;
  miesięcznych/rocznych nie przeliczamy na godziny (nieporównywalne → nie odpadają, sort na
  końcu). Jednostka steruje też sortem po wynagrodzeniu; zmiana jednostki zeruje widełki.
  Dowód: `rls.sql` sekcja SP188.
  Plan dla wartości parametrów (#1215, audyt PERF-01, migracja `0213` — numer tymczasowy):
  `get_public_jobs`/`_count`/`get_public_job_filter_facets` i `saved_search_jobs_after` to
  `plpgsql` z `set plan_cache_mode = force_custom_plan` i `set jit = off` (dawniej `LANGUAGE sql`
  = plan generyczny, pełny skan aktywnych ofert przy każdym wywołaniu). Tytuł do słowa kluczowego
  = podzapytanie, lista dołącza tłumaczenie do wierszy strony, indeksy częściowe klucza
  wynagrodzenia (`idx_jobs_public_salary_month`/`_hour`), facety biorą nazwę miejscowości po
  kluczu głównym. Kontrakt (sygnatury, wyniki z kolejnością, granty) bez zmian; blok FROM … WHERE
  nadal wspólny z kopią alertów (`saved-search-keyset-sync`). PG16, 9600 aktywnych ofert:
  strona 1 233 → 1 ms, sort po wynagrodzeniu 616 → 2 ms, licznik 212 → 5 ms, facety 245 → 41 ms
  (`docs/railway/OPERATIONS.md` §3). Dowód: `rls.sql` sekcja PF1215 (odciski wyników 34 kombinacji
  = definicje z 0194; kontrola ujemna: stara definicja czyta wszystkie oferty), rollback
  `0213_…down.sql` (`public-jobs-plan-rollback.sql`). Zmiana filtrów listy = ta sama zmiana
  w czterech funkcjach (w plpgsql).
  Lokalizacja z przecinkiem w nazwie (#845, bez migracji): miasto z wolnego tekstu kreatora
  (`jobs.city`, np. „Bruxelles, Belgique”) rozbijało się na URL na dwie wartości filtra
  (`f.locations.join(',')` + `splitParam`/`value.split(',')` nie rozróżniały separatora listy
  od przecinka wewnątrz jednej nazwy) — zaznaczenie takiej jednej opcji gubiło ofertę, dla
  której się pojawiła. `parseLocationsParam`/`serializeLocations` (`src/components/public/job-filters.ts`)
  escapują przecinek/backslash wewnątrz każdej nazwy backslashem przed złączeniem; jedno
  źródło dla JS-owego sidebara/sheetu, noscriptowego formularza (`FilterSheet.tsx`), usuwania
  chipa (`withoutValue` w stronie listy) i zapisanych wyszukiwań (`sidebarFiltersToParams`).
  Zgodność wstecz: istniejący adres wielu miast bez backslashy (`Brussels,Antwerp`) parsuje się
  jak dawny CSV. Dowód: `tests/unit/job-filters-location-param.test.ts` (round-trip, kontrola
  ujemna starego `split(',')`, zgodność wsteczna), E2E `job-filter-passport.spec.ts` bez zmian.
  Spójność wyszukiwania miast i filtrów (#1077/#1119, bez migracji): `resolveLocationKey`
  (`src/lib/locations/city-aliases.ts`) porównuje CAŁĄ nazwę po `nameKey` (lustro SQL `city_key` z
  0153: bez wielkości liter, diakrytyków i różnic spacji/myślnika), więc „Bruxelles”/„bruxelles”/
  „BRUXELLES” dają te same aliasy i ten sam zbiór ofert (fragment nazwy nadal = tekst). Landing
  miasta liczy indeksowalność (`generateMetadata`) tym samym filtrem co treść (`locations:
  cityAliases`), nie tekstem po nazwie w języku strony. Samo zawężenie górnej granicy wynagrodzenia
  („do 2000”) nie wysyła dolnej granicy z końca suwaka (`salaryQueryParams`, licznik
  `matchesSidebar`). Lustro demo (`getJobsFromDemo`) szuka jak SQL: słowo kluczowe tylko w tytule,
  miasto tylko w nazwie miasta. Dowód: unit `city-aliases` (#1077, kontrole ujemne starej reguły),
  `salary-compare`, `landing-empty-noindex`, `jobs-demo-search-mirror`. Miasto z dopiskiem i facet w języku widoku (#1119, #1076/M-4, migracja `0212` — numer
  tymczasowy): `location_lookup_key` (lustro `cityLookupKey` w `belgian-cities.ts`) usuwa z klucza
  miasta belgijski kod pocztowy (4 cyfry, prefiks B/BE), nawiasy/przecinki i nazwę kraju;
  `resolve_location_id` szuka najpierw pełnego klucza, potem klucza bez dopisku, więc „Bruxelles
  1000”, „B-1050 Bruxelles”, „Leuven (3000)”, „Aalst, België” dostają `location_id` (trigger zapisu,
  trigger słownika, backfill bez podbicia `updated_at`), a `location_filter_ids`/
  `search_city_candidates` stosują tę samą regułę do wartości filtra i wyszukiwania (sam kod
  pocztowy = brak miejscowości). Nazwy w języku serwisu: tabela `location_names` (miejscowość ×
  pl/nl/fr/en, tylko nazwy różne od `locations.name`, bez 10 miast z plików tłumaczeń; blok danych
  generuje `scripts/locations/build-migration.mjs` z migawki Wikidata) + `location_display_name(nazwa,
  język)` — zwraca nazwę tylko, gdy wskazuje TĘ SAMĄ miejscowość (nazwa facetu = wartość filtra;
  egzonim innej gminy, np. „Saint-Nicolas”, pominięty). Facety w bazie bez zmian: nazwę podmienia
  zapytanie aplikacji wokół RPC (`getPublicJobFilterFacets`, `$1` = język; te same nazwy scalone),
  podpowiedź miasta w kreatorze używa `resolve_location_id` i `location_display_name`. Dowód:
  `rls.sql` sekcja PC1119 (kontrole ujemne: `resolve_location_id` z 0153, funkcja nazw bez
  strażnika), rollback `0212_…down.sql` + `location-postal-names-rollback.sql` (ponowne nałożenie =
  backfill), unit `location-postal-names`, `matching-locations` (blok = generator, kontrola ujemna),
  `job-location`. **Otwarte:** matching liczy odległość z `cityKey` (bez klucza bez dopisku;
  funkcja wyłączona w trybie ogłoszeniowym), kod pocztowy bez nazwy miasta (brak słownika kodów).
  Nowe filtry listy (migracja `0194` — numer tymczasowy): waluta (#787) — widełki i sort
  „najwyższe wynagrodzenie” są w EUR, kwot w innej walucie nie przeliczamy (brak datowanego
  kursu): oferta w PLN jest nieporównywalna jak inny okres stawki (nie odpada z filtra kwoty,
  koniec sortowania; przeciążenia `job_salary_in_range/_sort_key(…, currency, …)`, lustro
  `isComparableCurrency` w `salary-compare.ts`). Wymagany język i poziom (#786, URL
  `lang`/`langLevel`, `job_requires_language`: kod `language_id` albo stara etykieta przez aliasy
  0168; poziom = poziom kandydata, pasuje wymaganie najwyżej tego poziomu albo bez poziomu;
  „bez wymogu języka” osobno). Wymiar pracy (#811): `jobs.work_time` (`full_time`/`part_time`/
  `both`, null = brak deklaracji — starych ofert nie klasyfikujemy), pole w kroku 2 kreatora,
  `save_job_draft` (na 0184), `update_published_job`, kopia szkicu, `get_public_job`; filtr
  `workTime` (`both` pasuje do obu). Promień (#824, URL `near`/`radius` 5/10/25/50/100 km):
  `locations_within_radius` po współrzędnych słownika (część gminy = współrzędne gminy),
  oferta bez rozpoznanej miejscowości/współrzędnych nie pasuje, nierozpoznany środek = komunikat
  `filters.nearUnknown`. Te same parametry w `get_public_jobs`/`_count`/facetach
  i `saved_search_jobs_after`, klucze kanoniczne zapisanych wyszukiwań `language`,
  `languageLevel`, `workTime`, `near`, `radiusKm`; formularz bez JS (`FilterSheet`) ma te same
  pola. Dowód: `rls.sql` sekcja FL974 (kontrole ujemne N1–N6), rollback `0194_…down.sql`
  (`job-filters-rollback.sql`; w `city-sections-filters-rollback.sql` przed 0183), unit
  `job-filters-0194`, `job-work-time`, E2E `job-filters-0194` (bez JS, axe 320/1280 px).
  Słowo kluczowe w kwalifikacjach (#866, migracja `0214`, stosowana PO 0213
  z #1275): lista, licznik, facety i kopia filtrów alertów dopasowują słowo kluczowe także do
  umiejętności (`job_skills`), certyfikatów (`job_certificates`) i wymagań (`job_requirements`,
  tylko w języku pokazywanym na szczególe: język strony, a bez wymagań danego rodzaju — język
  oferty); prefiltr `search_keyword_candidates` po indeksach trigramowych, dokładny warunek
  `job_keyword_qualification_match`. Opis oferty poza zakresem. Lustro demo szuka w tytule
  i wymaganiach. Dowód: `rls.sql` sekcja KQ866 (kontrola ujemna: definicje z 0213), rollback
  `0214_…down.sql` (`keyword-qualifications-rollback.sql`), unit `jobs-demo-search-mirror`.
  Edycja filtra wielokrotnego bez JavaScriptu (#795, a11y/forms UX, bez migracji): formularz
  fallback w `<noscript>` (`NoScriptFilterForm`, `FilterSheet.tsx`) renderował kategorię/
  lokalizację/rodzaj umowy/zakwaterowanie jako pojedynczy `<select>` — istniejący zestaw dało
  się tylko zachować w całości (jedna opcja z całym CSV) albo zastąpić jedną nową wartością,
  nigdy dopisać/usunąć pojedynczej wartości z zestawu. Powodem był `flatten()` na stronie listy
  (`src/app/[locale]/(public)/oferty-pracy/page.tsx`), który brał tylko PIERWSZĄ wartość
  powtórzonego klucza query — a to dokładnie to, co przeglądarka wysyła dla kilku zaznaczonych
  checkboxów tej samej nazwy (`category=a&category=b`). Naprawa: te cztery pola są teraz
  fieldsetami checkboxów (jedna wartość = jeden checkbox, `defaultChecked` z URL), a nowe
  `flattenSearchParams` (`src/components/public/job-filters.ts`) łączy powtórzony klucz w jedną
  wartość — CSV dla kategorii/rodzaju umowy/zakwaterowania, `serializeLocations` (escaping #845)
  dla lokalizacji — więc `parseSidebarFilters` dostaje dokładnie to, czego oczekuje niezależnie
  od tego, czy filtr przyszedł z linku JS (jedna wartość CSV) czy z formularza bez JS (powtórzony
  klucz). Dowód: `tests/unit/job-filters-search-params.test.ts` (w tym kontrola ujemna: branie
  tylko pierwszej wartości gubi resztę zaznaczonych checkboxów), E2E
  `job-filter-passport.spec.ts` (dopisanie i usunięcie pojedynczej wartości z istniejącego
  zestawu bez JS; istniejący test wielowartościowego round-tripu zaktualizowany pod checkboxy).
  Zapis kwot (#22): jedno źródło `src/lib/salary.ts` (`normalizeSalary` + `formatSalaryRange`)
  dla karty, szczegółu, podobnych ofert, JobPosting JSON-LD i e-maili (worker formatuje z kwot
  w payloadzie w locale odbiorcy, etykiety `jobs.passport.*` przez `src/lib/salary-labels.ts`).
  Grosze = dwa miejsca dla obu granic, jedna granica = „od”/„do”, min = max = jedna kwota,
  brak kwoty = brak pola, okres tylko z danych. Testy: `salary.test.ts`, E2E `job-detail-salary`.
  E-mail propozycji (0113): `send_offer` kolejkuje kwoty oferty (`salaryMin`/`salaryMax`/
  `salaryPeriod`/`currency`), tekst składa worker w locale odbiorcy (`email-payload-followups.test`).
  Kanoniczne miasto oferty (audyt P1-10, migracja `0153`): `jobs.city` zostaje
  tekstem wpisanym w kreatorze, a `jobs.location_id` (→ `locations`, 0112) ustawia WYŁĄCZNIE
  trigger `trg_jobs_resolve_location` przy każdym zapisie miasta (kreator, edycja opublikowanej,
  import, DML) — po aliasie `location_aliases` i kluczu `city_key` (lustro `cityKey` z TS: bez
  diakrytyków, wielkości liter, spacji/myślników). Nowe aliasy w słowniku dowiązują oferty bez
  miejscowości (`trg_location_aliases_relink_jobs`); backfill bez podbicia `updated_at` (CAS #325).
  Filtr `p_locations` w `get_public_jobs`/`_count`/facetach dopasowuje tekst ALBO miejscowość
  (`location_filter_ids`), facet miasta = jedna pozycja na miejscowość (`locations.name`),
  wyszukiwanie tekstowe miasta dokłada miejscowość rozpoznaną z wpisu. Landingi miast, licznik
  huba i zapisane wyszukiwania korzystają z tych RPC bez zmian w kodzie. Kreator: podpowiedź pod
  polem miasta (rozpoznana miejscowość albo informacja o braku w słowniku) + `datalist` propozycji
  (`jobCityAssist`, odczyt słownika pod RLS, niczego nie zapisuje; `src/lib/locations/job-city.ts`).
  Dowód: `rls.sql` sekcja LC153 (kontrole ujemne: bez `location_id` / bez triggera), unit
  `job-location` (parzystość klucza, 10 miast landingów → jedna miejscowość, facet),
  `job-wizard-city-hint` (podpowiedź, kontrole ujemne), integracja
  `portal-employer`. Części gmin w filtrach (#1076, migracja `0183` — numer tymczasowy):
  `location_filter_ids` obejmuje aktywne części wskazanej gminy (`parent_location_id`, jeden
  poziom), więc lista, licznik, landing miasta, facety i `saved_search_jobs_after` widzą oferty
  z dzielnic bez zmiany bloków FROM … WHERE; filtr po samej części zwraca tylko ją,
  `search_city_candidates` rozwija wpis o gminie, facet miasta grupuje część pod gminą
  nadrzędną. Dowód: `rls.sql` sekcja SRCH1076 (kontrole ujemne: funkcje z 0153), rollback
  `supabase/rollback/0183_…down.sql` (`city-sections-filters-rollback.sql`), unit
  `city-sections-filters`.
  Zmiany słownika (#715, migracja `0199` — numer tymczasowy): `location_aliases` AFTER INSERT/
  UPDATE/DELETE i `locations` AFTER UPDATE (`is_active`) przeliczają oferty dotkniętych kluczy
  i miejscowości (`relink_jobs_for_city_keys`) — przeniesienie/zmiana klucza/usunięcie aliasu,
  dezaktywacja i usunięcie miejscowości nie zostawiają starego `location_id`; `jobs.city` bez zmian,
  a `trg_zz_jobs_location_only_keep_version` nie podbija `updated_at` (CAS #325) przy zmianie
  samego `location_id`. Dowód: `rls.sql` sekcja AR968 (kontrole ujemne: trigger tylko INSERT z 0153,
  bez strażnika wersji). **Otwarte:** matching nadal liczy odległość z tekstu (`cityKey`).
  Podpowiedź a alias techniczny (#807): `pickSuggestions` zamienia alias małymi literami (np.
  „ghent”) na nazwę lokalizowaną (np. „Gandawa”) tylko gdy ta nazwa nadal zaczyna się od
  wpisanego prefiksu (`matchKey`, folded jak `cityKey`) — inaczej zostaje przy dopasowanym
  aliasie, bo przeglądarka odfiltrowuje z natywnego `datalist` opcję, której wartość nie zawiera
  wpisanego tekstu. Test: `job-location` (kontrole pozytywna/ujemna).
- [~] Wyszukiwanie opisem (AI, #711, migracja `0222` — numer tymczasowy; za flagą
  `AI_JOB_SEARCH_ENABLED`, domyślnie wyłączone; atrapa `AI_JOB_SEARCH_PROVIDER=fixture` tylko poza
  produkcją): zwinięta sekcja `JobSearchAssistDisclosure` na `/oferty-pracy` (w nagłówku listy)
  i `/candidate/wyszukiwania`; kod formularza `JobSearchAssist` = osobny chunk ładowany dopiero po
  rozwinięciu (budżet JS #395, bez CLS). Opis potrzeby (3–500 znaków, jawny język opisu) → akcja
  `suggestJobSearchFilters` (bez sesji i profilu; polecenia dla AI → odmowa przed limitem i modelem;
  limit per adres 10/h i 30/dobę fail-closed; e-maile/telefony/identyfikatory zredagowane) →
  `withAiBudget` (#36, funkcja `job_search_filters` w CHECK-u rejestru i `ai_budget_reserve` — 0222)
  → `gpt-6-luna` przez `src/lib/ai/openai.ts` (strict JSON Schema ze słownikami jako `enum`,
  wersja `job-search-filters-v1`) → bramki `src/lib/ai-search/guard.ts`: tylko kategorie/miasta/
  umowy ze słowników, słowo kluczowe i fragmenty wyłącznie z tekstu użytkownika, kwota z tekstu
  i w zakresie suwaka, wynik przez `parseSidebarFilters`→`sidebarFiltersToParams` (kanoniczne
  parametry listy). Propozycja = edytowalne chipy (etykiety `describeJobListFilters` w języku
  interfejsu), nierozpoznana miejscowość do wyboru (domyślnie żadna), niepewne fragmenty;
  lista zmienia się dopiero po „Zastosuj filtry” (zapis wyszukiwania i alertu — istniejący
  przycisk listy, #100). Inwentarz AI: wejście `job_search_query` dopuszczone w trybie
  ogłoszeniowym (bez profilu/CV). Dowód: `rls.sql` sekcja AIS711 (kontrola ujemna: lista funkcji
  z 0176), rollback `0222_…down.sql` (`ai-search-filters-rollback.sql`), unit `ai-search-guard`,
  `ai-search-run`, `job-search-assist-action`, `job-search-assist-ui`, `ai-inventory`, E2E
  `jobs-list-search-assist` (4 języki, axe 320/1280). **Otwarte:** metryki akceptacji/korekt
  sugestii (brak zbioru bez decyzji o danych), słownik spoza 10 miast (promień `near`),
  akceptacja brzmień i wejścia `job_search_query` w trybie ogłoszeniowym (właściciel).
- [x] Szczegóły oferty + JobPosting JSON-LD + ApplyModal — wg makiety 03
  Tryb demo (#297, Invariant #12): oferty z `src/lib/data/demo.ts` mają `isDemo` (`src/lib/jobs.ts`,
  `isShowingDemoJobs()`); strona główna, lista, landing kategorii/miasta i szczegół pokazują baner
  `DemoJobsNotice`, karty etykietę „przykładowa”, bez odznaki „Zweryfikowana firma”; szczegół demo
  = noindex, bez JobPosting i „Wyślij wiadomość”, ApplyModal z komunikatem zamiast formularza.
  Formularz aplikowania i JobPosting testuje serwer fixture (tryb `full` nie oznacza ofert jako demo).
  Umiejętności i certyfikaty na szczególe (decyzja właściciela 01.10.2026, #866, bez migracji):
  sekcja „Umiejętności i certyfikaty” (`job.qualifications.*`, układ `.info-pairs` jak „Koszty
  i dodatki”, `data-testid="job-qualifications"`) — wymagane / mile widziane umiejętności i
  certyfikaty jako lista. Odczyt pomocniczy `getPublicJobQualifications` (`src/lib/db/public-jobs.ts`)
  = `job_skills`/`job_certificates` pod rolą anon (RLS `*_select`: tylko oferta publiczna), nazwa
  umiejętności ze słownika `skill_labels` w języku strony przy `skill_id`, inaczej wpis pracodawcy
  z `lang` języka treści; awaria = strona bez sekcji. Parser i JSON-LD `src/lib/job-qualifications.ts`:
  JobPosting `skills` (Text) i `qualifications` (`EducationalOccupationalCredential`). Dowód: unit
  `job-qualifications`, `jobs-postgres`; integracja `public-job-qualifications` (PG16, kontrola
  ujemna: szkic i firma niezweryfikowana = pusto); E2E `job-qualifications` (4 języki, axe 320/1280,
  kontrola ujemna oferty bez kwalifikacji), `job-posting-fixture` (pola JSON-LD).
- [x] „Wyjaśnij ofertę” prostym językiem (#773, migracja `0220` — numer tymczasowy; za flagą
  `AI_JOB_EXPLAIN_ENABLED`, domyślnie wyłączone, atrapa `AI_JOB_EXPLAIN_PROVIDER=fixture` poza produkcją):
  sekcja `JobExplainPanel` (osobny chunk `JobExplainPanelLazy`) pod treścią szczegółu oferty — na
  żądanie, w wybranym języku PL/NL/FR/EN; treść oferty bez zmian. Akcja `explainJobOffer`: tylko oferta
  publiczna (`getJobBySlug`, oryginał zamiast przekładu maszynowego), źródła = ponumerowane fragmenty
  (`src/lib/ai-explain/sources.ts`: tytuł, pola strukturalne po angielsku dla modelu i w języku strony
  dla czytelnika, zdania opisu, listy; bez kanału aplikowania, opisu firmy, e-maili/telefonów/
  identyfikatorów), pamięć podręczna procesu (oferta × język × SHA-256 treści), Turnstile `job_explain`
  (fail-closed, decyzja właściciela; przed odczytem oferty i pamięcią), limit per adres
  10/h i 30/dobę (fail-closed), `withAiBudget` (#36), OpenAI `gpt-6-luna` (`src/lib/ai/openai.ts`,
  strict schema, treść jako dane w `<offer_text>`). Bramki (`guard.ts`, ekstrakcja faktów tłumaczeń):
  objaśnienie bez istniejącego źródła, z kontaktem, z innymi liczbami/walutą/datą/godziną/
  brutto-netto/okresem stawki niż wskazane fragmenty, nową jednostką/kwalifikacją albo niezgodną
  negacją jest pomijane (liczone); luki „brak/sprzeczne/niejasne” zamiast zgadywania; polecenia dla
  AI w treści = brak wywołania. UI: źródło przy każdym objaśnieniu (`<q lang>`), zastrzeżenie (nie
  porada prawna, wiąże treść oferty), stan ładowania, błąd z ponowieniem, fokus na wyniku. Inwentarz
  AI `job_offer_explain` (`allowedInClassifieds: true`, wejście = treść oferty); baza: funkcja
  w CHECK `ai_usage_ledger_feature` i allow-liście `ai_budget_reserve`. Dowód: `rls.sql` sekcja
  AIX773, rollback `0220_…down.sql` (`ai-job-explain-rollback.sql`, też w `portal-legal-mode-rollback.sql`
  przed 0176), unit `job-explain`, `job-explain-action`, `job-explain-panel` (kontrole ujemne), E2E
  `job-explain` (4 języki, klawiatura, axe 1280/320 px). **Otwarte:** ewaluacja na reprezentatywnych
  ofertach z prawdziwym modelem przed włączeniem (właściciel), data w objaśnieniu tylko w zapisie ze źródła (ISO).
- [x] Landing pages: `/praca` (hub) + `/praca/kategoria/[category]` + `/praca/miasto/[city]` (filtrowane przez getJobs, generateStaticParams, metadata+hreflang, BreadcrumbList JSON-LD, indeksowalne)
  Katalog miast i próg podaży (#920, bez migracji): hub, strona miasta (metadane, „Inne miasta”)
  i sitemap biorą miasta z jednego modułu `src/lib/locations/city-landings.ts` (rdzeń 10 miast +
  13 kolejnych: Namur, Mons, Aalst, Ostenda, Genk, Sint-Niklaas, Roeselare, La Louvière, Tournai,
  Turnhout, Vilvoorde, Zaventem, Wavre — klucz = slug słownika `locations`, nazwy PL/NL/FR/EN
  w `locations.*` i własny opis `landing.city_<klucz>`). Jedna reguła `cityLandingQualifies`:
  landing jest indeksowany, w hubie i w sitemapie od `CITY_LANDING_MIN_ACTIVE_JOBS` = 3 aktualnych
  ofert (dawniej ≥ 1, #299); poniżej progu działa jako filtr z `noindex, follow`. Liczba ofert nie
  zależy od języka (filtr po wszystkich nazwach → `location_filter_ids` gminy z częściami), więc
  wersje językowe i hreflang kwalifikują się razem. Bez liczników (demo/build/awaria) hub pokazuje
  rdzeń; brak kwalifikujących się = komunikat `landing.byCityEmpty`. Dowód: unit `city-landings`
  (katalog = `locations.*`, opisy różne po usunięciu nazwy, nazwa ze słownika 0112 wśród aliasów,
  próg z kontrolami ujemnymi, hub i „Inne miasta”), `sitemap-seo` (2 oferty = poza sitemapą).
  **Otwarte (właściciel):** wartość progu, „trwałość” podaży (dziś bieżąca liczba, bez historii),
  pomiar wejść i decyzja o kolejnych miejscowościach.
- [x] SEO: sitemap.ts (pusty na non-prod), robots.ts, metadata + hreflang, X-Robots-Tag
  Okno cutoveru (#1115, bez migracji): `isSearchIndexingEnabled()` (`src/lib/seo/indexing.ts`) =
  `isProductionDeployment()` ORAZ brak `SITE_ACCESS_PASSWORD` — przy bramce hasła robots.txt =
  `Disallow: /`, sitemapy puste, bez odczytu ofert (sprawdzenie przed cache listy partii; test
  `search-indexing-gate`). Przy `DATABASE_APP_URL` handler ISR nie serwuje z buildu strony głównej
  i `/praca` (pusta lista ofert z `isBuildPhase`) — pierwsze żądanie renderuje je z danych
  (`isBuildSeedWithoutJobs`, test `isr-cache-handler`). Tokeny gościa/zaproszeń: publiczny sekret
  deweloperski tylko w demo BEZ bazy — na prawdziwej bazie (także demo) wymagany `GUEST_APPLY_SECRET`
  (`guest-apply-token`).
  robots (#1217, PERF-03): blokada paneli zakotwiczona na segmencie języka
  (`/<język>/<panel>$` i `/<język>/<panel>/`, `src/lib/seo/robots-rules.ts`) — dawne reguły z
  gwiazdką blokowały oferty i profile firm o slugach `administratief-…`/`employer-…` (test
  z dopasowaniem jak Google i kontrolą ujemną w `sitemap-robots`). Sitemap: profile firm raz
  w całym indeksie, w partii `0` (#1231, PERF-05; jedna iteracja kursorem po całym katalogu —
  `getSitemapCompanySlugs`, to samo RPC co partie #1042); metadane landingów przez
  `getJobsCount`, a strony listy na stronie
  głównej, w „Podobnych ofertach” i na pulpicie kandydata bez licznika
  (`getJobs(…, { withTotal: false })` → `getPublicJobsPage`, #1230, PERF-04).
  Dane strukturalne (#313) w `src/lib/seo/structured-data.ts`: JobPosting bez wymyślonego
  `validThrough` (tylko realne `expires_at`), pełny opis HTML (opis, obowiązki, wymagania, warunki,
  godziny, zmiany; escapowany); Article z `image`, `dateModified` (`guides.ts` `updatedAt`) i logo
  wydawcy. Obraz marki `/og.png` przez `brandShareImageUrl` na wszystkich publicznych stronach z
  własnym `openGraph` (#116/#182; strażnik `tests/unit/structured-data.test.ts`).
  `hiringOrganization.sameAs`/`logo` (migracja `0114`): `get_public_job` zwraca `company_website`/
  `company_logo_url` tylko dla firmy `verified` i tylko jako bezwzględny https (`public_https_url`),
  JSON-LD waliduje je drugi raz (`publicHttpsUrl`). Dowód: `rls.sql` sekcja OL112 (kontrole ujemne:
  bez walidacji / bez bramki weryfikacji link wycieka).
  `employmentType` (#842, bez migracji): rodzaj umowy i wymiar czasu pracy są niezależne
  (wymiar to wolny tekst `job.workingHours`, bez osobnego pola — patrz #811), więc `permanent`
  („Umowa na stałe”) już NIE wymusza `FULL_TIME` — realna oferta na część etatu z umową na
  stałe nie dostaje sprzecznej z opisem wartości; pole jest wtedy pomijane, nie zgadywane z
  tekstu godzin. Pozostałe rodzaje (`temporary`/`interim`/`freelance`/`internship`/`seasonal`)
  same są kategorią zatrudnienia, więc nadal emitują `employmentType`. Dowód:
  `tests/unit/structured-data.test.ts` (kontrola ujemna: `permanent` + opis część etatu →
  brak `employmentType`, nigdy `FULL_TIME`).
  `directApply` (#840, bez migracji): portal nie ma pola z zewnętrznym adresem ATS — każda
  realna, kanoniczna oferta (wywołujący już pomija demo i wersje bez tłumaczenia treści,
  #297/#301) ma pełny formularz aplikowania na tej samej stronie (zalogowany kandydat i gość
  bez konta), więc `buildJobPostingJsonLd` emituje `directApply: true` zamiast stałego `false`.
  Dowód: `tests/unit/structured-data.test.ts` (kontrola ujemna). **Otwarte:** gdy pojawi się
  oferta bez tego przepływu (np. link zewnętrzny), wartość trzeba wyliczać z danych oferty.
  BreadcrumbList z jednego helpera (bez migracji): `buildBreadcrumbListJsonLd` w
  `structured-data.ts` bierze tę samą listę pozycji co widoczna ścieżka `Breadcrumbs`
  (`{ label, href }`; prefiks języka, bieżąca strona = jej adres, pozycja bez nazwy pominięta).
  Strony z widoczną ścieżką (landingi, hub, poradniki, dla pracodawców) i `/pomoc` używają go
  zamiast ręcznego JSON; doszły lista ofert (Strona główna → Oferty pracy, adres listy bez
  filtrów), profil firmy (= widoczna ścieżka) i szczegół oferty (Strona główna → Praca → branża
  `/praca/kategoria/<klucz>` → oferta; tylko obok JobPosting — nie w wersji bez tłumaczenia #301
  ani w demo #297). Strony zostają ISR (dane z tych samych odczytów). Test `breadcrumb-jsonld`
  (strażnik źródeł: ręczny `'@type': 'BreadcrumbList'` albo ścieżka bez danych = czerwony,
  kontrola ujemna), E2E `job-posting-fixture` (pozycje, landing branży = 200, kontrola ujemna
  #301) i `company-profile` (nazwy = widoczna ścieżka).
  Sitemap ofert kursorem (#1042, migracja `0208` — numer tymczasowy): `sitemap.ts` nie używa już
  `getJobs` (osobny licznik + OFFSET po 100 ofert, sufit offsetu 10 000). Dwa lekkie RPC niezależne
  od `get_public_jobs` (anon, SECURITY DEFINER): `get_public_jobs_sitemap_shard_starts(rozmiar)`
  (jeden wiersz na partię = kursor ostatniej oferty poprzedniej; liczba plików = liczba wierszy,
  bez licznika ofert) i `get_public_jobs_sitemap_page(after, until, limit ≤ 1000)` (strona
  kursorem `published_at desc, id desc` z językami tłumaczeń #301, slugiem firmy #591 i
  `updated_at` do `lastmod` #796 w jednym zapytaniu; kursor „do” włącznie = partie rozłączne
  i bez dziur także przy zmianie katalogu między żądaniami). `id` rozstrzyga remis `published_at`;
  znaczniki czasu jako tekst z mikrosekundami (`to_jsonb`), nigdy `Date`. Warunek „oferta
  publiczna” = kopia `get_public_jobs` + `published_at is not null`; częściowy indeks
  `idx_jobs_sitemap_cursor`. Kod: `src/lib/db/sitemap-jobs.ts` (SQL), `src/lib/sitemap-jobs.ts`
  (partie, błąd = `AppError`, faza builda = pusto). Sufit partii `MAX_JOB_SITEMAP_SHARDS = 100`
  niezależny od bazy. Dowód: `rls.sql` sekcja SM1042 (wynik = publiczna lista, remis 130 ofert
  przez granice stron i partii, kontrole ujemne: kursor bez `id` gubi i dubluje, oferty
  ukryte, niepełny kursor), rollback `supabase/rollback/0208_…down.sql`, integracja
  `sitemap-jobs` (PG16, 2600 ofert z jednym `published_at`), unit `sitemap-jobs`,
  `sitemap-jobs-db`, `sitemap-robots`, `sitemap-seo`. Cache 3600 s: osobno (#1177). Profile
  firm (#1231) tylko w partii `0` — `getSitemapCompanySlugs` przechodzi cały katalog kursorem
  (bezpiecznik 500 stron), partie ofert już ich nie zbierają.
  Edycja strony i logo firmy (#112, migracja `0141`): `/employer/firma` ma osobny formularz
  (`CompanyLinksForm` + akcja `updateCompanyLinks`) — owner/admin firmy (jak nazwa/VAT, 0040)
  ustawia i czyści oba adresy; CHECK na `companies.website`/`logo_url` (`companies_website_https`/
  `companies_logo_url_https`, ta sama reguła co `public_https_url`) waliduje w bazie niezależnie
  od Zod (lustro `src/lib/company-links.ts`). W przeciwieństwie do nazwy/VAT zmiana NIE cofa
  weryfikacji (`protect_company_verification` reaguje tylko na `name`/`vat_number`); audyt
  `company.links_changed`. Podgląd logo przez `next/image` tylko gdy adres wskazuje na własny
  host (jedyny dozwolony w `images.remotePatterns`/CSP `img-src`) — inaczej sam link, bez
  rozszerzania CSP. Dowód: `rls.sql` sekcja CL141 (member/recruiter bez dostępu, http:// i adres
  nad limitem długości odrzucone, zmiana linków nie cofa `verified`, zmiana nazwy nadal cofa).
  Zatwierdzanie przez admina (migracja `0156`): `website`/`logo_url` =
  wartości ZATWIERDZONE (jedyne publiczne — RPC 0114/0140 bez zmian). Formularz woła RPC
  `submit_company_links` (owner/admin): nowy adres → propozycja `website_pending`/
  `logo_url_pending` ze stanem `links_review_status='pending'` (publicznie dalej stare adresy,
  formularz pokazuje oba), samo usunięcie adresu → od razu (`applied`), propozycja = stan
  publiczny → wycofanie (`unchanged`). Strażnik `guard_company_links` blokuje bezpośredni
  zapis tych kolumn przez klienta. Admin: filtr `/admin/firmy?status=links` (kolejka) i sekcja
  „Strona WWW i logo” w `/admin/firmy/[id]` (`CompanyLinksReviewActions` →
  `admin_decide_company_links`: CAS po `links_pending_at` → `STALE_STATE`, odrzucenie
  z uzasadnieniem ≤ 1000 widocznym dla firmy, audyt `company.links_submitted`/`links_reviewed`,
  powiadomienie in-app właścicieli `system` + `data.kind='company_links'`). Dowód: `rls.sql`
  sekcja CLR156 (kontrole ujemne: bezpośredni UPDATE, member, obca firma, owner zatwierdzający
  sam, CAS), unit `company-links-update`, `company-links-form`, `company-load`,
  `admin-company-links`. **Otwarte:** e-mail o decyzji (dziś tylko in-app), adresy
  opublikowane przed 0156 zostają bez przeglądu.
  Opis firmy z zatwierdzaniem przez admina (#868, migracja `0198` — numer tymczasowy): ten sam
  wzorzec dla `companies.description` (jedyne pole publiczne = tekst ZATWIERDZONY; profil firmy,
  Organization JSON-LD i szczegół oferty bez zmian). Propozycja w `description_pending` ze stanem
  `description_review_status` (`pending`/`rejected`), `description_pending_at` (klucz CAS) i
  uzasadnieniem; limit 1500 znaków (CHECK). Strażnik `guard_company_description` blokuje
  bezpośredni zapis opisu i kolumn przeglądu (także owner/admin firmy — RLS 0040 sam by go
  dopuścił); piszą tylko `submit_company_description` (owner/admin: `pending` / `applied` =
  usunięcie opisu od razu / `unchanged`, idempotentne, audyt bez treści) i
  `admin_decide_company_description` (CAS → `STALE_STATE`, odrzucenie z uzasadnieniem ≤ 1000,
  powiadomienie in-app właścicieli `data.kind='company_description'`, audyt). Zmiana opisu nie cofa
  weryfikacji. `/employer/firma`: `CompanyDescriptionForm` (licznik znaków i zasada moderacji przed
  zapisem, podgląd profilu jako czysty tekst, stan propozycji i uzasadnienie odrzucenia obok
  opublikowanego opisu); akcja `updateCompanyDescription` odrzuca numer rejestru narodowego/dokumentu
  (`containsPersonalIdentifier`) przed bazą. Admin: kolejka `/admin/firmy?status=description`, sekcja
  „Opis firmy” w `/admin/firmy/[id]` (`CompanyDescriptionReviewActions` → `decideCompanyDescription`).
  Dowód: `rls.sql` sekcja CDR971 (kontrole ujemne: bezpośredni UPDATE, zdjęty strażnik, member,
  obca firma, owner zatwierdzający sam, CAS, limit długości), rollback
  `supabase/rollback/0198_company_description_review.down.sql` (test w `test-rls.sh`), unit
  `company-description`, `company-description-update`, `company-description-form`,
  `admin-company-description`. **Otwarte:** e-mail o decyzji (dziś tylko in-app), opisy sprzed 0198
  zostają bez przeglądu, opis nie jest tłumaczony (#708).
  Zakres portu (#745): `isPublicHttpsUrl` (`src/lib/company-links.ts`, lustro Zod
  `companyLinksSchema`) dopuszcza port wyłącznie z prawdziwego zakresu TCP `1–65535` —
  `:0` i wartości powyżej `65535` (np. `:99999`) są odrzucane na jedynej ścieżce, którą
  pracodawca faktycznie zapisuje adres, zanim trafi do RPC `submit_company_links`. **Otwarte:**
  baza (`public.public_https_url`, 0114/0141/0156) nadal luźno dopuszcza dowolne 1–5 cyfr portu
  w CHECK — zaostrzenie wymaga osobnej migracji i decyzji o ewentualnych istniejących wierszach
  poza zakresem.
- [x] Poradniki (blog) + Article JSON-LD — `/poradniki` + `/poradniki/[slug]` (6 poradników w `src/lib/guides/guides.ts`)
- [x] Strona dla pracodawców `/dla-pracodawcow` (#339) — indeksowalna (sitemap, canonical, hreflang,
  BreadcrumbList), treść `employers.*` w PL/NL/FR/EN wyłącznie z faktów produktu (konto + firma,
  weryfikacja przez administratora, kreator ze szkicem, zgłoszenia/wiadomości/propozycje, e-maile
  w języku odbiorcy, bezpłatny etap z `docs/PRODUCT_DECISIONS.md`); bez cen i liczb (strażnik
  `tests/unit/employers-page.test.ts`). „Dla pracodawców” w nawigacji i stopce prowadzi tutaj;
  „Dodaj ofertę” i CTA strony — do `/rejestracja-pracodawca`. W bramce a11y (#221).
- [x] Profil publiczny firmy `/pracodawcy/<slug>` (#591, migracja `0140`): zastępuje CTA
  „Dowiedz się więcej o firmie”, które prowadziło do wyszukiwarki po nazwie firmy
  (`?keyword=<nazwa>` — mogło zwrócić oferty innej firmy albo nic). Adres jest stabilny:
  `companies.slug` (unikalny, ustawiany raz przy zakładaniu firmy, NIE zmienia się przy zmianie
  wyświetlanej nazwy — `src/lib/actions/company.ts`). `get_public_company`/`get_public_company_jobs`
  (nowe RPC) i `get_public_job`/`get_public_jobs` (+ `company_slug`) zwracają WYŁĄCZNIE
  zweryfikowaną, nieusuniętą firmę; zła firma/zły slug = brak wiersza → strona 404 (Invariant #8).
  CTA na szczególe oferty (`job.companySlug`) jest ukryte, gdy profil nie istnieje (demo/bezpiecznik),
  zamiast linkować donikąd. Strona indeksowalna (canonical, hreflang), sitemap dodaje jeden wpis na
  firmę zebrany PRZY OKAZJI iteracji po ofertach (bez osobnego zapytania). Dowód: `rls.sql` sekcja
  CP591; unit `company-profile`, `jobs-postgres` (#591), `sitemap-robots` (#591, z kontrolą ujemną).
  SEO i kandydat (#591, bez migracji): nazwa firmy na karcie oferty (`JobCard`, link nad nakładką
  tytułu) i w nagłówku szczegółu linkuje do profilu, gdy `companySlug` istnieje (tylko `verified`);
  profil ma Organization JSON-LD (`buildOrganizationJsonLd`: nazwa, adres profilu, opis, adres
  pocztowy; `sameAs`/`logo` tylko https — edycja w panelu to #632); profil bez aktywnych ofert =
  `noindex, follow` bez canonical/hreflang (jak pusty landing #299), sitemap zbiera profile tylko
  z aktywnych ofert. Serwer fixture E2E ma profile firm zweryfikowanych i jedną firmę bez ofert
  (`src/lib/company-fixture.ts`). Dowód: unit `company-profile-seo` (kontrole ujemne), E2E
  `company-profile` (linki, JSON-LD, noindex, 404 niezweryfikowanej, axe 320/1280 px w 4 językach).
  Stronicowanie ofert profilu (#638, migracja `0181`): profil pokazywał tylko
  pierwsze 50 ofert bez informacji o obcięciu. Kolejne strony pod ścieżką
  `/pracodawcy/<slug>/strona/<n>` (segment, nie `?page=` — strona zostaje ISR, #298), po 50 ofert,
  offset liczony w `getCompanyProfile(slug, locale, page)`; ostatnia strona z `active_jobs_count`
  przycięta do offsetu 10 000 z RPC (`companyJobsLastPage`), strona za końcem, `strona/1`
  i zapis niekanoniczny (`parseCompanyJobsPageSegment`) = 404. Każda strona ma własny canonical
  i hreflang, tytuł z numerem strony (`companyProfile.metaTitlePage`); nad listą liczba wszystkich
  ofert i „Strona N z M”, nawigacja = `Pagination` z `pathForPage`. `get_public_company_jobs`
  sortuje `published_at desc, j.id desc` (tie-breaker jak 0136) — offset bez pominięć i dubli.
  Widok wspólny `pracodawcy/_profile/company-profile.tsx`; fixture E2E stronicuje po 2. Dowód:
  `rls.sql` sekcja CPP638 (remis `published_at`, kontrola ujemna: definicja z 0140), unit
  `company-profile` (51 ofert = 2 strony, strona za końcem bez zapytania), `company-profile-seo`,
  E2E `company-profile` (#638).
  Meta description z opisu firmy (#647, bez migracji): `generateMetadata()` obcina realny
  `company.description` do 160 znaków (ten sam `truncate` co szczegół oferty) zamiast ogólnego
  klucza `companyProfile.metaDescription` z samą nazwą dla każdej firmy; pusty/białe znaki opisu
  = fallback na ten klucz. Dotyczy też `og:description`/`twitter.description`. Dowód: unit
  `company-profile-seo` (kontrola ujemna: ogólny klucz nie trafia do metadanych przy niepustym opisie).
  Logo, strona WWW i język opisu (#686/#708, migracja `0201` — numer tymczasowy): profil pokazuje
  zatwierdzoną (0156) stronę WWW jako nazwany link zewnętrzny (host + ścieżka, nowa karta zapowiedziana
  czytnikowi, `rel="noopener noreferrer nofollow"`) i logo — ale obraz tylko z hosta witryny
  (`profileLogoSrc`: CSP `img-src`/`remotePatterns`, bez żądania do serwera firmy przed zgodą,
  Invariant #7), inaczej inicjały. `companies.description_locale` (FK `supported_locales`) = język
  ZATWIERDZONEGO opisu. Język wybiera się razem z tekstem w `CompanyDescriptionForm` (`/employer/firma`,
  decyzja właściciela 30.09.2026): `submit_company_description(id, tekst, język)` zapisuje go w
  `description_locale_pending` przy propozycji (ponowienie tej samej propozycji z innym językiem
  poprawia tylko język, czas zgłoszenia bez zmian), `admin_decide_company_description` przy akceptacji
  przenosi go do `description_locale` (osobnym zapisem po tekście), odrzucenie go nie zmienia
  (propozycja z językiem zostaje do wglądu); tekst = zatwierdzony + inny język = sama zmiana języka od
  razu (`locale_applied`, przez `set_company_description_locale`, audyt `company.description_locale_changed`).
  Admin widzi język opisu i propozycji w `/admin/firmy/[id]`. Strażnik 0198 obejmuje obie kolumny
  języka (bez bezpośredniego zapisu klienta); trigger zeruje język przy każdej zmianie treści bez
  jednoczesnego wskazania języka, CHECK — brak języka bez opisu i brak języka propozycji bez propozycji.
  `get_public_company` zwraca `description_locale`; opis ma `lang`, a gdy jest w innym
  języku niż strona albo język nieznany — dopisek `companyProfile.descriptionLanguage*`; metadane
  wersji w innym języku niż opis biorą ogólny `metaDescription` (nieznany = opis, #647). hreflang bez
  zmian (interfejs i karty ofert są w języku strony). Dowód: `rls.sql` sekcja CDL975 (kontrole ujemne:
  bez triggera, bez strażnika, CHECK, member/obca firma, akceptacja jednym zapisem gubi język),
  rollback `0201_…down.sql` (też przed 0198 w `company-description-rollback.sql`), unit
  `company-profile-view`, `company-description-{form,update}`, E2E `company-profile`. **Otwarte:**
  tłumaczenia opisu z zatwierdzaniem (plan #31).
- [x] Pomoc i Kontakt (#61, część techniczna, migracja `0125`): `/pomoc` = pytania i odpowiedzi
  wyłącznie z faktów produktu (`help.*`, PL/NL/FR/EN, natywne `<details>`, bez terminów i cen),
  `/kontakt` = formularz (`ContactForm`, kalka `.paper.demo-form`): temat ze słownika, treść
  20–5000, imię opcjonalne, e-mail. Akcja `submitContactMessage`: limiter `contact` (fail-safe) →
  Turnstile `contact` (fail-closed) → Zod (`src/lib/validation/contact.ts`; NISS/PESEL/numer
  dokumentu → błąd przy polu, #495) → RPC `submit_contact_message` (tylko service_role:
  idempotencja, 3 wiadomości/adres/24 h, numer `KON-XXXX-XXXX`). W tej samej transakcji
  potwierdzenie `supportContact` do nadawcy w języku formularza i `contactMessageAdmin` do
  każdego aktywnego admina w JEGO języku (Invariant #1); w kolejce tylko numer i temat — treść
  i adres czyta admin w `/admin/kontakt` (filtr nowe/obsłużone, `admin_set_contact_message_status`
  z CAS i audytem). Obie strony indeksowalne (canonical, hreflang, sitemap), stopka „Pytania
  i odpowiedzi” → `/pomoc`. Dowód: `rls.sql` sekcja CT61; unit `contact-form`, `contact-emails`,
  `help-contact-pages`; E2E `help-contact` (4 języki, axe 320 px), `contact-form` (fixture).
  Bez JavaScriptu (#817): `<form>` ma `method="post"` (obronnie — natywna submisja trafiłaby do
  body żądania, nie do adresu URL) i przycisk wysyłki startuje jako `disabled`, odblokowany
  dopiero po zamontowaniu komponentu — bez JS zostaje trwale zablokowany, więc ani klik, ani
  Enter w polu nie wysyłają treści wiadomości/imienia/e-maila w query URL (historia przeglądarki,
  logi serwera); `<noscript>` informuje o wymogu JavaScriptu. Dowód: E2E `contact-form`
  (kontekst `javaScriptEnabled: false`, kontrola ujemna: formularz bez `method="post"`).
  **Otwarte (właściciel):** treść Polityki prywatności (placeholder + noindex zostaje), retencja
  `contact_messages` i ich miejsce w eksporcie/usunięciu konta (#486). Stopka e-maili (#6/#61,
  `EmailLayout` w `src/emails/_components.tsx`): link „Pytania i odpowiedzi” → `/{locale}/pomoc` (etykieta `layoutCopy.help` =
  `footer.faq` strony, `data-email-help`) i link „Prywatność” → `/{locale}/polityka-prywatnosci`
  (`data-email-privacy`; zostaje — decyzja właściciela 26.09.2026), oba w języku odbiorcy. Test
  `email-brand-layout` (kontrole ujemne: język nadawcy, brak któregoś linku). Dawna atrapa `/faq` usunięta — middleware daje 308 na `/{locale}/pomoc`
  (unit `faq-redirect`, brak w sitemap — `sitemap-robots`, E2E `faq-redirect`).

### Etap 3 — kandydat
- [x] Rejestracja / logowanie / reset / potwierdzenie e-mail — Better Auth + PostgreSQL Railway (#24, bez Supabase Auth). Akcje `src/lib/actions/auth.ts` przez `auth.api` (limiter PostgreSQL, Turnstile, Zod; rola z aktywnego profilu, awaria → sesja cofnięta). Zgoda na regulamin sprawdzana w akcji; receipty i preferowany język zapisuje trigger 0059 w transakcji konta. `/api/auth/[...all]` wystawia tylko `GET /get-session` (`src/lib/auth/http-allowlist.ts`). Linki z e-maili: `/{locale}/potwierdz-email#token=` (przycisk → `confirmEmail`, bootstrap firmy) i `/{locale}/ustaw-nowe-haslo#token=` — token we fragmencie (#505), język odbiorcy z kolejki 0061, worker w `/api/email/process` (`DATABASE_AUTH_MAIL_URL`). Guardy paneli na `getCurrentIdentity()` (`src/lib/auth/current.ts` — kontrakt tożsamości dla #25/#26): `/candidate` (sesja + employer→/employer, admin→/admin), `/employer` (sesja + aktywne `company_members`; pracodawca bez firmy → formularz firmy, inni → /rejestracja-pracodawca), `/admin` (sesja + rola=admin, else `notFound`), wszystkie `force-dynamic` + noindex. Odświeżanie
  sesji przy zwykłym przeglądaniu (#864, bez migracji): guardy paneli czytają sesję po stronie
  Server Components, które nie mogą zapisać odnowionego `Set-Cookie` — samo przeglądanie panelu
  (bez Server Action) nie przedłużało 7-dniowej sesji Better Auth. `SessionKeepAlive`
  (`src/components/auth/SessionKeepAlive.tsx`) woła z przeglądarki jedyny dozwolony endpoint SDK,
  `GET /api/auth/get-session` (ten sam origin → przeglądarka sama stosuje ewentualny `Set-Cookie`
  z odpowiedzi, SDK sam decyduje wg progu `updateAge`); layouty przekazują `keepSessionAlive` do
  `CandidateShell`/`EmployerShell`/`AdminShell` TYLKO gdy sesja jest prawdziwa (nie tryb demo).
  Dowód: unit `session-keep-alive`, `panel-shells-keep-alive` (kontrola ujemna: bez prawdziwej
  sesji `SessionKeepAlive` się nie montuje). Gotowość produkcji (#429) = PostgreSQL + Better Auth + limiter, `/api/health` z `SELECT 1` (`docs/railway/STATUS.md`). Dowód: `tests/integration/auth-actions.test.ts` (PG16), unit `auth-*`, E2E `auth-link-token`. IP/user-agent w receipcie akceptacji (migracja `0132`): akcja rejestracji przekazuje zaufany adres (`trustedClientIp`, nigdy `X-Forwarded-For`) i user-agent (≤ 512) w metadanych; trigger zapisuje je w `document_acceptances` i usuwa z `auth.users` w tej samej transakcji; po 7 dniach zeruje je `acceptance_ip_user_agent` (`retention_purge_receipts_batch` w `run_retention_purge`, za `RETENTION_MODE`); receipt niezmienny poza wyzerowaniem IP/UA. Dowód: `rls.sql` sekcja RIP (kontrole ujemne), `signup-receipts` (PG16), `auth-register-terms`. Budżet wysyłki puli `auth` w workerze (migracja `0137`): `processAuthEmailBatch` po renderze pobiera budżet okna dostawcy przez `auth.take_send_budget` (nakładka na `take_email_send_budget`, tylko szablony `accountConfirmation`/`passwordReset`, EXECUTE tylko `pracujbe_auth_mail`); odmowa = to i pozostałe pobrane zlecenia wracają do kolejki bez zużycia próby (`auth.defer_email`: `attempts` cofnięte, `next_attempt_at` = następne okno, tylko ważna dzierżawa), licznik `deferred`; awaria poboru = fail-open (list konta wychodzi, błąd w kanale). Dowód: unit `auth-email-worker` (kontrola ujemna na starym workerze), integracja `auth-email-outbox` (PG16, kontrola ujemna bez migracji). Wylogowanie po awarii inicjalizacji runtime auth (#902, bez migracji): `sessionCookieNames()` liczy nazwy cookies sesji WYŁĄCZNIE ze statycznej konfiguracji `createAuthServer` (`getCookies` z `better-auth/cookies`, `advanced.useSecureCookies: true`), bez odczytu `auth.$context` — `signOut` czyści cookie tej przeglądarki także wtedy, gdy `getAuthRuntime()` odrzuci PRZED przypisaniem `auth` (przejściowa awaria puli/bazy), nie tylko gdy sam `auth.api.signOut()` zawiedzie. Dowód: unit `auth-password-reset` (kontrola ujemna: bez gałęzi `else { await clearSessionCookies(); }` test czerwony). Domyślna nazwa
  firmy w formularzu po nieudanym bootstrapie (#365, `src/lib/auth/signup-company-name.ts`): metadane
  rejestracji (`raw_user_meta_data.company_name`) czytane pod WŁASNYM `identity.id` (Better Auth
  `internalAdapter.findUserById`, nigdy z URL/formularza) wypełniają `CompanyOnboarding` w
  `/employer/firma` i w layoucie panelu; błąd odczytu → formularz pusty (nie blokuje zakładania
  firmy).
  Wysyłka e-maili konta bez czekania na harmonogram (bloker startu W1, `docs/LAUNCH_CHECKLIST.md`
  K10, bez migracji): `registerCandidate`/`registerEmployer`/`registerInvitedEmployer`,
  `requestPasswordReset` (zawsze — wynik neutralny) i `signIn` z `AUTH_EMAIL_NOT_CONFIRMED`
  (`sendOnSignIn`) planują `kickAuthEmailQueue()` (`src/lib/auth/email-kick.ts`): po odpowiedzi
  (`after()` z `next/server`) jedna paczka `processAuthEmailQueue(5)` — ten sam claim z dzierżawą,
  budżet puli `auth` i klucz idempotencji dostawcy co cron, więc równoległy cron nie wyśle drugiego
  listu. Awaria planowania/workera nie zmienia wyniku akcji (zlecenie czeka na harmonogram).
  Wyłącznik `AUTH_EMAIL_IMMEDIATE_SEND=off`. Ponowienia i `email_deliveries` nadal wymagają crona.
  Test: `auth-email-kick` (kontrole ujemne: limit, walidacja, nieudana rejestracja, złe hasło,
  udane logowanie, wyłącznik).
  Rozdzielenie zgód (#493, migracja `0108`): rejestracja kandydata/pracodawcy
  i krok 6 onboardingu mają osobne, niezaznaczone pola — akceptacja regulaminu (wymagana),
  potwierdzenie zapoznania się z informacją o prywatności (wymagane, NIE zgoda) i zgoda
  opcjonalna na e-maile marketingowe (tylko rejestracja; odmowa nie blokuje konta, wycofanie
  w ustawieniach powiadomień). `record_signup_consents` (service_role; Better Auth: marker v2
  w `auth.record_signup_receipts`) zapisuje każdy element osobno: `document_acceptances.kind`
  (`terms_acceptance`/`privacy_notice_ack`, dawne wiersze = `legacy_combined`, nie zgoda),
  zgoda na marketing jako zdarzenie dziennika #513 `email_consent_events` (źródło `signup`,
  język, wersja treści `sha256:` z `src/lib/signup-consents.ts`; odmowa = brak zdarzenia). Receipty niezmienne (trigger; usuwa je tylko kaskada usunięcia konta).
  Aplikowanie: pole „zapoznałem się z informacją o prywatności” zamiast „zgody”. Dowód:
  `rls.sql` sekcja CS493 (z kontrolą ujemną), `signup-consents.test`, E2E `consent-separation`.
  Szkic brzmień: `docs/legal-drafts/zgody-i-akceptacje.md` (PROJEKT, nieopublikowany).
  **Otwarte:** treść prawna (#61), podstawy (#485/#487).
- [x] Onboarding kandydata (6 kroków) — UI + realny zapis per krok do DB (`saveOnboardingStep`, RHF + stan zapisu)
  Pusta nazwa/imię/nazwisko → „wymagane” (także formularz firmy, #367); pozycje list (zawody 80,
  umiejętności 120, certyfikaty 160 = `CANDIDATE_ITEM_LIMITS`, zgodne z `left()` w 0028) —
  za długa nie trafia na listę (#364). Kod błędu serwera w komunikacie; `ONBOARDING_INCOMPLETE`
  przenosi do pierwszego brakującego kroku (#363).
  Jeden krok = jedno żądanie = jedna transakcja (#142, 0082): krok 3 (doświadczenie +
  umiejętności) i krok 5 (języki + certyfikaty) przez `save_candidate_onboarding_step3/5`
  (wewnątrz te same `set_candidate_*` — limity, dedup, replace-all). Błąd dowolnej części cofa
  cały krok. Krok 6 z „Zakończ”: dane kroku zapisane jednym upsertem, `finish_onboarding` tylko
  sprawdza kompletność, receipt best-effort. Dowód: `rls.sql` sekcja OB142 (wstrzyknięty błąd
  drugiej części + kontrola ujemna starej ścieżki).
  Edycja w trakcie zapisu (#813, bez migracji): pola kreatora zostawały edytowalne podczas
  oczekiwania na `saveOnboardingStep`, więc zmiana wpisana po kliknięciu „Dalej”/„Zapisz i wyjdź”/
  „Zakończ” była tracona — odpowiedź starszego snapshotu bezwarunkowo oznaczała krok jako
  zapisany i pozwalała nawigować dalej. `persistStep` (`OnboardingWizard.tsx`) porównuje teraz
  dane wysłane z bieżącymi wartościami formularza po każdej udanej odpowiedzi; różnica = nowsza
  edycja w trakcie zapisu → automatyczny ponowny zapis (limit 5 prób) przed zmianą kroku/wyjściem,
  zamiast fałszywego „Zapisano”. Ten sam wzorzec co naprawa #829 dla `JobWizard` pracodawcy.
  Prawo jazdy w kroku 4 (#762, bez migracji): kreator pokazywał pigułki kategorii (B/C/C+E), ale
  model danych i matching (`src/lib/matching/score.ts`) zawsze liczyły tylko boolean
  `hasDrivingLicense` — wybrana kategoria nie była nigdzie utrwalana ani porównywana z wymaganiami
  oferty, co sugerowało kandydatowi nieistniejącą precyzję. Pigułki zastąpione jednoznacznym
  przełącznikiem Tak/Nie (ten sam wzorzec co „Własny samochód” obok), spójnym z boolean
  `requiresDrivingLicense` w kreatorze oferty pracodawcy (`JobWizard.tsx`). Test:
  `onboarding-driving-license-toggle.test.tsx` (kontrola ujemna: pigułki kategorii nie istnieją
  w DOM).
  Dowód: `onboarding-wizard-save-revision.test.tsx` (4 testy: zapis nowszej wartości przy „Zapisz
  i wyjdź”/„Dalej”, kontrola ujemna bez zmian = jeden zapis, błąd ponownego zapisu bez wyjścia).
- [x] Panel kandydata — realne dane pod sesją (RLS) + akcje (zapis oferty, wycofanie aplikacji, odpowiedź na propozycję), noindex; fallback demo bez env

Historia własnych aplikacji w panelu jest stronicowana po 10 rekordów stabilnym kursorem
`submitted_at` + `id`; starsze zgłoszenia pozostają dostępne przez „Pokaż więcej”.
Granica strony (#180): 10 zgłoszeń = koniec listy, 11. na kolejnej stronie (test
`candidate-applications-pagination`).
Filtr etapu (#809, bez migracji): nawigacja „Wszystkie / W toku / Rozmowa / Propozycja /
Zakończone” nad listą (`CandidateApplicationsFilter` — zwykłe linki z `aria-current`, działa
bez JS), stan w URL `?etap=aktywne|rozmowa|propozycja|zakonczone` (nieznana wartość = wszystkie).
Grupy statusów w jednym miejscu `src/lib/candidate-application-filter.ts` (rozłączne, razem =
każdy status poza `draft`; test porównuje z enumem z migracji 0001). Warunek
`status = ANY($5)` w tym samym zapytaniu co kursor, PRZED limitem — starsze zgłoszenie etapu jest
na pierwszej stronie; „Pokaż więcej” przekazuje ten sam filtr (`loadMoreApplications`, Zod enum —
wartość spoza listy = błąd, nie „wszystkie”); zmiana etapu = nowa strona serwera, kursor od
początku. Pusty etap = osobny stan z linkiem „Pokaż wszystkie zgłoszenia”. Testy: unit
`candidate-applications-filter`, `-list`, `-action`, `-pagination`; integracja `portal-candidate`
(PG16, kontrola ujemna bez filtra); E2E `candidate-applications-pagination` (4 języki, 320 px).
Strefa czasowa dat i godzin (#865, bez migracji): formatery w `CandidateApplicationsList`,
`CandidateProposalsList`, `CandidateApplicationsPreview`, `CandidateMessagesPreview`,
`ConversationList` i `src/lib/messaging/thread-view.ts` liczyły dzień/godzinę w strefie procesu
(UTC na Railway) zamiast `APP_TIME_ZONE` (`Europe/Brussels`, `src/lib/datetime.ts`) — blisko
północy pokazywały dzień wcześniejszy niż w Belgii, a klienckie listy aplikacji/propozycji
dodatkowo rozjeżdżały się między SSR i hydratacją w przeglądarce. Każdy `Intl.DateTimeFormat`
w tych plikach dostaje teraz `timeZone: APP_TIME_ZONE`. Test: `candidate-timezone-formatting`
(kontrola ujemna: bez strefy ta sama chwila daje inny dzień).
Szczegół zgłoszenia `/candidate/aplikacje/[id]` (audyt P1-05/P1-06, strona kandydata; bez
migracji): karta listy linkuje „Szczegóły zgłoszenia” (nazwa z tytułem oferty, także gdy oferta
nie ma już publicznego adresu). `getMyApplicationDetail` pod sesją/RLS z jawnym
`candidate_id = me` (RLS 0039 wpuszcza też rekrutera firmy — kontrola ujemna w
`portal-candidate.test.ts`): dane wysłane do firmy (wiadomość, telefon, dostępność), odpowiedzi
ze snapshotu #101, historia statusów bez notatek firmy (`note`), stronicowana po 50 kursorem
`created_at` + `id` (`ApplicationHistoryList` z prop `loadMore` →
`loadMoreMyApplicationHistory`, własność sprawdzana ponownie), link do powiązanej rozmowy,
wycofanie (`ApplicationActions`). Cudze/usunięte/nieistniejące = 404, awaria = komunikat
z ponowieniem, demo oznaczone. Testy: unit `candidate-application-detail`,
`candidate-applications-list`; E2E `candidate-application-detail` (4 języki), `panel-a11y`.
Metadane ofert (#184, 0113): `get_applied_jobs_display(p_locale, p_job_ids)` filtruje oferty
bieżącej strony WEWNĄTRZ funkcji (SECURITY DEFINER nie jest inline'owana), więc baza nie liczy
całej historii; ≤ 100 identyfikatorów, tylko własne aplikacje. Ten sam filtr dla propozycji
i ostatniej aktywnej propozycji. Dowód: `rls.sql` sekcja PL109.
Paszport tożsamości nad siatką `/candidate/profil` (#172, `CandidateIdentity`): imię, pierwszy
zawód, miasto, znana dostępność; bez zdjęcia i inicjałów, po błędzie odczytu tylko komunikat.
Kolejne strony są odczytywane pod bieżącą sesją/RLS; błąd i ponowienie nie kasują
już wczytanych kart. Jest to część etapu wyglądu #5, nie dowód ukończenia całego etapu.

Zapisane oferty bez strony publicznej (migracja `0162`):
`get_saved_jobs_display` zwraca KAŻDY własny zapis z `job_availability` (`available`/`closed`/
`expired`/`paused`/`unavailable` — warunki `available` = `get_public_job`; usunięta oferta albo
firma = `closed`, firma niezweryfikowana/zawieszona = `unavailable`), `slug` tylko dla
`available`. Dawniej zapis zamkniętej/wygasłej/wstrzymanej oferty znikał z `/candidate/zapisane`
bez śladu, a wiersz `saved_jobs` zostawał. Mapowanie w jednym miejscu
`src/lib/saved-job-availability.ts` (`toSavedJob`: nieznany stan albo brak slugu = bez linku);
karta `SavedJobUnavailableItem`: etykieta stanu (`dashboard.savedState*`), tytuł i firma, bez
linku i zakładki, „Usuń z zapisanych” (`toggleSavedJob(id, false)`, blokada w trakcie, komunikat
`role="status"` z fokusem, błąd przy przycisku). Klasyfikacja zgodna z historią zgłoszeń (PR
#758, `candidate_job_availability`) + stan `paused`; świadomie inline, bez zależności od 0206.
Dowód: `rls.sql` sekcja SV162 (kontrola ujemna: definicja z 0066 gubi 5 z 6 zapisów),
`portal-candidate` (PG16: po terminie = `expired` bez slugu, usunięcie pod RLS), unit
`saved-job-availability` i `candidate-saved-jobs` (kontrole ujemne), E2E `candidate-saved-closed`
(fixture, 4 języki, 320 px, axe; mutacja strony = czerwony).
Cel zapisu (#882, migracja `0199` — numer tymczasowy): nowy wiersz `saved_jobs` tylko dla oferty
publicznej — BEFORE INSERT `trg_saved_jobs_guard_target` (warunki `get_public_job`, `FOR SHARE`
oferty i firmy przeciw równoległemu wycofaniu; szkic/usunięta/firma niezweryfikowana = `NOT_FOUND`,
ponowienie istniejącej pary przechodzi; wyjątek tylko seed demo jak w 0171). Dowód
`saved_jobs.saved_while_public` ustala trigger; backfill tylko dla ofert publicznych w chwili
migracji. `get_saved_jobs_display` zwraca tytuł/firmę/miasto oferty niepublicznej wyłącznie przy
dowodzie (inaczej puste pola — karta „nieznana oferta”, zapis usuwalny). Dowód: `rls.sql` sekcja
SJ968 (kontrole ujemne: bez strażnika, odczyt z 0162, strażnik bez `FOR SHARE` w dwóch sesjach),
rollback `0199_…down.sql`, `portal-candidate` (PG16), unit `candidate-saved-jobs`.

Porównanie zapisanych ofert (#816, bez migracji): `/candidate/zapisane` ma checkbox „Porównaj” przy każdej
DOSTĘPNEJ ofercie (formularz GET `?porownaj=`, działa bez JS; skrypt tylko pilnuje limitu 3 i przycisku od 2)
i tabelę `SavedJobsComparison` nad listą: wynagrodzenie (waluta i okres z oferty, bez przeliczeń), rodzaj umowy,
godziny, zmiany, zakwaterowanie i dojazd („Koszty i dodatki” albo flagi), kluczowe wymagania obowiązkowe (≤ 5),
jawny „Brak danych”, link do oferty. Wybór ograniczony do własnych zapisów (`parseCompareSelection`), oferta
zamknięta/wygasła/wstrzymana albo z błędem odczytu = kolumna ze stanem bez linku; szczegóły z `getJobBySlug`
(bez nowych zapytań o dane procesu). Model: `src/lib/saved-job-compare.ts`. Dowód: unit `saved-job-compare`,
`saved-search-pause-follow-ui`, E2E `candidate-saved-closed` (porównanie, 4 języki, 320 px, axe).

Wygląd panelu kandydata, onboardingu, wiadomości, powiadomień, toastu i aplikowania = kalka
prototypu „04 Ludzie i praca” (#5/#6): klasy `panel-styles.ts` (wspólne z pracodawcą/adminem)
+ `src/components/candidate/candidate-styles.ts`; odstępstwa w `docs/design/people-passport/README.md`.
Kompletność profilu (pulpit + profil) = 6 kroków kreatora onboardingu, jedno źródło
`src/lib/profile-completeness.ts` (`PROFILE_SECTIONS`/`computeProfileChecklist`); kompletny
kreator = 100% (#315). Flaga `profile_completed` w DB (`finish_onboarding`) ma własne kryteria.
Baner nowej propozycji prowadzi do `/candidate/propozycje#offer-{id}` (#324); „Najnowsze
wiadomości” linkują do `?c={id}` (#340); menu „…” aplikacji ma pełny wzorzec ARIA menu (#341).
Bez pozycji menu (#806, bez migracji): dla zakończonej aplikacji (status poza `WITHDRAWABLE`) do
oferty bez publicznej strony (`slug === null` — zamknięta/wygasła/niedostępna, #206) przycisk „…”
w ogóle się nie renderuje, zamiast otwierać puste `role="menu"` bez pozycji, którego Escape/Tab
nie zamykały. Ten sam status ZE slugiem lub status w toku BEZ slugu (akcja „Wycofaj” zostaje)
nadal pokazują przycisk. Dowód: `candidate-confirm-actions.test.tsx` (kontrola ujemna: status
w toku bez slugu ma akcję „Wycofaj” i przycisk się renderuje).
Polecane oferty — wyjaśnienie i stan zgłoszenia (bez migracji, dane z materializacji P1-03):
karta z wynikiem na `/candidate/oferty-polecane` pokazuje krótką etykietę (`match.summaryShort`,
liczona z procentu przez `summaryKeyForScore` — to samo źródło co `scoreMatch`, więc starszy
wiersz z domyślnym `summary_key` nie przeczy procentowi), „Wymagania obowiązkowe: X z Y” tylko
przy spójnych liczbach (Y > 0, X ≤ Y) i do dwóch atutów WYŁĄCZNIE ze znanych kluczy
`match.criteria` (`src/lib/matching/explanation.ts`; nieznana wartość z bazy nie trafia do UI).
Oferta z własnym zgłoszeniem (także w fallbacku najnowszych) ma „Już aplikowałeś(-aś)” i link
„Szczegóły zgłoszenia” nad nakładką tytułu → `/candidate/aplikacje/[id]` (jedno zapytanie tylko
o pokazane oferty, jawny `candidate_id = me` — RLS 0039 wpuszcza też rekrutera). Testy: unit
`match-explanation` (strażnik: lista kluczy = atuty wpisywane w `score.ts`, kontrole ujemne),
`candidate-recommended-read`, integracja `portal-candidate` (PG16), E2E
`candidate-recommended-explanation` (4 języki, axe, kliknięcie linku nad nakładką).

Blokada firmy przez kandydata (#97, migracja `0078`): tabela `candidate_company_blocks`
(RPC-only `set_company_block`, odczyt `get_my_company_blocks`/`get_job_company_block`, firma nie
ma ścieżki odczytu). Egzekwowanie w bazie: `company_can_view_candidate` (profil/PII),
wyszukiwanie (`candidate_profiles_select_employer`, `candidate_profile_is_searchable`), `matches`,
triggery BEFORE INSERT na `offers`/`conversations`/`messages` (neutralny błąd jak brak relacji),
polecane (`get_public_jobs_by_ids` pod sesją). Historia aplikacji/rozmów zostaje. UI: sekcja
„Zablokowane firmy” w `/candidate/ustawienia` + kontrolka na szczególe oferty. Dowód: `rls.sql`
sekcja BL. Lista wyników (`0090`): `get_public_jobs`/`_count`/`get_public_job_filter_facets`
pomijają oferty firm zablokowanych przez wywołującego (gość/pracodawca bez zmian, więc strony
ISR zostają wspólne); `/oferty-pracy` przekazuje UUID kandydata ze zweryfikowanej sesji
(`src/lib/auth/candidate-viewer.ts` → `readPortalIdentity`), publiczny URL oferty bez zmian.
Dowód: `rls.sql` sekcja BL97 (kontrola ujemna: bez `0090` pada BL97-1). **Otwarte:** działa,
gdy sesje Better Auth są spięte z trasami (#24) — bez runtime auth lista zostaje listą gościa.
Historia propozycji bierze dane oferty z `get_offered_jobs_display` (0090), więc blokada nie
kasuje tytułu propozycji bez aplikacji (BL97-6).
Blokada z istniejącego wątku (#832, bez migracji): do #832 jedyna ścieżka UI była szczegół
AKTYWNEJ publicznej oferty (`JobCompanyBlockControl`) — po zamknięciu ostatniego ogłoszenia
firmy ta ścieżka znikała, choć rozmowa i prawo firmy do wysyłania wiadomości zostawały (samo
zamknięcie oferty nie tworzy blokady). `getConversationThread` (`src/lib/data/messages.ts`)
dolicza teraz `ConversationThread.companyBlock` — dla strony KANDYDACKIEJ rozmowy (nie dla
widza po stronie firmy, `ctx.viewerIsCompany` z #355/0143) i tylko gdy nazwa firmy jest
rozwiązywalna — czytany bezpośrednio z `candidate_company_blocks` pod RLS (polityka
`..._select_own`, 0078; bez nowego RPC). `ConversationCompanyBlockControl` w nagłówku wątku
zapisuje przez ten sam `setCompanyBlockAction`/`set_company_block` co ustawienia i szczegół
oferty (RPC już przyjmuje dowolną nieusuniętą firmę, bez wymogu aktywnej oferty). Bezpiecznik:
`MessageThread` renderuje kontrolkę tylko z jawnym `allowCompanyBlock` (ustawianym przez
`MessagesView` wyłącznie na `/candidate/wiadomosci`) — nigdy w panelu pracodawcy, także dla
danych DEMO (które nie rozróżniają widza). Dowód: unit `conversation-thread-result`
(w tym kontrole ujemne: widz po stronie firmy i rozmowa bez firmy nie dostają `companyBlock`,
zero zapytań do bazy), `message-thread-company-block` (kontrola ujemna `allowCompanyBlock`),
`conversation-company-block-control`. **Otwarte:** ta sama kontrolka na własnej historii
rekrutacji kandydata i na publicznym profilu firmy (issue wskazywał je jako alternatywne
miejsca — wątek pokrywa opisany scenariusz odtworzenia).
Dynamiczne facety (#874, bez migracji): `GET /api/job-filter-facets` (zmiana filtra bez
przeładowania strony) czytał zweryfikowanego kandydata pomijając sesję — agregat SQL działał
wtedy jak dla gościa i mógł zawyżyć licznik/CTA o oferty firm zablokowanych przez kandydata
(po zatwierdzeniu filtra SSR i tak pokazywał poprawny, węższy wynik). Endpoint czyta teraz
tego samego `readCandidateViewerId()` co strona listy i przekazuje go do `getJobFilterFacets`/
`getJobs`; klucz krótkiego cache + single-flight (#595) uwzględnia `candidateId`, więc gość
i różni kandydaci nigdy nie dzielą spersonalizowanego wpisu. Dowód: unit
`job-filter-facets-route` (osobna agregacja na kandydata, kontrola ujemna: ten sam kandydat
w oknie cache = bez nowej agregacji).
Cache facetów przy renderowaniu SSR (#903, bez migracji): powyższy cache + single-flight chronił
tylko endpoint AJAX `/api/job-filter-facets` — renderowanie strony `/oferty-pracy` woła
`getJobFilterFacets` BEZPOŚREDNIO przy każdym żądaniu HTML, z pominięciem tej ochrony (#595
zamykało to tylko dla ścieżki AJAX). Cache + single-flight przeniesiony na poziom samej funkcji
współdzielonej `getJobFilterFacets` (`src/lib/jobs.ts`) — SSR i endpoint AJAX z tymi samymi
filtrami i tym samym widzem w krótkim oknie (15 s) dzielą teraz jedną agregację SQL niezależnie
od tego, którą ścieżką wynik jest pobierany; klucz nadal uwzględnia `candidateId` (#97), więc
wynik jednego kandydata nigdy nie wycieka do innego ani do gościa. Dowód: unit
`job-filter-facets-ssr-cache` (jedna agregacja dla równoległych i odrębnych wywołań SSR,
kontrole ujemne: inny kandydat i inne filtry → osobna agregacja).

Widoczność profilu dla firm (**wyłączone w trybie ogłoszeniowym, #1135**; #494, migracja `0100`): przełącznik
„Pozwól zweryfikowanym pracodawcom znaleźć mój profil” w `/candidate/ustawienia`
(`ProfileVisibilitySettings`, akcja `setProfileVisibilityAction` → `set_candidate_searchable`
pod sesją; stan UI = ponowny odczyt z bazy, bez optymistycznej zmiany). Domyślnie wyłączone
(także po `finish_onboarding`); włączenie tylko dla ukończonego profilu, wyłączenie zawsze.
Znacznik `candidate_profiles.searchable_changed_at` + historia `candidate_visibility_events`
(tylko przy realnej zmianie, RPC-only, odczyt własny). Po włączeniu zweryfikowana firma widzi
dane zawodowe profilu i relacje; imię/kontakt (`profiles`) i CV — nie. Wyłączenie działa od razu
dla wyszukiwania i `matches` (polityka wymaga widoczności kandydata, także po znanym ID);
relacja z aplikacji/propozycji (`company_can_view_candidate`) zostaje — zatrzymuje ją blokada
firmy. Dowód: `rls.sql` sekcja VIS494 (kontrole ujemne: polityka `matches` z 0078, guard z 0029);
unit `profile-visibility`; E2E `candidate-profile-visibility.spec`. Propozycja od firmy nadal
odsłania jej rekruterom imię i kontakt kandydata z konta (`company_can_view_candidate` po
`offers`) — zachowanie bez zmian, decyzja właściciela 26.09.2026 (`docs/PRODUCT_DECISIONS.md`).

Polityka wieku kandydatów (#492, #576, migracja `0126`). Decyzja właściciela 25.09.2026
(LAUNCH-1): konto kandydata od 16 lat, widoczność profilu dla firm (#494) tylko 18+, młodsi bez
konta. Próg konta jako dane (`age_policy`: 16 albo 18, domyślnie 16, `confirmed=true`; zmiana
tylko `admin_set_candidate_min_age` z uzasadnieniem i audytem `age_policy.updated`). Minimalizacja:
potwierdzenie PRZEDZIAŁU „16–17” / „18 lub więcej” bez daty urodzenia (`candidate_age_attestations.min_age`
= 16 albo 18, niezmienne, RPC-only; po ukończeniu 18 lat nowe potwierdzenie 18+). Deklaracja:
rejestracja kandydata (`AgeDeclarationField` — radiogroup obok zgód #493; Better Auth przez trigger
`auth.record_signup_receipts` w transakcji konta; poniżej progu → `AGE_ATTESTATION_REQUIRED`; RPC
service_role `record_candidate_age_attestation` dla kont spoza formularza), formularz gościa
(`p_age_attested_min` → wrapper `submit_guest_application`), sekcja „Wiek” w `/candidate/ustawienia`
(`attest_candidate_age`; konto 16–17 widzi ograniczenie i potwierdza 18+). Egzekwowanie w bazie
triggerami: aplikacja i przejęcie aplikacji gościa, propozycja (neutralny błąd), zgłoszenie gościa;
włączenie widoczności (`set_candidate_searchable` i każda inna ścieżka) tylko przy 18+
(`candidate_is_adult`, `AGE_ADULT_REQUIRED` → UI: wyłączony przełącznik z wyjaśnieniem
`profileVisibility.requiresAdult`); migracja jednorazowo ukrywa profile bez 18+. Lejek ofert
(#99) dla 16–17 = brak zgody: znacznik urządzenia `pracujbe.funnel.minor` (panel kandydata po
odczycie z bazy — `FunnelMinorMarker`; rejestracja/gość po wyborze 16–17) → `sendFunnelEvent` nic
nie wysyła; potwierdzenie 18+ zdejmuje znacznik. Formularze pokazują przedziały od
`candidate_min_age()` (błąd odczytu → tylko 18+). Dowód: `rls.sql` sekcja AGE492 (kontrole ujemne:
bez triggera aplikacja/gość bez deklaracji przechodzą, konto 16–17 staje się wyszukiwalne — AGE11n);
unit `age-policy` (lejek z kontrolą ujemną), `profile-visibility`, `guest-apply-form`; E2E
`auth-age-declaration`, `guest-apply`, `job-funnel-minor-marker` (PRIV-01: przy znaczniku zero żądań
`/api/job-funnel` mimo zgody — strony, „Aplikuj”, zamknięcie karty, druga karta, znacznik zapisany w
drugiej karcie; kontrole ujemne bez znacznika i z inną wartością, mutacja bramki = czerwony). Szkic (nieopublikowany): `docs/legal-drafts/kandydaci-niepelnoletni.md`.
Wspólny stan wieku na `/candidate/ustawienia` (#828, bez migracji): sekcje „Wiek” i widoczność profilu dostają jeden stan z `AgeStatusProvider` (`src/components/settings/age-status-context.tsx`); udany zapis 18+ odblokowuje przełącznik kompletnego profilu bez przeładowania, ale go nie włącza (osobny opt-in #494); nieudany zapis/`meetsPolicy=false`/niekompletny profil — bez zmian. Test `age-visibility-settings` (kontrola ujemna: sam prop z odczytu strony zostawia blokadę).
UI zmiany progu w panelu admina (#492): `/admin/ustawienia` — bieżący próg, status zatwierdzenia
i ostatnia zmiana z dziennika (`getAgePolicySettings`, odczyt service-rolem po `requireAdmin`),
formularz wyboru 16/18 + uzasadnienie (zawsze wymagane, jak przy statusie firmy) + dialog
potwierdzenia (`AgePolicyForm`, `AdminConfirmDialog`), zapis przez `setCandidateMinAge`
(`admin_set_candidate_min_age` pod sesją admina). Bez treści prawnej — same etykiety funkcji.
**Otwarte (właściciel/prawnik):** treść informacji o wieku (`07-wiek.md`) po akceptacji, kontakt
osób poniżej 16 lat z udziałem opiekuna, oznaczenie ofert dla młodocianych, procedura dla
wykrytego konta poniżej progu.

Zapisane wyszukiwania i alerty (#100, migracja `0092`): „Zapisz wyszukiwanie” na
`/oferty-pracy` (przy co najmniej jednym filtrze; strona nie czyta sesji — akcja
`saveSearchAction`) zapisuje KANONICZNE filtry v1 = dokładnie argumenty `get_public_jobs`
wysłane przez listę (`src/lib/job-list-query.ts`, jedno źródło z listą; aliasy miast
rozwinięte, bez `date`). RPC-only: `save_saved_search` (kandydat, identyczne filtry → ten sam
wiersz, limit 20), `set_saved_search_alerts` (włączenie przesuwa `alerts_since`/watermark —
bez zaległych ofert), `delete_saved_search`; odczyt własnych pod RLS. Worker
`process_saved_search_alerts` (service_role, `/api/maintenance` co godzinę, `SKIP LOCKED`)
woła `get_public_jobs` z filtrami i `p_since` = watermark − 1 h, pomija firmy zablokowane,
rejestruje parę w `saved_search_alerts` (PK = brak ponownej wysyłki), tworzy jedno in-app
(`job_match`, `entity_type='saved_search'`) i jeden e-mail `jobMatch` (digest ≤ 5 ofert,
język odbiorcy, opt-out `email_job_matches`); digest najwyżej raz na dobę/tydzień. Panel:
`/candidate/wyszukiwania` (alert, częstotliwość, usunięcie). Dowód: `rls.sql` sekcja SS100;
unit `saved-search-alerts`; E2E `saved-search.spec`.
Dokończenie (migracja `0124`): zmiana nazwy w `/candidate/wyszukiwania`
(RPC `rename_saved_search`: tylko własne, 1–80 znaków, bez znaków sterujących; cudze = `NOT_FOUND`).
E-mail `jobMatch` ma link „Wyłącz tylko ten alert” → `/{locale}/wypisz-alert#t=` (noindex,
token HMAC `src/lib/email/saved-search-alert-token.ts`: UUID konta + wyszukiwania, osobna
domena podpisu, sekret `EMAIL_UNSUBSCRIBE_SECRET`, bez e-maila w URL; zapis po kliknięciu przez
`saved_search_alert_unsubscribe`, tylko service_role, tylko właściciel z tokenu). Link liczy
worker (payload go nie podmieni). Kolejka: `email_delivery_suppression_reason` (blokada adresu,
zgoda kategorii, uprawnienie odbiorcy firmowego z 0122 — kontrola `ES503-2b/2c`, wyłączony/usunięty alert, kampania) w `claim_email_batch` i w
`email_delivery_send_check` — worker woła ją tuż przed budżetem i `send` (#466 pkt 8), wiersz
niedozwolony jest wygaszany (`suppressed_alert_disabled` / `suppressed_opt_out`…). Dowód:
`rls.sql` sekcja SS108 (kontrole ujemne), unit `saved-search-followups`,
`saved-search-rename-ui`, E2E `saved-search.spec` (`/wypisz-alert`).
Nagłówek one-click digestu alertu (`List-Unsubscribe` + `List-Unsubscribe-Post`, RFC 8058)
wskazuje `POST /api/email/unsubscribe-alert?t=&l=` z tym samym tokenem alertu co `/wypisz-alert`
(`alertOffHeadersFor` w `outbox.ts`) — wyłącza tylko ten alert (`saved_search_alert_unsubscribe`,
service_role, idempotentnie), GET = 303 na stronę potwierdzenia; inne maile i `jobMatch` bez
wyszukiwania zachowują nagłówek kategorii, stopka nadal ma wypisanie z kategorii. Dowód: unit
`saved-search-followups` (kontrola ujemna: token kategorii w nagłówku/trasie), E2E `saved-search.spec`.
Bez limitu 100 ofert na przebieg (migracja `0138`): worker bierze nowe oferty z
`saved_search_matching_jobs` — kolejne strony `get_public_jobs` po 100 w jednym zapytaniu (jeden
snapshot); remis `published_at` rozstrzyga `id` w `get_public_jobs` (0136, #594), więc strony
są bez dziur i dubli. Digest nadal ≤ 5 ofert (`count` = wszystkie nowe), najwyżej raz
na dobę/tydzień, para (wyszukiwanie, oferta) raz. Dowód: `rls.sql` sekcja SC100 (105 ofert z remisem;
kontrola ujemna: jedna strona jak w 0092 gubi ofertę 101).
Bez górnej granicy 10 100 ofert (migracja `0158`): `saved_search_matching_jobs`
stronicuje kursorem (`published_at`, `id`) po 1000 (`saved_search_keyset_page` →
`saved_search_jobs_after`, tylko service_role) zamiast offsetu `get_public_jobs` (clamp 10 000),
nadal w jednym zapytaniu (jeden snapshot); `p_max_pages` = strony kursora, domyślnie bez limitu.
Filtry = blok FROM … WHERE skopiowany 1:1 z najnowszej definicji `get_public_jobs` (kontrakt listy
ofert bez zmian); rozjazd kopii łapie `saved-search-keyset-sync.test` (z kontrolą ujemną). Worker
bez zmian (blokady firm, digest ≤ 5, `count` = wszystkie nowe, para raz). Dowód: `rls.sql` sekcja
SK100 (10 151 ofert z remisem + firma zablokowana; kontrola ujemna: offset z 0138 gubi oferty
za 10 100). Zmiana filtrów `get_public_jobs` = ta sama zmiana w `saved_search_jobs_after`.
Termin digestu bez dryfu (#1112, migracja `0211` — numer tymczasowy): worker liczył
`next_run_at` od chwili przebiegu (cron co godzinę przesuwał porę digestu); teraz
`saved_search_next_run_at` = poprzedni termin + pełne okresy w czasie ściennym Europe/Brussels
(stała pora także przy zmianie czasu), pierwszy termin po przebiegu, zaległe okresy pominięte.
Dowód: `rls.sql` sekcja SD1112 (kontrola ujemna: worker z 0138 dryfuje), rollback
`0211_…down.sql` (`saved-search-schedule-rollback.sql`).
Tryb ogłoszeniowy (#1148, bez migracji): zapisane wyszukiwania i alerty działają bez zmian, bo
wynikają wyłącznie z filtrów użytkownika. Strażnik `tests/legal/classifieds-saved-search.test.ts`:
najnowsze definicje funkcji `*saved_search*` bez profilu kandydata i dopasowań (wyjątek: blokada
firmy #97), klucze filtrów v1 = parametry `get_public_jobs` (SQL i lustro TS), kolejność = lista
publiczna, akcje/strony/trasy bez bramki trybu, `/api/maintenance` woła worker alertów w trybie
(kontrole ujemne). `rls.sql` sekcja SS1148 (konto bez `candidate_profiles` i z nieukończonym
profilem: zapis, nazwa, alert, digest, wyłączenie z linku; kontrola ujemna: wymóg onboardingu).
E2E `tests/e2e-real/saved-search-classifieds.spec.ts` (`E2E_PORTAL_LEGAL_MODE=`, mutacja
`saved-search-requires-onboarding` = czerwony).
Pauza alertów i obserwowanie firmy (#810, #855, migracja `0215` — numer tymczasowy, bez zmiany
`get_public_jobs` ani `saved_search_jobs_after`): jedna czasowa pauza dla konta (`saved_search_alert_pauses`,
RPC `set_saved_search_alerts_pause(date)`: jutro..+366 dni, Europe/Brussels; `null` = wznów od razu). Worker
`process_saved_search_alerts` pomija konta w pauzie (wyszukiwanie zostaje do wykonania), a po jej końcu liczy
nowości od `paused_until` — oferty z okresu pauzy nie wracają lawiną, późniejsze trafiają do kolejnych alertów;
ustawienia pojedynczych wyszukiwań bez zmian. Panel `/candidate/wyszukiwania`: `SavedSearchesPause` (data,
„Wstrzymaj”/„Wznów teraz”; błąd odczytu = jawny komunikat, nie „brak pauzy”). Obserwowanie firmy = zapisane
wyszukiwanie z `saved_searches.company_id` (filtry v1 `{}`, hash `md5('company:'||id)`, limit 20 wspólny):
RPC `follow_company`/`unfollow_company`/`get_my_followed_companies` (tylko kandydat, firma `verified` z profilem,
zablokowana przez kandydata = `NOT_FOUND`); worker bierze dla nich nowe aktywne niewygasłe oferty firmy po
`company_id` (blokady #97, deduplikacja pary wyszukiwanie–oferta, zgody, wypisanie z linku jak przy wyszukiwaniu);
digest to osobny szablon `followedCompanyJobs` („Nowe oferty firmy …”, PL/NL/FR/EN, payload `companyName`/`count`/`jobs`,
kategoria `job_matches` i pula marketingowa jak `jobMatch`, link i `List-Unsubscribe` tokenem alertu wyłączają tylko tę
obserwację). Przycisk „Obserwuj firmę” (`FollowCompanyButton`, wyspa na ISR-owym
profilu `/pracodawcy/<slug>`: gość = link logowania z powrotem, pracodawca/demo nic); firma nie ma odczytu
obserwujących. Dowód: `rls.sql` sekcje PS969/FC969 (kontrole ujemne na definicji workera: bez klauzuli pauzy,
bez dolnej granicy, bez filtra firmy, bez klauzuli pauzy w kolejce), rollback `0215_…down.sql`
(`saved-search-pause-follow-rollback.sql` w `test-rls.sh`), unit `saved-search-pause-follow`,
`saved-search-pause-follow-ui`, `saved-search-followups`. Digest zakolejkowany przed pauzą jest wygaszany
(`suppressed_alert_paused`) przy claimie i tuż przed wysyłką — `email_delivery_suppression_reason` w 0215 bazuje na
definicji z 0186 (oba szablony alertu, z niepotwierdzonym adresem marketingu #1038). **Otwarte:** wypisanie z alertów firmy w jednym kliknięciu z pauzą.
Filtry przy wyszukiwaniu (bez migracji): każda karta w `/candidate/wyszukiwania` pokazuje listę
filtrów (`<ul>` nazwana `savedSearches.filtersLabel` z nazwą wyszukiwania) w języku PANELU —
etykiety liczy serwer z kanonicznego `saved_searches.query` (`savedSearchFilterLabels`
w `src/lib/job-filter-summary.ts`: `parseJobListQuery` w języku widza, bez `date`; pusty/zły
adres = brak listy), więc po zmianie nazwy albo języka kandydat nadal widzi, czego dotyczy
alert. To samo źródło (`describeJobListFilters`) buduje chipy `/oferty-pracy` (etykieta +
parametr do usunięcia), więc panel i lista nie rozjadą się. Test: unit
`saved-search-filter-summary` (4 języki, zgodność z chipami, kontrole ujemne: pusty/nieprawidłowy
adres, brak pustej listy).
„Pokaż oferty” w locale zapisu, nie panelu (#823, bez migracji — kolumna `saved_searches.locale`
istniała od `0092`, tylko nie była odczytywana): `loadMySavedSearches` zwraca teraz `locale`
zapisu (`SavedSearch.locale`, `mapSavedSearchRow` z bezpiecznym fallbackiem do
`routing.defaultLocale` dla brakującej/nieobsługiwanej wartości — nigdy dowolny ciąg z bazy).
Przycisk „Pokaż oferty” w `SavedSearchList` linkuje przez `Link` z jawnym `locale={search.locale}`
(zamiast bieżącego języka panelu next-intl), więc kandydat zawsze widzi ten sam zbiór ofert co
worker alertów (`get_public_jobs` z `p_locale => v_search.locale`, 0092) — kluczowe przy
wyszukiwaniu ze słowem kluczowym, bo tytuł dopasowywany jest w JEDNYM języku. Gdy zapisany
locale różni się od panelu i wyszukiwanie ma słowo kluczowe, dodatkowa notatka
(`savedSearches.openLocaleNote`) tłumaczy, w jakim języku otworzy się lista. Dowód: unit
`saved-search-locale-link` (mapper: obsługiwany/brakujący/nieobsługiwany locale z kontrolą
ujemną; komponent: link pod locale zapisu różnym i tym samym co panel, notatka tylko przy
słowie kluczowym i różnym locale, z kontrolami ujemnymi).

Import CV przez AI (**wyłączone w trybie ogłoszeniowym, #1138**; #487, #498, migracja `0115` — numer tymczasowy, za flagą `AI_CV_IMPORT_ENABLED`, domyślnie
wyłączony, osobno od importu ogłoszeń): `/candidate/profil/import-cv` (404 bez flagi, link w
profilu tylko z flagą). PDF/DOCX → tekst lokalnie (`src/lib/cv-import/text.ts`: pdf.js 5 bez
`eval`, DOCX tylko `word/document.xml` z limitem dekompresji) → minimalizacja
(`minimize.ts`: NISS/BIS/dokument → odmowa; sekcje referencji i danych osobowych, linie o
osobach trzecich, dane osobowe, kategorie art. 9/10, kontakty i linki usunięte; kontakt poza
nagłówkiem dokumentu → bezpieczne zatrzymanie) → PODGLĄD tekstu dla kandydata → po
potwierdzeniu ponowna redakcja na serwerze i model OpenAI (structured output, tylko zawody/
umiejętności/języki/certyfikaty/lata) → PROPOZYCJE ze źródłem i niepewnością, domyślnie
niezaznaczone → kandydat może poprawić wartość każdej propozycji (nazwa, poziom języka, lata;
bez wywołania modelu) — `src/lib/cv-import/approved.ts` = elementy `step2/3/5Schema` kreatora
(`CANDIDATE_ITEM_LIMITS`), błąd przy polu i fokus na pierwszym błędnym polu → zapis wyłącznie
zaznaczonych RPC `apply_candidate_cv_proposals` (akcja waliduje ponownie tym samym schematem —
wartość spoza limitu po edycji = `VALIDATION_FAILED` bez bazy; dopisanie, `FOR UPDATE`, limity
kreatora, brak zatwierdzenia = `VALIDATION_FAILED`). Pliku, tekstu ani
propozycji nie zapisujemy; CV nie trafia do firm, wynik nie wpływa na `scoreMatch`. Limit 5/h
i 10/dobę na konto (fail-closed). Dowód: `rls.sql` sekcja CV487 (kontrola ujemna replace-all);
unit `cv-import-*` (payload modelu bez referentów + kontrola ujemna bez minimalizacji;
`cv-import-approved`/`-actions`: edycja za długa = odrzucenie na serwerze, kontrola ujemna
schematu bez limitu); E2E `cv-import.spec` (atrapa, edycja z błędem pola). Opis: `docs/AI_CV_IMPORT.md`. **Otwarte:** decyzje prawne w szkicu
`docs/legal-drafts/cv-ai-osoby-trzecie.md` (#485/#486/#488/#61) przed włączeniem, AV i izolacja
parsera.
Duplikat języka po normalizacji (#805, bez migracji): dwie zatwierdzone propozycje, których nazwa
języka jest po `trim()+lowerCase` identyczna (choćby inny zapis wielkości liter), ale poziom
różny, zapisałyby się w RPC 0115 nieokreślenie (`DISTINCT ON` bez tie-breakera na poziom) —
`cvApprovedProposalsSchema` (`superRefine`) odrzuca taki zestaw przed wysyłką (`VALIDATION_FAILED`),
a `findDuplicateLanguageIds` wskazuje konflikt przy obu polach w `CvImportPanel` (komunikat
`cvImport.errorLanguageDuplicate`) zanim akcja w ogóle zostanie wywołana. Dowód: unit
`cv-import-approved` (schemat + funkcja, kontrola ujemna różnych nazw), `cv-import-panel`
(blokada zapisu, fokus na pierwszym konflikcie, poprawka nazwy odblokowuje zapis).

Historia propozycji kandydata (`/candidate/propozycje`) jest stronicowana tak samo: po 10
rekordów kursorem `created_at` + `id` (`getMyOffersPage` + `loadMoreProposals`), bez limitu 20 (#245).

Stan oferty w historii (migracja `0157`): `get_applied_jobs_display`
i `get_offered_jobs_display` zwracają `job_availability` (`available`/`expired`/`closed`/
`unavailable`, klasyfikacja `candidate_job_availability` = warunki `get_public_job`: aktywna,
nieusunięta, przed terminem, firma `verified`), a `slug` tylko dla `available` — lista zgłoszeń,
podgląd na pulpicie, szczegół zgłoszenia i propozycje nie linkują do strony publicznej, która
dałaby 404, tylko pokazują etykietę `JobAvailabilityNote` (`dashboard.jobAvailability*`). Tytuł
i firma zostają dla każdego stanu, szczegół zgłoszenia zawsze dostępny. E-maile nie linkują do
strony oferty (statusChanged → panel, guestStatusChanged → lista ofert). Dowód: `rls.sql` sekcja
AV157 (kontrola ujemna: bez klasyfikacji zamknięta oferta dostaje link), unit
`candidate-job-availability` (kontrola ujemna: oferta publiczna = link bez etykiety).

Granica błędu i 404 wewnątrz panelu kandydata (bez migracji, wzór jak panel pracodawcy #895):
`src/app/[locale]/candidate/error.tsx` (`CandidatePanelError`) i `not-found.tsx`
(`CandidateNotFound`) leżą POD layoutem `/candidate`, więc nieobsłużony błąd strony albo
`notFound()` (szczegół zgłoszenia, import CV bez flagi) nie zastępuje już panelu publiczną stroną
błędu/404 — sidebar i dolny pasek zostają. Błąd: komunikat z i18n (`dashboard.candidatePanelError*`,
Invariant #8), do kanału błędów sam kod (`captureError`), „Spróbuj ponownie” = `useErrorRetry`,
link do pulpitu. 404: status 404, bez ujawniania, czy obiekt istnieje, linki do pulpitu/zgłoszeń/
polecanych ofert, bez drugiego `<main>`. Testy: unit `candidate-admin-panel-boundaries`
(4 języki, bez treści wyjątku, kontrola ujemna linków spoza panelu), E2E
`candidate-application-detail` (404 z sidebarem, 4 języki).

### Etap 4 — pracodawca
- [x] Konto firmy + weryfikacja — `/employer/firma` (create przez `create_company_with_owner`, edycja, baner statusu) + weryfikacja przez admina (`admin_set_company_status`, 0019)
  Odebrany dostęp (#1210, decyzja właściciela 29.09.2026, bez migracji): konto z WYŁĄCZNIE nieaktywnymi
  członkostwami widzi w layoucie `/employer` `RevokedCompanyAccess` — „Twój dostęp do firmy X został odebrany”
  (nazwy z `getRevokedCompanyNames`: service_role, tylko `name`, identyfikator z sesji; awaria = komunikat ogólny,
  bez szczegółów), zaproszenia i własna firma przez `createAdditionalCompany` (`create_additional_company`)
  zamiast `create_first_company` (PERMISSION_DENIED). Testy: `employer-revoked-access(-layout)`,
  `revoked-company-names` (kontrole ujemne: brak członkostw = pierwsza firma, aktywne = panel).
  Bootstrap po rejestracji (#28): callback Auth (`bootstrapCompany` w `actions/auth.ts`) woła
  wyłącznie `create_first_company` — blokada profilu i ponowne sprawdzenie członkostwa w jednej
  transakcji; dwa równoczesne callbacki = jedna firma, jeden owner. Bez migracji. Dowód: `rls.sql`
  sekcja CO28 (dblink, kontrola ujemna bez `FOR UPDATE` tworzy duplikat), `company-bootstrap-callback.test`.
  Stary formularz nie nadpisuje innej firmy (#801, bez migracji): `updateCompany`/
  `updateCompanyLinks` przyjmują `companyId` z formularza (wyrenderowanego dla KONKRETNEJ
  firmy), zamiast czytać aktywną firmę z cookie w chwili zapisu — wybór aktywnej firmy jest
  wspólny dla wszystkich kart, więc zmiana firmy w drugiej karcie po otwarciu formularza nie
  przekierowuje już zapisu do innego rekordu (`getCompanyMembershipFor` weryfikuje rolę
  owner/admin właśnie dla `companyId` z formularza). `CompanyForm`/`CompanyLinksForm` na
  `/employer/firma` dostają `companyId={company.id}` z RSC. Testy: `company-update`,
  `company-links-update` (przypadek dwóch kart), `company-links-form`.
- [x] Panel pracodawcy — realne dane pod sesją (RLS) + akcje (zmiana statusu aplikacji, wysyłka propozycji), noindex; fallback demo bez env
  Lejek (#302): kohorta aplikacji z 30 dni (`submitted_at`) liczona zapytaniami `count` (head,
  `!inner` na historii = jedna aplikacja raz); „Wyświetlenia” = suma `detail_views` z lejka ofert
  (#99), „brak danych” tylko bez uprawnień rekrutera — bez fałszywej konwersji 0%. Kafelki/lejek/kolumny zawijają się przy
  200% tekstu (#318). Przełącznik firmy: nazwa w etykiecie, `aria-current`, komunikat błędu (#322).
  Realne statystyki (audyt P1-14, bez migracji): liczniki rekrutacyjne (nowe zgłoszenia,
  dopasowani, do odpowiedzi, liczniki przy ofertach, lejek, top dopasowani) tylko dla recruiter+
  aktywnej firmy — zwykły `member` widzi „brak danych” (`null` → `StatValue`: „—” + tekst dla
  czytnika) i wyjaśnienie zamiast zer z RLS; lejek `denied`, top dopasowani `denied`/`unverified`/
  `error` (`getTopMatchedCandidatesLoad`). Dopasowani = DISTINCT kandydaci (nie wiersze `matches`),
  dopiero po weryfikacji firmy; „do odpowiedzi” = rozmowy AKTYWNEJ firmy, w których ostatnia
  nieusunięta wiadomość jest spoza firmy (dawniej nieprzeczytane powiadomienia użytkownika ze
  wszystkich firm). Wspólne `EmployerOverviewStats`/`EmployerFunnelSection` na pulpicie
  i `/employer/statystyki`. Dowód: `portal-employer` (PG16: member, firma niezweryfikowana, cudza
  firma, powiadomienia ≠ licznik), unit `employer-stats-load`, `employer-candidates-load`,
  `employer-offers-preview` (kontrole ujemne).
  Wygląd panelu i kreatora oferty = kalka prototypu „04 Ludzie i praca” (#5/#6): klasy w
  `src/components/dashboard/panel-styles.ts` (wspólne z adminem), sidebar `.side-item`, opis
  odstępstw w `docs/design/people-passport/README.md`.
  Pulpit: karty ofert w stylu paszportu (#171), jawny błąd najnowszych zgłoszeń z ponowieniem
  (#157), „Zobacz wszystkie” → `/employer/aplikacje` (#164); bramka axe 320/1280 px i 200% tekstu
  w 4 językach — `tests/e2e/employer-dashboard-a11y.spec.ts`.
  Granica błędu i 404 wewnątrz panelu (bez migracji): `src/app/[locale]/employer/error.tsx`
  (`EmployerPanelError`) i `not-found.tsx` (`EmployerNotFound`) leżą POD layoutem `/employer`,
  więc nieobsłużony błąd strony albo `notFound()` (szczegół zgłoszenia #300, edycja oferty) nie
  zastępuje już całego panelu publiczną stroną błędu/404 — sidebar, przełącznik firmy i dolny
  pasek zostają. Błąd: komunikat z i18n (`dashboard.employerPanelError*`, Invariant #8), do
  kanału błędów sam kod (`captureError`), „Spróbuj ponownie” = `router.refresh()` + `reset()`
  (`useErrorRetry`), link do pulpitu. 404: status 404, podpowiedź o aktywnej firmie
  (multi-company, bez ujawniania istnienia obiektu), linki do pulpitu/zgłoszeń/ofert, bez
  drugiego `<main>`. Testy: unit `employer-panel-boundaries` (4 języki, bez treści wyjątku,
  kontrola ujemna linków publicznych), E2E `employer-application-detail` (404 z sidebarem,
  4 języki).
  Lejek ofert bez śledzenia (#99, migracja `0089`): `job_funnel_daily` = oferta × dzień (Europe/Brussels)
  × `search_appearances`/`detail_views`/`apply_started`; brak IP, cookies, tekstu wyszukiwania,
  identyfikatora osoby. `applications_submitted` liczy przy odczycie `get_company_job_funnel` ze stanu
  `applications` (status ≠ draft) — deterministyczne. Strony ofert zostają ISR: wyspa
  `JobFunnelBeacon` po załadowaniu (widoczna strona, `credentials: 'omit'`) woła `/api/job-funnel`
  (`src/lib/job-funnel/*`: walidacja, reguła botów/prefetch `request-filter.ts`, limiter w pamięci
  po HMAC adresu). Deduplikacja: losowy nonce jednego załadowania widoku (`job_funnel_receipts`,
  ≤ 48 h, #575) — retry nie dubluje, odświeżenie = nowe wyświetlenie. RPC zapisu tylko przez
  endpoint (bramka `pracujbe.funnel_writer`), tylko oferty publiczne firm `verified`. Panel
  `/employer/statystyki?dni=7|30|90`: zakres dat, definicje metryk, karty per oferta zawijane przy 200% tekstu (recruiter+).
  Dowód: `rls.sql` sekcja FN99, unit `job-funnel*`, E2E `public-cache-headers` (cache nienaruszony)
  i `e2e-real` (licznik rośnie, bot pominięty, mutacja `funnel-no-dedup` = czerwony).
  Klucz limitera (#646): adres wyłącznie z `trustedClientIp` (`@/lib/http/trusted-ip`), nigdy
  z `X-Forwarded-For` — klient nie omija limitu, zmieniając ten nagłówek przy każdym żądaniu.
  Tylko po zgodzie (#575, decyzja właściciela 25.09, migracja `0128` — numer tymczasowy): lejek
  wysyła zdarzenie WYŁĄCZNIE przy zgodzie w kategorii `analytics` banera (`funnelConsentState`
  w `src/lib/job-funnel/client.ts`, cookie czytane tuż przed wysyłką — działa też po wycofaniu
  w innej karcie i po restarcie). Wyświetlenie sprzed decyzji czeka w pamięci karty i wychodzi
  po zgodzie; odmowa/wycofanie czyści kolejkę, zmiana strony ją anuluje; `apply_started` bez
  zgody nie jest kolejkowane. Terminy absolutne: `purge_job_funnel_data` w `/api/maintenance` —
  receipts ≤ 48 h, agregaty = bieżący + 12 poprzednich miesięcy kalendarzowych (Europe/Brussels).
  Panel statystyk: informacja `jobFunnel.consentNote` (dane tylko od osób ze zgodą). Dowód:
  unit `job-funnel-consent` (kontrola ujemna bez bramki), `job-funnel-retention`, `rls.sql`
  sekcja FC575, E2E `job-funnel-no-storage` (4 języki: przed decyzją, po odmowie, po wycofaniu
  w tej i drugiej karcie, zmiana strony, restart = zero żądań). E2E `e2e-real` (licznik) wymaga
  teraz zgody w teście.
  Tryb ogłoszeniowy (#1147, decyzja produktowa: portal ogłoszeniowy, bez migracji): statystyki
  pracodawcy = statystyki ogłoszenia. `getEmployerOverview` zwraca aktywne oferty +
  `listingDetailViews`/`listingApplyClicks` (lejek ofert, 30 dni; member = „brak danych”) bez
  zapytań o `applications`/`matches`/`conversations`/`messages`; `getFunnelStats` → `disabled`
  bez zapytań (pulpit: w miejscu lejka rekrutacyjnego odnośnik „Statystyki ogłoszeń”, strona
  `/employer/statystyki` go nie woła); `getJobFunnel` i CSV bez `applicationsSubmitted` (kolumnę
  RPC 0089 loader pomija), `apply_started` = „Kliknięcia »Aplikuj u pracodawcy«” (nowe etykiety
  `jobFunnel.applyClicks*`, `consentNoteListing`). Tryb `RECRUITMENT` bez zmian. Dowód: unit
  `classifieds-employer-stats` (kontrole ujemne obu trybów), E2E `classifieds-employer-stats`
  (`E2E_PORTAL_LEGAL_MODE=`, axe 320/1280 px). Karty ofert (`getCompanyJobsLoad`, pulpit
  i `/employer/oferty`) w trybie bez licznika zgłoszeń i bez podzapytania do `applications`.
  Eksport CSV lejka (bez migracji): „Pobierz CSV” w sekcji lejka `/employer/statystyki` →
  `GET /api/employer/job-funnel?dni=7|30|90&locale=` — te same dane co strona (`getJobFunnel`
  pod sesją/RLS, recruiter+ aktywnej firmy wg `get_company_job_funnel`), kolumny od/do, oferta,
  status (etykieta `status.*`), cztery liczniki + wiersz sumy, nagłówki w języku panelu
  (`jobFunnel.csv*`), liczby surowe, formuły w tytułach neutralizowane (`csvCell`), BOM + CRLF,
  plik `job-funnel-<od>_<do>.csv` (`src/lib/job-funnel/csv.ts`). Demo = 404 i brak przycisku,
  bez sesji 401, `member`/bez firmy 403, awaria 500 bez treści, `private, no-store`. Test
  `job-funnel-csv` (kontrola ujemna formuły), `job-funnel-stats` (przycisk tylko z adresem).
- [x] Kreator oferty (9 kroków, autozapis draftu, publikacja z kontrolą `verified`) — `src/lib/actions/jobs.ts` + `JobWizard`
  Krok 9: „Zapisz i wyjdź” zapisuje szkic bez zgody na publikację (`step9DraftSchema`, także
  w `updateJobDraft`); zgodę wymaga tylko „Opublikuj” (`step9Schema`) (#193). Pozycje list mają
  limity `JOB_ITEM_LIMITS` równe obcięciom w RPC relacji (test porównuje z migracjami) — za długa
  pozycja nie trafia na listę (#364, część kreatora). Błędy pól: `aria-invalid` + `aria-describedby`
  + fokus na pierwszym błędzie; puste pole → komunikat „wymagane” (#160, #367 część kreatora).
  Po „Dalej”/„Wstecz” fokus na nagłówku nowego kroku + ogłoszenie „Krok N z 9”, jeden region
  statusu zapisu (#402). Błąd zapisu pokazuje komunikat z kodu serwera (`toUserMessageKey`);
  `JOB_NOT_DRAFT` → link do listy ofert zamiast ponawiania (#363).
  Zapis kroku (#192, migracja `0083`): `updateJobDraft` woła jedno RPC `save_job_draft`
  (kolumny `jobs` z listy dozwolonych + tłumaczenie + relacje replace-all w jednej transakcji,
  tylko szkic, recruiter+) — błąd w części kroku nie zostawia częściowego zapisu. Treść kroku
  buduje `src/lib/job-draft-content.ts`. Dowód: `rls.sql` sekcja WZ192.
  Edycja w trakcie zapisu (#829, bez migracji): pola zostają edytowalne, a akcja dostaje
  snapshot z chwili kliknięcia — po sukcesie `persistStep` porównuje go z bieżącymi danymi
  kroku (`stepDataChanged`) i nowszą wartość waliduje i zapisuje ponownie (najwyżej 3 rundy),
  zanim „Dalej” zmieni krok albo „Zapisz i wyjdź” wyjdzie; niepoprawna nowsza wartość = błąd
  przy polu, bez wyjścia. Tryb edycji opublikowanej oferty po takim zapisie nie pokazuje
  „Zapisano” (ponowne „Zapisz zmiany” z nową wersją). Test: `job-wizard-save-revision`
  (kontrola ujemna: bez poprawki 5 z 7 czerwonych).
  Token wersji szkicu (#1070, migracja `0184` — numer tymczasowy): `save_job_draft(job, content,
  p_expected_updated_at default null)` zwraca `{updated_at}` (nowa wersja szkicu) i przy starej
  wersji rzuca `JOB_EDIT_CONFLICT` bez żadnej zmiany (kolumny, tłumaczenie, relacje, pytania)
  — jak `update_published_job` (0077); kontrola po `FOR UPDATE` i po sprawdzeniu `JOB_NOT_DRAFT`,
  więc równoległe zapisy z tym samym tokenem: wygrywa pierwszy. Każdy udany zapis podbija
  `jobs.updated_at` (także krok tylko z relacjami; `strict_job_version` 0077 = ścisły wzrost).
  Ciało funkcji = 0172 + kontrola wersji; zmiana typu wyniku wymagała `drop function` starej
  sygnatury (wywołania dwuargumentowe działają dzięki wartości domyślnej). `updateJobDraft(…,
  expectedVersion?)` zwraca `version`; loader szkicu podaje `updatedAt`, a `JobWizard` (prop
  `draftVersion`, ref z wersją z ostatniej odpowiedzi — także w pętli #829) odsyła ją przy
  kolejnym zapisie. Świeży szkic tej karty i import zaczynają bez tokenu (pierwsza odpowiedź niesie
  wersję). Konflikt: komunikat `jobWizard.draftConflict` + link `jobWizard.reloadDraft` (pełne
  przeładowanie `/employer/oferty/<id>/edycja`) w 4 językach; zapisu nie ponawiamy. Krok bez zmian
  od ostatniego udanego zapisu w tej karcie nie wysyła żądania (publikacja zawsze zapisuje).
  Dowód: `rls.sql` sekcja DC1070 (kontrole ujemne: stara wersja, równoległe sesje przez dblink,
  krok tylko z relacjami), rollback `supabase/rollback/0184_…down.sql` + `job-draft-cas-rollback.sql`,
  integracja `portal-employer-actions`, unit `job-wizard-draft-version`. **Otwarte:** wersja
  szkicu po imporcie (pierwszy zapis bez kontroli), szkic wczytany i niezmieniony wysyła zapis
  przy pierwszym „Dalej” (brak migawki z bazy).
  Wznowienie od zapisanego kroku (#834, migracja `0216` — numer tymczasowy): `jobs.draft_step`
  (smallint 1–9, CHECK `jobs_draft_step_range`, null = start od kroku 1 — stare szkice, import,
  kopia szkicu) = najdalszy krok kreatora z udanym zapisem. `updateJobDraft` dokłada do treści
  `draft_step = krok`, a `save_job_draft` (definicja z 0194 + ten klucz) podnosi go `greatest`
  w tej samej transakcji co treść (powrót do wcześniejszego kroku nie cofa postępu; wartość spoza
  1–9 = `VALIDATION_FAILED` bez zapisu; zapis bez klucza nie zmienia postępu). `getJobDraft` →
  `resumeStep` (tylko szkic), strona edycji → `JobWizard initialStep` (`resumeWizardStep`; tryb
  edycji opublikowanej oferty zawsze od kroku 1). Samo wznowienie i „Wstecz” niczego nie
  zapisują. Dowód: `rls.sql` sekcja DS834 (kontrola ujemna: funkcja z 0194 pomija klucz),
  rollback `supabase/rollback/0216_…down.sql` + `job-draft-step-rollback.sql`, unit
  `job-wizard-resume-step` (kontrole ujemne), `save-job-draft-step`.
  Podgląd wynagrodzenia w kroku 9 (#1224, bez migracji): `normalizeSalary`/`formatSalaryRange`
  z etykietami `jobs.passport.*` (jak karta i szczegół) zamiast surowych pól formularza — „do 3000 €
  brutto / mies.”, waluta i separatory wg locale. Test `job-wizard-salary-preview` (kontrola ujemna).
  Flaga „bez wymogu języka” kontra wymagane języki (#910, bez migracji): pole `noLanguageRequired`
  i lista `languages` w kroku 7 wykluczają się nawzajem — zapisane niezależnie dawały sprzeczny
  wynik dla kandydata (filtr „bez języka” czyta tylko flagę, dopasowanie tylko listę). `JobWizard`
  czyści listę języków po zaznaczeniu flagi i odznacza flagę po dodaniu języka; `step7Schema` i pełny
  `jobSchema` (`src/lib/validation/job.ts`, `refineNoLanguageConflict`) odrzucają oba pola naraz
  błędem przy polu `languages` (`job.error.noLanguageConflict`, PL/NL/FR/EN) — obejmuje zarówno
  zapis kroku (`updateJobDraft`/`save_job_draft`), jak i edycję opublikowanej oferty
  (`updatePublishedJob`, każdy krok tym samym schematem). Istniejące rekordy z fixture testowej
  (`warehouse-rich`) nie są migrowane — poprawka zamyka tylko zapis nowych/edytowanych ofert.
  Testy: `job-validation-draft-limits.test.ts` (kontrola ujemna: flaga + niepusta lista odrzucone
  w obu schematach), `update-published-job.test.ts` (fixture bez sprzecznego stanu).
- [x] Zaufanie ofert (migracja `0167`): **sygnały oszustwa** w treści oferty
  przed publikacją — deterministyczne reguły PL/NL/FR/EN bez AI (`job_fraud_patterns`, lustro
  `src/lib/job-trust/fraud-risk.ts`, test `job-fraud-risk` 1:1): opłata od kandydata (praca,
  szkolenie, dokumenty, zakwaterowanie z góry), kontakt przez komunikator, kryptowaluty/„zadania
  online”, przelew/dane karty. Migawka treści (`job_trust_content`: tytuł, godziny, tłumaczenia,
  wymagania) + odcisk md5; odroczone triggery po zapisie kroku/rewizji zakładają przegląd
  `job_content_reviews` (pending → approved/rejected), aktywną ofertę z nowym sygnałem baza
  wstrzymuje (`paused`, audyt `job.paused_for_content_review`), strażnik
  `enforce_job_content_review` blokuje każdą aktywację do akceptacji bieżącej treści
  (`JOB_CONTENT_REVIEW_REQUIRED`/`JOB_CONTENT_REJECTED` → komunikat i uzasadnienie w kreatorze).
  Drugi sygnał AI (decyzja właściciela 28.09): `src/lib/job-trust/ai-check.ts`, `gpt-6-luna` za flagą
  `AI_JOB_FRAUD_CHECK_ENABLED` (atrapa `AI_JOB_FRAUD_CHECK_PROVIDER=fixture` poza produkcją),
  `withAiBudget` + log użycia bez treści, minimalizacja `redactSensitiveData`, treść jako dane
  w `<offer_text>`, strict schema; trafienie tylko kieruje do kolejki (`record_job_content_ai_signal`,
  service_role, odcisk jak CAS), awaria/brak budżetu = same reguły; inwentarz `job_fraud_check`.
  Przy publikacji model woła się dopiero, gdy `publish_job` może się udać (`canAttemptPublish` pod RLS:
  recruiter+, szkic, firma `verified`, termin, kanał — #1235; member/oferta aktywna = bez kosztu AI).
  Podpowiedź w kreatorze (kroki 5, 6, 8), kolejka admina `/admin/tresc-ofert` (źródło reguła/AI,
  uzasadnienie i pewność AI, treść z chwili zgłoszenia, `admin_decide_job_content_review` z CAS
  treści, audytem i powiadomieniem). **Agencje pracy tymczasowej** (decyzja właściciela 28.09):
  `companies.is_agency` + numer uznania regionalnego (tekst ≤ 64) w `/employer/firma`
  (`set_company_agency`, owner/admin, zmiana zeruje sprawdzenie), ręczne sprawdzenie admina
  w `/admin/firmy/[id]` (`admin_record_agency_check`, CAS po numerze), strażnik kolumn
  `guard_company_agency`; etykieta „agencja” na karcie, szczególe i profilu firmy
  (`get_public_jobs_agency`, bez wyniku sprawdzenia), filtr „bezpośrednio od pracodawcy”
  (`?direct=1`, `p_direct_only` w liście, liczniku, facetach i kopii filtrów alertów). Dowód:
  `rls.sql` sekcja FT167 (kontrole ujemne: bez strażnika publikacja przechodzi, bez warunku filtr
  przepuszcza agencję), unit `job-fraud-risk`, `job-trust`; E2E `offer-trust` (demo).
  Kolejka „oczekujące” filtruje bieżącą treść w SQL przed limitem (#1220, bez migracji) —
  nieaktualne przeglądy (każdy zapis innej treści z sygnałem) nie zajmują stron; integracja
  `portal-admin-job-content-queue` (PG16, kontrola ujemna: stary odczyt = strona nieaktualnych).
  **Otwarte (etap 2):** filtr w zapisanych wyszukiwaniach, sygnały w wiadomościach, etykieta
  na kartach polecanych w panelu kandydata, brzmienia (właściciel), katalog reguł/wyjątków.
  Kanał aplikowania u ogłoszeniodawcy (#1129, migracja `0172`; decyzja
  produktowa: portal ogłoszeniowy): `jobs.apply_url` (https, reguła jak `public_https_url` + port
  1–65535) / `apply_email` (bez parametrów `mailto:`) / `apply_phone` (`+` i 8–15 cyfr) z CHECK-ami
  (`job_apply_*_ok`), dowolna kombinacja, co najmniej jeden wymagany przez `publish_job`
  i `update_published_job` → `JOB_APPLY_CHANNEL_REQUIRED` (także poza trybem ogłoszeniowym —
  flaga #1136 nie istnieje jeszcze w bazie). Szkic bez kanału dozwolony (`save_job_draft`),
  kopia szkicu przenosi kanał (trigger na `job_duplications`), `get_public_job` zwraca trzy pola
  tylko dla oferty publicznej (`JobDetail.applyChannel`, drugie sprawdzenie lustrem). Kreator:
  pola w kroku 9 (błąd przy „Opublikuj” i w edycji przy polu strony, fokus), lustro
  `src/lib/job-apply-channel.ts` (telefon normalizowany: spacje/kropki/myślniki, `00` → `+`),
  `contact_email` zostaje kontaktem niepublicznym; import AI kanału nie wypełnia. Demo/seed:
  kanały w domenie `example.com`. Dowód: `rls.sql` sekcja AC172 (kontrole ujemne: bez CHECK,
  `publish_job` bez sprawdzenia), unit `job-apply-channel` (TS = wzorce z migracji), E2E
  `job-wizard-step9-draft`. **Otwarte:** kanał w regułach zaufania treści (0167).
  „Aplikuj u pracodawcy” na szczególe (#1130, bez migracji): w trybie ogłoszeniowym
  (`isRecruitmentEnabled('applications')` = false) zamiast `ApplyModal` wyspa
  `EmployerApplyChannel` — przycisk główny = pierwszy kanał (strona https w nowej karcie,
  `rel="noopener noreferrer nofollow"` → `mailto:` z tematem → `tel:`), w ramce pozostałe kanały;
  linki wyłącznie z `buildApplyLinks` (`src/lib/job-apply-links.ts`, trzecie sprawdzenie reguł);
  ramka widoczna też na mobile, pasek mobilny = sam przycisk główny; bez „Wyślij wiadomość”,
  podpis kontaktu `job.employerApply.contact`, JobPosting `directApply: false`. Oferta bez kanału
  = brak przycisku i neutralny komunikat `job.employerApply.none`. Kliknięcie = `apply_started`
  tylko po zgodzie analitycznej (demo nie liczone); komponent serwerowy, kliknięcia liczy istniejąca
  wyspa `JobFunnelBeacon` (`applyClicks`), a `JobMatchCard` (tylko RECRUITMENT) idzie osobnym
  chunkiem (`JobMatchCardLazy`, `ssr: false`) — budżet JS szczegółu oferty (#395) bez podnoszenia
  limitu. Tryb `RECRUITMENT` bez zmian (`ApplyModal`).
  Dowód: unit `employer-apply-channel` (kontrole ujemne: schematy, zgoda), strażnik
  `tests/legal/classifieds-only.test.ts` (ApplyModal/„Wyślij wiadomość” tylko w gałęzi
  `recruitment`, kontrola ujemna), E2E `job-detail-employer-apply` (4 języki, axe 320/1280 px;
  uruchamiany z `E2E_PORTAL_LEGAL_MODE=`). Helper Vitest: `withRecruitmentMode`/`withClassifiedsMode`.
  Język ogłoszenia, szkice i data rozpoczęcia (#1048, #1099, #1112, bez migracji): krok 1
  ma pole „Język ogłoszenia” (domyślnie język panelu lub zapisany w szkicu; w edycji opublikowanej
  oferty zablokowane). Zmiana w szkicu: krok 1 niesie `contentLocale` → `setDraftContentLocale`
  (`src/lib/actions/jobs.ts`) w jednej transakcji ustawia `jobs.default_locale` i przenosi
  `job_translations`/`job_requirements` do nowego języka (bez tego `save_job_draft` zostawiłby
  osierocony komplet); `createJobDraft` tworzy szkic od razu w wybranym języku. Tworzenie szkicu
  jest idempotentne po kluczu operacji z przeglądarki (`draft-<uuid>` jako slug, `ON CONFLICT`):
  ponowienie po utraconej odpowiedzi zwraca ten sam szkic. „Usuń szkic” na `/employer/oferty`
  (`deleteJobDraft`, miękkie usunięcie, tylko `draft`, recruiter+, `ConfirmDialog`). Poprawka
  opublikowanej oferty rewaliduje też stronę główną i landingi (`revalidatePublicJobPaths`).
  Szczegół oferty pokazuje „Praca od zaraz” i datę rozpoczęcia (`src/lib/job-start.ts`, komponent
  serwerowy, bez JS). Combobox poziomu języka w kroku 7 ma nazwę (`jobWizard.languageLevelAria`).
  Dowód: unit `job-wizard-content-locale`, `job-detail-start`, `job-start`, `delete-job-draft-button`,
  integracja `portal-employer-actions` (kontrole ujemne: sama zmiana kolumny zostawia dwa języki,
  inny klucz = nowy szkic). Tytuł bez heurystyki zaślepki (#1221, migracja `0203` — numer
  tymczasowy): `publish_job`, `update_published_job` i `set_job_status('reopen')` odrzucają już
  tylko pusty tytuł (dawny warunek „draft%/placeholder” z 0031 blokował np. „Draftsman”); dowód
  `rls.sql` sekcja BZ1221 (kontrole ujemne: definicje sprzed 0203), rollback
  `0203_…down.sql` (`job-title-completeness-rollback.sql`). **Otwarte (wymaga migracji):**
  screening-pytania nie są przenoszone
  przy zmianie języka szkicu (funkcja wyłączona w trybie ogłoszeniowym). Menu statusu zgłoszenia
  i „Wyślij propozycję” w demo — funkcje wyłączone w trybie ogłoszeniowym (nie dotyczy).
  Import AI proponuje język treści wykryty w źródle (#1048, bez migracji): pole `sourceLanguage`
  structured output (kod ISO 639-1) → `importContentLocale` (`src/lib/ai-import/map.ts`: tylko
  podstawowy podznacznik z dwóch liter, `nl-BE` → `nl`; nazwa języka, `de` i śmieci → `null`)
  → szkic tworzony w tym języku (`createJobDraft(contentLocale)`), wynik akcji niesie
  `contentLocale`/`contentLocaleDetected`, kreator startuje z nim w polu „Język ogłoszenia”, panel
  importu pokazuje `jobImport.detectedLanguage`; brak/język spoza serwisu = język panelu. Dowód:
  unit `ai-import-map`, `job-import-action`, `job-import-panel` (kontrole ujemne), E2E `job-import`.
- [x] Edycja opublikowanej oferty (#325, migracja `0077`): „Edytuj” na liście ofert dla
  aktywnej/wstrzymanej oferty otwiera kreator w trybie edycji — kroki tylko walidowane, „Zapisz
  zmiany” wysyła całość jednym RPC `update_published_job` (recruiter+, firma `verified`,
  kompletność jak `publish_job`, CAS po `updated_at` → `JOB_EDIT_CONFLICT`, audyt). Status, slug,
  `published_at` i zgłoszenia bez zmian; zamknięta/wygasła → najpierw „Otwórz ponownie”
  (`JOB_NOT_EDITABLE`). Baza blokuje bezpośredni zapis treści i relacji oferty innej niż szkic
  (strażniki + `set_job_*` tylko dla szkicu). „Zobacz ofertę” dla aktywnej. Dowód: `rls.sql`
  sekcja RR.
  Powiadomienie o zmianie warunków (migracja `0144`): gdy `update_published_job` zmienia
  wynagrodzenie (kwoty, okres, waluta), miasto (porównanie przez `search_fold`), typ umowy albo
  godziny pracy — lista pól w jednym miejscu, `job_material_terms(jobs)` — trigger AFTER UPDATE
  na `jobs` tworzy powiadomienie in-app. Trigger reaguje WYŁĄCZNIE na zapis z tego RPC (lokalny
  znacznik `pracujbe.job_terms_notify` = id oferty, ustawiany tuż przed UPDATE i czyszczony po
  nim; bezpośredni UPDATE service_role/migracji i zmiany statusu nie powiadamiają); ta sama
  transakcja, odrzucona rewizja nie zostawia powiadomienia. Odbiorcy: kandydaci z AKTYWNĄ
  aplikacją (submitted/viewed/shortlisted/interview/offer_sent/offer_accepted; bez gości, szkiców
  i stanów końcowych; preferencja `in_app_enabled` jak zawsze). `system`, `entity_type=
  'job_terms'`, `data` = rodzaj, slug, nazwy pól (bez kwot). Tytuł
  `notifications.itemJobTermsChanged` w języku panelu odbiorcy (Invariant #1), link do
  `/candidate/aplikacje` (oferta wstrzymana/zamknięta/wygasła nie ma publicznej strony). Bez
  e-maila (bezpieczny wariant). Dowód: `rls.sql` sekcja JT144 (kontrole ujemne: pole spoza listy,
  brak filtra stanu aplikacji, bramka znacznika, surowe porównanie miasta), unit
  `job-terms-notification`.
  **Otwarte (decyzja produktowa):** e-mail o zmianie warunków, wskazanie w powiadomieniu, co się
  zmieniło.
  Kontekst zaufanej edycji (#753/#752/#750, migracja `0200` — numer tymczasowy): znaczniki GUC
  `pracujbe.job_edit`/`pracujbe.job_terms_notify` klient mógł ustawić sam (`set_config`) i
  wywołać `set_job_*` dla opublikowanej oferty albo wywołać powiadomienie bezpośrednim UPDATE.
  Teraz `update_published_job` wstawia wiersz do `job_operation_context` (transakcja, oferta,
  rodzaj; RLS, bez grantów dla klientów i service_role), `assert_job_draft_or_editing` i trigger
  powiadomień czytają tylko ten wiersz (trigger go zużywa — jedna rewizja = jedno powiadomienie).
  Audyt `job.update_published` = `job_edit_audit_snapshot(jobs)` (dotychczasowe pola + godziny,
  zmiany, okres stawki, waluta, koszt zakwaterowania + `terms` = `job_material_terms`). Dowód:
  `rls.sql` RR5g–RR5n, JT7b–JT7n, JT10–JT10n (kontrole ujemne: strażnik z GUC, migawka z 0172),
  rollback `0200_…down.sql` (`job-edit-context-rollback.sql`).
- [x] Kopiuj jako szkic (migracja `0148`): przycisk „Kopiuj jako szkic” przy
  każdej ofercie listy `/employer/oferty` (dowolny status, recruiter+; `DuplicateJobButton`,
  klucz UUID operacji w `useRef` — podwójne kliknięcie/ponowienie po błędzie sieci = ten sam
  szkic) → akcja `duplicateJobAsDraft` (oferta aktywnej firmy, limiter `job-draft`) → jedno RPC
  `duplicate_job_as_draft(job, client_key)` → kreator nowego szkicu (`/employer/oferty/<id>/edycja`;
  demo = pusty kreator). Kopiowane: kolumny `jobs` z listy dozwolonych `save_job_draft` +
  `default_locale`/`is_demo`, tłumaczenie w języku oferty (bez `meta_*` i innych języków),
  wymagania, umiejętności, języki, certyfikaty, pytania screeningowe — BEZ decyzji
  `screening_question_reviews` (trigger 0103 zgłasza nowy przegląd dla nowej oferty). Nie
  kopiuje: statusu, slugu, `published_at`, `expires_at`, zgłoszeń, liczników, lejka, blokady
  moderacyjnej. Idempotencja: blokada doradcza + `job_duplications` (unikat konto + klucz,
  RPC-only; ten sam klucz dla innej oferty = `VALIDATION_FAILED`). Cudza firma = `NOT_FOUND`,
  member = `PERMISSION_DENIED`, firma zawieszona (status albo blokada) = `COMPANY_SUSPENDED`
  (`errors.companySuspended`), oferta z decyzją moderacyjną = `MODERATION_LOCKED`
  (`dashboard.duplicateJobModerationLocked`); audyt `job.duplicated`. Dowód: `rls.sql` sekcja
  JD216 (kontrole ujemne: bramka recruiter+, wpis klucza), unit `job-duplicate-draft`, E2E
  `employer-job-duplicate` (demo, 4 języki, axe 320 px).
- [~] „Koszty i dodatki” w ofercie (migracja `0169`): krok 8 kreatora ma
  opcjonalne pola deklarowane przez pracodawcę — zakwaterowanie (zapewnione / pomoc / brak; przy
  „zapewnione”: koszt EUR za tydzień lub miesiąc, 0 = bez kosztów, potrącenie z pensji,
  zameldowanie, co po końcu umowy), dojazd (dowóz, zwrot kosztów), bony żywieniowe (EUR/dzień),
  komisja parytetowa ze słownika `joint_committees` (lustro `src/lib/joint-committees.ts`, test
  zgodności). Flagi filtrów `accommodation`/`transport` wynikają ze szczegółów (CHECK-i w bazie,
  `jobCostsPatch` w `src/lib/job-costs.ts`); stare oferty (same flagi) bez zmian. Zapis:
  `save_job_draft` i `update_published_job` (nowe klucze), kopia szkicu przez trigger na
  `job_duplications`; `job_material_terms` + `accommodation` (rodzaj, koszt, okres, potrącenie) —
  zmiana kosztu zakwaterowania powiadamia kandydatów z aktywną aplikacją jak 0144. Szczegół
  oferty: sekcja „Koszty i dodatki” (`get_public_job_costs`, odczyt pomocniczy — awaria = same
  flagi) z linkiem do oficjalnej bazy stawek minimalnych FOD WASO/SPF ETCS, bez oceny stawki;
  JobPosting `jobBenefits` (komisja bez odpowiednika w schema.org). Dowód: `rls.sql` sekcja CB169
  (kontrola ujemna: lista pól z 0144 nie widzi kosztu), unit `job-costs`, `jobs-postgres`, E2E
  `job-costs` (4 języki, axe). Zakwaterowanie zapewnione (decyzja właściciela 28.09.2026): oferta
  publiczna MUSI podać koszt (0 = bez kosztów) i czy jest potrącany z pensji; szkic może być
  niekompletny. Kreator: `step8PublishSchema` przy „Opublikuj” (powrót do kroku 8, błąd przy polu,
  `jobWizard.publishFixStep`) i w edycji opublikowanej oferty; `updatePublishedJob` odrzuca przed
  RPC. Baza: strażnik BEFORE `enforce_job_accommodation_terms` na `jobs` (wejście w active/paused
  albo zmiana pól zakwaterowania — `publish_job`, `update_published_job`, `set_job_status`
  resume/reopen, bezpośredni DML) → `JOB_ACCOMMODATION_TERMS_REQUIRED` → `errors.jobAccommodationTermsRequired`.
  Dowód: `rls.sql` CB10 (kontrola ujemna CB10n bez strażnika), unit `job-costs`,
  `update-published-job`, E2E `job-costs`. **Otwarte (właściciel):** filtry listy po nowych
  polach, tabela stawek komisji.
- [x] Status weryfikacji firmy w panelu (#399/#400/#365/#368/#401, migracja `0072`): baner statusu
  na pulpicie (checklista „Pierwsze kroki”) i nad kreatorem (szkic teraz, publikacja po
  weryfikacji); zweryfikowana firma bez baneru. Odrzucona firma: „Wyślij ponownie do weryfikacji”
  (`request_company_reverification`, rejected→pending, owner/admin, audyt). Zmiana nazwy/VAT
  zweryfikowanej firmy wraca do `pending` (trigger `protect_company_verification`) z komunikatem
  w formularzu. Pracodawca bez firmy widzi w panelu formularz zakładania firmy
  (`create_first_company`: firma + VAT + owner w jednej transakcji, idempotentnie), a
  `/rejestracja-pracodawca` z sesją pracodawcy → panel. Chrome panelu: `getEmployerShellData`
  zwraca `demo`/`ok`/`error`; firma demonstracyjna tylko w trybie demo. Dowód: `rls.sql` sekcja MM.
  Powód odrzucenia/zawieszenia (#310, `0084`): `companies.status_reason` w banerze `/employer/firma`.
  Czas weryfikacji (decyzja właściciela 26.09.2026): baner dla `unverified`/`pending` we wszystkich
  wariantach (pulpit, kreator, `/employer/firma`) dodaje `company.bannerEta` („Zwykle do 2 dni
  roboczych”) — bez innych obietnic; test `company-status-banner-reason` (kontrola ujemna).
  Link decyzji dotyczy TEJ firmy, nie aktywnej z cookie (#843): CTA e-maila
  (`companyVerified`/`companyRejected`/`companySuspended`) i link powiadomienia in-app (ten sam
  `entity_type='company'` niosą też powiadomienia moderacyjne #42) mają `?firma=<id>` z
  `entity_id` zdarzenia (`emailTargetPath`/`resolveHref`). Właściciel kilku firm z inną AKTYWNĄ
  firmą w cookie widzi `/employer/firma` z danymi WŁAŚCIWEJ firmy (`getCompanyById` — odczyt po
  identyfikatorze, niezależny od `pb_active_company`) w osobnym, read-only widoku +
  `SwitchToCompanyButton` (jawne przełączenie aktywnej firmy, `setActiveCompany`); brak/utracone
  członkostwo → jawny stan „firma niedostępna”, nigdy ciche podstawienie innej firmy. Bez
  migracji (`entity_id`/`related_id` już niosły identyfikator firmy od 0084/0099). Dowód: unit
  `company-load` (`getCompanyById`), `admin-company-review` (CTA z `?firma=`), `notifications-links`,
  `switch-to-company-button`; E2E `employer-company-target-notice`.
- [x] Import ogłoszenia przez AI (#465, za flagą, domyślnie wyłączony): krok „Zaimportuj
  z ogłoszenia” nad kreatorem nowej oferty — zrzut ekranu (PNG/JPG/WebP ≤ 5 MB, magic bytes)
  albo link (pobranie serwerowe odporne na SSRF: `src/lib/ai-import/safe-fetch.ts`). Model
  OpenAI (`gpt-6-luna`, strict structured output, `src/lib/ai-import/extract.ts`) → mapowanie tymi samymi
  schematami kroków (`map.ts`), pola niepewne na liście „do sprawdzenia” w kroku; poprawne kroki
  do szkicu jednym `save_job_draft`, nigdy publikacja. Akcja `importJobListing`: recruiter+
  aktywnej firmy, limit per firma 10/h i 30/dobę (fail-closed). Podejrzenie prompt injection =
  wszystko do sprawdzenia, bez zapisu. Env: `AI_JOB_IMPORT_ENABLED`, `OPENAI_API_KEY`,
  opcjonalnie `AI_JOB_IMPORT_MODEL`/`AI_MODEL`; atrapa `AI_JOB_IMPORT_PROVIDER=fixture` tylko poza
  produkcją (E2E `job-import.spec`). Research, koszty, prywatność: `docs/AI_JOB_IMPORT.md`.
  Dostawca AI (decyzja właściciela 2026-09-26): wyłącznie OpenAI „GPT-6 Luna” (`gpt-6-luna`,
  0,10/0,50 USD za 1 mln tokenów wejścia/wyjścia) — jeden klient `src/lib/ai/openai.ts`
  (Responses API, `strict` JSON Schema, `store: false`, timeout 60 s, bez logowania treści),
  model z `src/lib/ai/model-config.ts` (`AI_*_MODEL` → `AI_MODEL` → `gpt-6-luna`), klucz
  `OPENAI_API_KEY` tylko na serwerze; SDK Anthropic usunięte. Strażnik `ai-inventory`: SDK
  `openai` importuje tylko ten plik, import klienta = wywołanie modelu, `@anthropic-ai/*`
  w `src/`/`scripts/` = czerwony (kontrole ujemne); test `ai-openai-client`.
  Globalny budżet AI (#36, migracja `0120`, `docs/AI_BUDGET.md`): każde wywołanie modelu przez
  `withAiBudget` (`src/lib/ai/budget.ts`) — rezerwacja górnej granicy kosztu PRZED API
  (`ai_budget_reserve`, blokada doradcza, limit doby i miesiąca w Europe/Brussels), rozliczenie
  tokenami z `usage` (`ai_budget_settle`; bez `usage` = pełna rezerwacja). Fail-closed: limit
  przekroczony/0/brak, brak bazy zadań albo błąd = brak wywołania, `AI_BUDGET_EXCEEDED`. Limity
  startowe 10 USD/dobę i 100 USD/miesiąc (`ai_budget_limits`, zmiana tylko w bazie). Rejestr
  `ai_usage_ledger` bez treści i identyfikatorów osób/firm. Raport tylko do odczytu
  `/admin/koszty-ai`; czujki `ai_budget_*` w `/api/health/ops`. Strażnik: funkcja `behind_flag`
  w inwentarzu musi mieć `costBudgeted: true` — import ogłoszeń, asystent treści, import CV
  (#487, `src/lib/cv-import/cost.ts`) i tłumaczenia (#514, `estimateTranslationCost`). Dowód: `rls.sql` sekcja AIB36 (kontrola ujemna), unit `ai-budget`,
  `ai-budget-report`. **Otwarte:** DPA/retencja dostawcy (decyzja właściciela), limity per firma
  poza limiterem importu.
  Porzucone rezerwacje (#609, migracja `0134`): jeśli proces pada między rezerwacją a
  rozliczeniem, rezerwacja nie może blokować limitu bezterminowo. `/api/maintenance` woła co
  godzinę `ai_budget_release_stale_reservations` (service_role, idempotentne, `FOR UPDATE SKIP
  LOCKED`) — rezerwacja starsza niż 60 minut i wciąż `reserved` jest rozliczana jako
  `outcome='failed'`, koszt 0 (ślad w rejestrze zostaje, limit doby/miesiąca wraca do użycia).
  TTL dłuższy niż próg ostrzeżenia `staleReservations` (15 min) w `ai_budget_status`, więc
  trwające jeszcze wywołanie nie jest zwalniane przedwcześnie. Dowód: `rls.sql` sekcja AIB609.
  Minimalizacja (#500): przed modelem tylko `<main>`/`<article>` i `JobPosting` z listy pól
  (`src/lib/ai-import/minimize.ts`), e-maile/telefony/NISS/numery dokumentów zastąpione
  znacznikiem, w prompcie sam host; `contactEmail` poza schematem (ręcznie w kroku 9). Wyjście:
  pole z e-mailem/telefonem czyszczone, identyfikator → odmowa `JOB_IMPORT_SENSITIVE_DATA`.
  Zrzutu nie redagujemy lokalnie (brak OCR). Test: `ai-import-minimize`. **Otwarte (#500):**
  ocena prawna (art. 6/14, role), decyzja o imporcie obrazu.
  Sprzątanie przekierowań (#827): przy statusie 3xx `safeFetchListing` od razu zamyka
  odpowiedź i jej połączenie (`res.destroy()`, `res.on('error', …)` gasi błąd zbędnego już
  strumienia) zamiast bezwarunkowo opróżniać ciało (`res.resume()`) — źródło mogło strumieniować
  dowolnie długie/nigdy niekończące się ciało 3xx już po przejściu importera do kolejnego adresu
  (dotyczy też błędnego/zablokowanego celu przekierowania i przekroczenia liczby hopów, bo
  zamknięcie następuje zaraz po odczytaniu nagłówków, przed dalszą walidacją). Dowód: unit
  `ai-import-safe-fetch` (serwer testowy z niekończącym się ciałem 302, kontrola ujemna:
  test czerwony na starym `res.resume()`).
- [x] Asystent redagowania treści oferty (#37, część pracodawcy; za flagą `AI_JOB_ASSIST_ENABLED`,
  domyślnie wyłączony; `docs/AI_JOB_ASSIST.md`): panel na krokach 5–6 kreatora
  (`JobAssistPanel`) → akcja `suggestJobText` (recruiter+ aktywnej firmy, limit per firma 20/h
  i 60/dobę fail-closed, globalny budżet AI #36 przez `src/lib/ai-assist/budget.ts`) → model
  OpenAI (`gpt-6-luna`, `AI_JOB_ASSIST_MODEL`/`AI_MODEL`, strict structured output) → propozycja brzmienia opisu,
  obowiązków i wymagań w języku oferty. Wejście ścisłe (tylko tekst oferty — bez danych
  kandydatów), e-maile/telefony/identyfikatory usuwane przed wysłaniem, polecenia dla AI
  (wzorce PL/NL/FR/EN + flaga modelu) = brak propozycji; propozycja z nową liczbą/linkiem albo
  danymi kontaktowymi nie jest pokazywana. Pole zmienia się tylko po „Użyj propozycji”, obok
  zawsze tekst rekrutera i „Przywróć mój tekst”; akcja niczego nie zapisuje i nie publikuje.
  Informacja o AI przed pierwszym użyciem. Atrapa `AI_JOB_ASSIST_PROVIDER=fixture` tylko poza
  produkcją. Testy: `job-assist-guard`, `job-assist-action`, `ai-inventory`, E2E `job-assist`.
  **Otwarte:** część dla kandydata (#37), ocena prawna art. 50 AI Act,
  fakty słowne (bez liczb) wykrywa tylko przegląd rekrutera.
- [x] Wygaszanie ofert (#72, migracja `0085`): `expire_due_jobs()` (service_role, `SKIP LOCKED`,
  zwraca liczbę) zmienia tylko `active` z `expires_at <= now()` na `expired`; woła je
  `/api/maintenance` (cron Railway co godzinę, `docs/railway/README.md`). Panel nie czeka na cron:
  licznik aktywnych filtruje datę, lista pokazuje aktywną po terminie jako `expired`
  (`src/lib/job-expiry.ts`) z akcją „Otwórz ponownie”, kreator jej nie edytuje. `publish_job` z
  minioną datą i `resume` wstrzymanej po terminie → `JOB_EXPIRED` (bez cichego czyszczenia daty);
  `reopen` usuwa minioną datę, także dla aktywnej/wstrzymanej po terminie. Dowód: `rls.sql` sekcja EX72.
  Reopen = nowa publikacja (#1222, decyzja właściciela 29.09.2026, migracja `0202` — numer tymczasowy):
  `set_job_status(…, 'reopen')` ustawia `published_at = now()` (alerty zapisanych wyszukiwań, filtr daty, sort
  „najnowsze”, `datePosted`); pauza/wznowienie daty nie zmieniają; para (wyszukiwanie, oferta) już wysłana nie
  wraca. Dowód: `rls.sql` sekcja OD981 (kontrola ujemna: warunek z 0085 zostawia starą datę).
- [x] Szczegół zgłoszenia `/employer/aplikacje/[id]` (#300) — **wyłączone w trybie ogłoszeniowym (#1144)** — wiadomość, telefon, dostępność, data, profil zawodowy (umiejętności/języki/certyfikaty/doświadczenie), dopasowanie, historia statusów, „Napisz wiadomość” (`openConversation`) i zmiana statusu (`ApplicationStatusMenu`); odczyt pod RLS recruiter+ aktywnej firmy (`getEmployerApplicationDetail`), jawne stany błąd/404; linki z listy i pulpitu.
  Fokus po anulowaniu potwierdzenia (#800): „Anuluj” w kroku potwierdzenia (`rejected`/`hired`)
  przywraca fokus na status, który uruchomił potwierdzenie (referencje opcji listy), zamiast go
  gubić po odmontowaniu panelu; Escape nadal zamyka całe menu i wraca fokusem na trigger (bez
  zmiany). Bez migracji, bez nowych tekstów. Dowód: `tests/unit/application-status-menu.test.tsx`
  (kontrola ujemna: Escape w kroku potwierdzenia zamyka menu i nie używa nowej ścieżki fokusu).
  Historia zgłoszenia nie znika po awarii kolejnej strony (#770): `getEmployerApplicationHistoryPage`
  zwracał błąd zapytania jako pustą, „gotową” stronę (`{items:[],nextCursor:null}`) — server action
  zgłaszał `ready`, a `ApplicationHistoryList` usuwał kursor i „Pokaż więcej”, jakby historia się
  skończyła, bez komunikatu i bez możliwości ponowienia. Loader ma teraz jawny wynik
  `{status:'ok', page}` / `{status:'error'}` (`ApplicationHistoryPageLoad`); pusta strona zostaje
  tylko dla legalnych przypadków (zły identyfikator, cudza/usunięta aplikacja, koniec historii) —
  awaria zapytania propaguje `error` do akcji i UI (istniejący komunikat + „Spróbuj ponownie” już
  to obsługiwały, brakowało tylko sygnału z loadera). Bez migracji, bez nowych tekstów. Dowód:
  `tests/unit/employer-application-history.test.ts` (kontrola ujemna regresji #770).
- [x] Stronicowanie kursorem i szczegół kandydata (audyt P1-05/P1-06, migracja `0152`): `/employer/oferty` (created_at, id), `/employer/aplikacje` (submitted_at, id) i
  `/employer/kandydaci` (wynik, kandydat) zamiast OFFSET/top 5 — kursor w adresie w obu
  kierunkach (`?po=` starsze/dalsze, `?przed=` nowsze), zły token = pierwsza strona
  (`src/lib/employer/list-cursor.ts`); indeksy częściowe firmy pod kursor, RPC
  `get_company_matches_page` (SECURITY INVOKER, reguły jak `get_company_top_matches`: jeden
  wiersz na kandydata, recruiter+, firma zweryfikowana; limit 1–51; `member`/firma niezweryfikowana =
  jawne stany jak na pulpicie, P1-14). Zgłoszenia jednej oferty
  `?oferta=` (link „Zobacz zgłoszenia” na karcie oferty, recruiter+; oferta spoza firmy = 404).
  Szczegół kandydata `/employer/kandydaci/[id]` (`getEmployerCandidateDetail`, pod RLS, tylko
  przy dopasowaniu albo zgłoszeniu do ofert AKTYWNEJ firmy; inaczej 404): profil zawodowy,
  dopasowania z wysyłką propozycji (tylko do aktywnej oferty), zgłoszenia z linkami; link z listy kandydatów i ze szczegółu
  zgłoszenia. Dowód: `rls.sql` sekcja EP05 (remis wyniku na granicy, oba kierunki, izolacja;
  kontrole ujemne: stary odczyt obcina do 20, OFFSET dubluje po wstawieniu), integracja
  `portal-employer` (granica strony z remisem i nowym zgłoszeniem, cudza firma/member = pusto
  albo 404), unit `employer-list-cursor`, `employer-*-load`, E2E `employer-candidate-detail`,
  `panel-a11y` (nowa trasa).
- [x] Narzędzia rekrutera (migracja `0170`): filtry `/employer/aplikacje`
  po ofercie i statusie w adresie (`?oferta=`, `?status=`, formularz GET bez JS; ten sam kursor
  `submitted_at` + `id`, filtry zachowane w stronicowaniu; `parseApplicationStatusFilter`
  w `src/lib/applications/bulk.ts`). Akcja zbiorcza (`ApplicationsBulkSelection`): zaznaczenie
  zgłoszeń bieżącej strony, status z menu (`MENU_TARGET_STATUSES`), potwierdzenie i raport per
  wynik; `bulkTransitionApplications` (firma WIDOKU sprawdzana `getExpectedActiveCompany` →
  `ACTIVE_COMPANY_CHANGED`, limit 20 operacji/h) → RPC `bulk_transition_applications` (≤ 50
  różnych zgłoszeń firmy, recruiter+, każde przez `transition_application` w osobnym podbloku —
  ta sama macierz, błąd wiersza nie cofa reszty; wyniki `changed/unchanged/invalid_transition/
  not_found/permission_denied/error`). LIM17-01: `transitionApplication` ma limiter per konto
  (120/h) i per konto × zgłoszenie (20/h); w bazie `application_status_email_gate` scala
  niewysłany e-mail o statusie (najnowszy status wygrywa, `suppressed_superseded`) i ogranicza
  przejścia pośrednie do 3 e-maili/zgłoszenie/24 h (końcowe zawsze), także dla gościa. Szablony
  odpowiedzi (`/employer/szablony`, `MessageTemplatesManager`): `company_message_templates` +
  warianty pl/nl/fr/en, odczyt RLS recruiter+ firmy, zapis RPC `save_/delete_company_message_template`
  (limit 50, CAS `updated_at` → `STALE_STATE`, NISS/dokument odrzucany w akcji). Kompozytor
  rekrutera (`MessageTemplatePicker`): wariant wg języka kandydata z
  `get_conversation_template_context` (`resolve_recipient_locale`, Invariant #1); brak wariantu =
  komunikat „kandydat ma inny język” i świadome wstawienie innej wersji; zmienne `{imie}`,
  `{stanowisko}`, `{firma}`. Dowód: `rls.sql` sekcja RT170 (kontrole ujemne: bez bramki e-maili,
  polityka bez recruiter+), integracja `portal-recruiter-tools` (PG16), unit `recruiter-tools*`,
  E2E `recruiter-tools` (4 języki, axe 320/1280). **Otwarte:** szablon przy zmianie statusu
  (wysyłka wiadomości zbiorczo), tłumaczenie brakującego wariantu przez AI (#31), filtry
  dopasowania/języków/„bez konta”, zaznaczanie ponad bieżącą stronę.
- [x] Zespół firmy i kolejna firma (#403, migracja `0086`): `/employer/zespol` — lista członków
  (owner/admin; RPC `get_company_team`), zmiana roli (`set_company_member_role`), odebranie/
  przywrócenie dostępu (`set_company_member_active`, z potwierdzeniem), zaproszenie po e-mailu
  (`invite_company_member`: rola admin/recruiter/member, ważne 14 dni, idempotentne, limit 50
  oczekujących) i cofnięcie (`revoke_company_invitation`). Hierarchia (`can_manage_company_role`,
  lustro UI `src/lib/team/permissions.ts`): owner zarządza każdym, admin tylko recruiter/member,
  nikt własnym członkostwem przez RPC; ostatni aktywny owner nietykalny (jawnie w RPC + trigger
  `enforce_owner_invariants` z tą samą hierarchią dla bezpośredniego DML). Bezpośredni INSERT do
  `company_members` odebrany — dołączenie tylko przez przyjęcie zaproszenia
  (`respond_to_company_invitation`: zweryfikowany e-mail sesji = adres zaproszenia, konto
  pracodawcy; przyjęcie przełącza aktywną firmę). Istniejące konto pracodawcy dostaje powiadomienie
  (`system`/`company_invitation` → `/employer/zespol`) i e-mail `teamInvitation` w języku odbiorcy;
  odpowiedź RPC nie zależy od istnienia konta. Zaproszenia widać też w widoku zakładania firmy
  (konto bez firmy). „Dodaj kolejną firmę” w przełączniku → `/employer/firma/nowa`
  (`create_additional_company`: owner, `unverified`, limit 5 firm z rolą owner, idempotentne
  ≤ 10 min, audyt). Rola `member`: zamiast „Dodaj ofertę”, edycji i cyklu życia ofert —
  wyjaśnienie (`RecruiterOnlyNote`). Każda zmiana → `audit_logs`. Dowód: `rls.sql` sekcja TM403;
  unit `team-actions`, `team-members-ui`; E2E `employer-team.spec`.
  Adres BEZ konta (migracja `0121`): zapraszający wybiera język zaproszenia (PL/NL/FR/EN,
  domyślnie język strony — decyzja: brak profilu odbiorcy = jedyny znany język, Invariant #1;
  konto z profilem dostaje e-mail w języku profilu), `company_invitations.locale`. E-mail
  `teamInvitationSignup` z linkiem `/{locale}/rejestracja-pracodawca#token=` — token =
  HMAC(`GUEST_APPLY_SECRET`, `team-invite:`+nonce) (`src/lib/team/invite-token.ts`), w bazie
  tylko hash (czyszczony po rozstrzygnięciu), nonce w payloadzie; odświeżenie zaproszenia
  wymienia token; najwyżej 3 linki na adres na dobę. Strona rejestracji (`EmployerSignupEntry`)
  czyta token z fragmentu, podgląd `team_invitation_signup_preview` (service_role) → formularz
  bez nazwy firmy, adres z zaproszenia; `registerInvitedEmployer` zużywa token
  (`consume_team_invitation_signup`, raz, tylko ten adres). Konto powstaje bez firmy, a
  zaproszenie czeka w panelu po weryfikacji adresu. Wynik RPC niezależny od konta. Dowód:
  `rls.sql` sekcja TI403 (kontrole ujemne), unit `team-invitation-signup-*`, E2E `employer-team`.
  Utwardzenie (#611/#610, migracja `0133`): limit „najwyżej 3 e-maile `teamInvitationSignup`
  na adres / 24 h” jest teraz atomowy — advisory lock kluczowany adresem serializuje odczyt
  licznika i wstawienie w `enqueue_team_invitation_signup_email` (jak `begin_checkout`, 0050),
  więc równoległe zaproszenia z różnych firm dla tego samego adresu nie omijają limitu.
  Doprecyzowany i przetestowany kontrakt stanu `used` w `team_invitation_signup_preview`
  (token zużyty, zaproszenie nadal `pending` — czeka w panelu). Dowód: `rls.sql` sekcje
  TI610 (sekwencja preview → consume → preview) i TI611 (dwie równoległe sesje przez dblink),
  unit `team-invitation-signup-preview`.
  Oczekujące zaproszenia (migracja `0187`): `get_company_invitations`
  zwraca też `locale` (null dla zaproszeń sprzed 0121) i `inviter_name` (bramka owner/admin
  bez zmian; zmiana typu wyniku = DROP + CREATE). Wiersz listy w `/employer/zespol` pokazuje
  język zaproszenia, kto i kiedy zaprosił. „Odnów” (`renewTeamInvitation(id, expectedCompanyId)`, firma widoku jak przy
  zapraszaniu — inna aktywna firma = `ACTIVE_COMPANY_CHANGED`): klient podaje tylko
  id, adres/rolę/język akcja czyta z listy AKTYWNEJ firmy w tej samej transakcji i woła
  `invite_company_member` z nowym tokenem (14 dni, nowy link dla adresu bez konta, limit 3/dobę
  jak dotąd; zaproszenie bez języka → `en`); spoza listy = `NOT_FOUND`. „Cofnij” dopiero po
  potwierdzeniu w `ConfirmDialog` (własna etykieta `team.revokeConfirm` — po francusku „Annuler”
  = także „Anuluj”, test pilnuje różnicy); po sukcesie fokus na komunikacie `role="status"`. Dowód:
  `rls.sql` sekcja TI179 (kontrola ujemna: definicja z 0086 bez `locale`), unit
  `team-invitation-renew` (kontrole ujemne: obce id, brak sesji/firmy), `team-invitations-ui`
  (cofnięcie bez potwierdzenia nie woła akcji), E2E `employer-team` (4 języki, demo).
  Ponowienie po błędzie sieci (#1113, bez migracji): formularz zaproszenia i „Odnów” wysyłają
  klucz operacji (UUID w `useRef`, nowy po sukcesie albo po zmianie adresu/roli/języka), a akcja
  liczy z niego nonce linku (`teamInviteTokenForOperation`: HMAC sekretu z konta, firmy, danych
  operacji i klucza) — ponowienie = ten sam token, więc `invite_company_member` nie wysyła
  drugiego e-maila (klucz idempotencji e-maila zawiera skrót tokenu) i nie unieważnia linku
  z pierwszej wiadomości; bez klucza token losowy jak dotąd. Dowód: unit `team-actions`,
  `team-invitation-renew`, `team-invitations-ui` (kontrole ujemne: inny klucz/dane = nowy token).
  Limit 50 liczy tylko WAŻNE zaproszenia (#893, migracja `0178`):
  `invite_company_member` sprawdzał limit po `count(*) where status='pending'`, bez
  `expires_at > now()` — dawno wygasłe, niesprzątnięte zaproszenia (niewidoczne w panelu,
  bo `get_company_invitations` od 0086 filtruje po dacie) zajmowały limit na zawsze i blokowały
  zapraszanie nowych osób bez żadnej akcji „Cofnij” w UI dla tych rekordów. Ujednolicone: limit
  liczy `pending` z `expires_at > now()`, dokładnie jak panel; sama tabela i sygnatura RPC bez
  zmian. Dowód: `rls.sql` sekcja TM403-13 (50 wygasłych nie blokuje nowego zaproszenia; limit
  nadal działa przy 51 realnie ważnych; kontrola ujemna: cofnięcie migracji `0178` czerwoni
  TM403-13c przez `INVITATION_LIMIT_REACHED`).
  Przywrócenie wyłączonego członka przez zaproszenie (#867, migracja `0217` — numer tymczasowy):
  zaproszenie na adres osoby z NIEAKTYWNYM członkostwem wymaga, by zapraszający zarządzał jej
  dotychczasową rolą i rolą z zaproszenia (reguła `set_company_member_active`) — strażnik BEFORE
  INSERT/UPDATE na `company_invitations` (`MEMBER_REACTIVATION_DENIED` → `team.error.reactivationDenied`,
  bez redefinicji `invite_company_member`) i ponownie `respond_to_company_invitation` przy
  przyjęciu (`REACTIVATION_NOT_ALLOWED` → `team.error.reactivationNotAllowed`; obejmuje zaproszenia
  sprzed migracji i zapraszającego, który stracił uprawnienia). Admin nie przywróci wyłączonego
  admina zaproszeniem na rekrutera; owner może. Dowód: `rls.sql` sekcja TMR867 (kontrola ujemna:
  rollback `0217_…down.sql` = obejście działa), `team-reactivation-rollback.sql`, unit `team-actions`.
  Token a limit e-maili (#793, migracja `0210`): odświeżenie zaproszenia dla adresu bez konta
  wymienia `signup_token_hash` dopiero po udanym zakolejkowaniu e-maila z nowym tokenem — odmowa
  limitu 3/dobę zostawia token z ostatnio wysłanego e-maila (link działa); wynik RPC bez zmian,
  adres z kontem jak dotąd. Podpowiedź `team.inviteLinkHint` opisuje limit. Dowód: `rls.sql`
  TI611-3 (równolegle) i P2C994 (kontrola ujemna: definicja z 0178 wymienia token bez e-maila).

### Etap 5 — procesy
- [x] Matching (logika + test jednostkowy + integracja z UI) — **wyłączone w trybie ogłoszeniowym (#1131)** — deterministyczny `scoreMatch` (test), RPC `get_job_match_profile` (0024, tokeny wymagań oferty), loader `getMyJobMatch` (profil kandydata pod RLS + oferta przez RPC), wyspa kliencka `JobMatchCard` na detalu oferty (SSR/SEO bez zmian dla anonimów; kandydat widzi „Twoje dopasowanie" %, atuty, braki). i18n `match` (pl/nl/fr/en). Dowód RPC: `rls.sql` I10.
  Poziomy języków (#195, 0074): każdy wymagany język = 10/n pkt; poziom ≥ wymagany (lub oferta
  bez poziomu) → pełny udział, o jeden niżej → połowa, niżej lub nieznany → 0; luka w
  `languageGaps` (komunikat `match.languageLevel*`). Lokalizacja (#194): odległość haversine
  vs `radius_km` (w promieniu 15, poza 0, remote bez ograniczeń); współrzędne: słownik
  `locations` z bazy, potem kanoniczna lista ~46 belgijskich miast w kodzie z aliasami
  PL/NL/FR/EN (`src/lib/matching/belgian-cities.ts`, 10 miast = wartości z `0010`, strażnik
  w `matching-locations.test.ts`); miasto spoza obu → ten sam region = 10 bez etykiety
  „w promieniu”.
  Słownik w bazie (#194, migracja `0112`): 602 miejscowości = lista
  kanoniczna z kodu (jej współrzędne i aliasy mają pierwszeństwo) + wszystkie gminy Belgii
  i gminy zniesione przy fuzjach 2019/2025 z migawki Wikidata (CC0 1.0,
  `data/locations/`, bez API w runtime), `is_demo = false`. Kolumny `locations.kind`
  (`municipality`/`former_municipality`/`locality`) i `refnis` (kod NIS). Tabela
  `location_aliases` (nazwy PL/NL/FR/EN, `alias_key` = `cityKey`, unikalny; własna nazwa gminy
  wygrywa z egzonimem — „Saint-Nicolas” to gmina w prowincji Liège, nie Sint-Niklaas),
  odczyt publiczny, zapis service_role. Loader `getMyJobMatch` pyta tylko o klucze miasta
  kandydata i oferty. Migracja jest GENEROWANA (`node scripts/locations/build-migration.mjs`;
  odświeżenie migawki `node scripts/locations/fetch-wikidata.mjs`); test porównuje plik
  z generatorem, lustro TS z bazą (z kontrolą ujemną) i klucze z `cityKey`. Dowód: `rls.sql`
  sekcja LOC194 (kontrola ujemna bez polityki RLS), rollback `supabase/rollback/0112_…down.sql`,
  integracja `portal-candidate` (Puurs–Bornem tylko z bazy; mutacja bez słownika = czerwony).
  Części gmin (migracja `0151`): 2066 deelgemeenten / sections de commune
  z migawki Wikidata (CC0 1.0, `data/locations/be-sections.wikidata.json`, klasa Q2785216 +
  kody NIS części) jako `locations.kind = 'section'` z `parent_location_id` (gmina z 0112:
  obecna z P131, potem następca gminy zniesionej P1366, potem kod NIS; strażnik
  `locations_section_parent_guard` — rodzicem tylko gmina, usunięcie gminy usuwa części),
  współrzędne części (brak = gminy), aliasy PL/NL/FR/EN: klucz zajęty w 0112 zostaje przy gminie,
  nazwa wspólna kilku części (Deurne, Berchem…) pominięta. Matching bez zmian w kodzie — loader
  czyta te same aliasy (Heverlee–Kessel-Lo w promieniu tylko ze słownika). Ten sam generator
  (`build-migration.mjs` pisze 0112 i 0151; 0112 bez zmian). Dowód: `rls.sql` sekcja SEC151
  (kontrole ujemne: bez strażnika, bez danych), `matching-locations` (plik = generator, reguły
  aliasów z kontrolą ujemną), integracja `portal-candidate` (kontrola ujemna: części nieaktywne),
  rollback `supabase/rollback/0151_…down.sql` (test w `test-rls.sh`).
  **Do zrobienia:** geokodowanie miejscowości spoza słownika, nazwy części wspólne dla kilku gmin
  (dziś pominięte);
  zmiana listy w kodzie po wdrożeniu 0112 = nowa migracja (test wskazuje plik 0112).
  Polecane oferty (#196): `get_public_jobs_by_ids` dla najlepszych `matches`, bez limitu 100 najnowszych.
  Materializacja `matches` (P1-03, migracja `0147`): triggery kolejkują
  podmiot w `match_recompute_queue` (kind `candidate`/`job`, PK = jeden wiersz, ponowne
  zgłoszenie podbija `version`): oferta aktywna (jobs + relacje), status firmy, profil
  kandydata i relacje, konto (rola/usunięcie), blokada firmy (#97), deklaracja wieku (#492).
  Worker `runMatchRecompute` (`src/lib/matching/materialize.ts`) w `/api/maintenance` po
  `expire_due_jobs`: `match_recompute_claim` (SKIP LOCKED, dzierżawa 10 min, ≤ 50, po 5 próbach
  czeka na nowe zgłoszenie; na przebieg ≤ 100 podmiotów) → `match_recompute_inputs` (tylko pary
  kwalifikujące się, ≤ 500 stron przeciwnych; oferta = `get_job_match_profile`) → `scoreMatch`
  przez wspólne mapowanie `src/lib/matching/inputs.ts` (to samo co `getMyJobMatch`, bez AI) →
  `match_recompute_apply` (service_role; każda para ponownie `match_pair_eligible`: profil
  ukończony i wyszukiwalny #494, 18+ #492, bez blokady firmy #97, oferta active/niewygasła
  firmy verified; wiersze niekwalifikujące się i rozważone poniżej progu 40 usuwane; kolejka
  zdejmowana tylko przy niezmienionej wersji). Do przebiegu workera firmom wiersze ukrywa RLS
  (0100). Backfill w migracji. Odczyt live: data ważności certyfikatu jako tekst (sterownik pg
  zwracał `Date`, więc wygaśnięcie było pomijane). Dowód: `rls.sql` sekcja MP03 (kontrole
  ujemne: kwalifikacja bez widoczności/wieku/blokady/verified, naiwny zapis), unit
  `matches-materialize`, integracja `portal-matches` (PG16: wiersz = wynik live).
  Kolejność blokad (migracja `0149`): `match_enqueue` najpierw blokuje
  wiersz podmiotu (`candidate_profiles` kandydata / `jobs` oferty, FOR NO KEY UPDATE), dopiero
  potem wiersz kolejki — ta sama kolejność co UPDATE profilu/oferty. Wcześniej równoległe kroki
  3 i 5 onboardingu tego samego kandydata zakleszczały się (relacje: kolejka → profil, krok 3:
  profil → kolejka) i akcja zwracała `INTERNAL`. Semantyka kolejki bez zmian. Dowód: `rls.sql`
  sekcja MQ233 (dwie sesje przez dblink; kontrola ujemna z definicją z 0147 = deadlock),
  E2E real `candidate-onboarding` (równoległe kroki 3/5).
  **Otwarte:** kandydat niewyszukiwalny nie ma wierszy (polecane oferty tylko po opt-in),
  okresowe przeliczenie przy upływie ważności certyfikatu (dziś tylko przy zmianie danych),
  prefiltr regionu/kategorii przy dużej liczbie ofert.
  Certyfikaty (#96, 0079): `candidate_certificates.expires_at` zapisywane przez
  `set_candidate_certificates(jsonb)` (krok 5 onboardingu: data „Ważny do” przy każdym certyfikacie,
  oznaczenie „Wygasł”); `scoreMatch(…, { today })` nie liczy certyfikatu z `expires_at` < dziś
  (dzień w Europe/Brussels, `referenceDate`), wygasły wymagany → `expiredCertificates` z wyjaśnieniem.
  Top dopasowani (#141, 0079): `get_company_top_matches` — najlepsze dopasowanie na kandydata
  (DISTINCT ON) przed limitem 5, pod RLS (recruiter+, widoczność kandydata, firma verified).
  Dowód: `rls.sql` sekcja MC.
  Data propozycji deterministyczna (#718, bez migracji): odczyt aktywnej propozycji
  (`sent`/`viewed`) dla pulpitu, pełnej listy dopasowanych kandydatów i szczegółu kandydata
  (`matchedCandidateCards`, `getEmployerCandidateDetail` w `src/lib/data/employer.ts`) dodaje
  `ORDER BY COALESCE(sent_at, created_at) DESC` w SQL i wybiera w JS zawsze późniejszą datę
  (`setLatestOfferDate`), zamiast nadpisywać wynik ostatnim odczytanym wierszem — dwie aktywne
  propozycje dla tej samej pary kandydat–oferta (historyczna + ponowiona) nie mogą już pokazać
  starszej daty w zależności od planu zapytania/indeksu/vacuum. Testy: `employer-candidates-load`
  (kontrola ujemna: odwrócona kolejność wierszy), `employer-candidate-detail-offers`.
  Odporność odczytu (#191/#197): `getSimilarJobs` i `getMyJobMatch` zwracają jawny wynik
  (`ok`/`error`, dopasowanie także `none`). Awaria podobnych ofert nie blokuje szczegółu
  i aplikowania; błąd któregokolwiek z pięciu odczytów dopasowania daje „nie udało się
  policzyć” z ponowieniem, nigdy procent z niepełnych danych.
  Języki ze słownika (I18N-02/CF-02, migracja `0168`): onboarding (krok 5)
  i kreator (krok 7) wybierają język z listy `public.languages` (kody ISO, nazwy
  `languageNames.*` w języku interfejsu); pozycja `{language, level}` = kod albo — tylko stary
  wpis — etykieta. `job_languages.language_id` (nowa kolumna), trigger `fill_language_id`
  na obu relacjach uzupełnia id z nazwy na każdej ścieżce (import CV, duplikat oferty, seed),
  `language_aliases` (nazwy PL/NL/FR/EN, lustro `src/lib/languages.ts`, test 1:1) i backfill
  starych etykiet; niedopasowane zostają etykietą. `set_*_languages` deduplikują po języku
  (wyższy poziom). `get_job_match_profile`/`match_candidate_input` niosą kod, `scoreMatch`
  porównuje kod (etykiety bez kodu przez te same aliasy; klucz etykiet NFC + bez diakrytyków
  + złożone spacje, LIM17-05). Szczegół oferty, karta dopasowania, profil kandydata i widoki
  pracodawcy pokazują nazwę w języku widza. Dowód: `rls.sql` sekcja LD168 (kontrole ujemne:
  bez triggera, stara deduplikacja), unit `language-dictionary`. **Etap 2 (otwarte):**
  zawody/umiejętności na ESCO z propozycją mapowania AI zatwierdzaną przez człowieka
  (`docs/ESCO.md`).
- [~] Taksonomia ESCO v1.2.1 (#93, migracja `0097`, `docs/ESCO.md`): zawody/umiejętności z
  przypiętego snapshotu tylko w PL/NL/FR/EN (RO/UK z issue pominięte — decyzja właściciela).
  `esco_uri` = klucz, `occupation_labels`/`skill_labels` (preferred/alternative, FK do
  `supported_locales`), `occupation_skills` (essential/optional), `esco_snapshots` (pliki +
  SHA-256, atrybucja, raport). Import `npm run esco:import` (`scripts/esco/`): jedna transakcja
  jako service_role, upsert po URI, ponowny import = zero zmian, inne pliki tej wersji →
  `ESCO_CHECKSUM_MISMATCH`, wiersz ręczny z tym samym URI → `ESCO_MANUAL_CONFLICT` (skip/overwrite
  tylko jawnie). Fallback `occupation_label`/`skill_label`: język → en → name. Słowniki czytelne
  publicznie, zapis tylko service_role. Dowód: `rls.sql` ESCO93, unit `esco-snapshot`,
  `npm run test:esco`. Fragment testowy (API ESCO, `is_demo`) w `tests/fixtures/esco/`.
  **Do zrobienia (właściciel):** pobranie oficjalnych paczek CSV (formularz z linkiem e-mail),
  zatwierdzenie `data/esco/esco-v1.2.1.manifest.json`, pełny import; atrybucja w UI i matching
  na ESCO = osobne issues.
- [~] Tłumaczenia AI — rdzeń (#31, #32, migracja `0145`, `docs/AI_TRANSLATION.md`), tylko
  pl/nl/fr/en, domyślnie wyłączone (`AI_TRANSLATION_ENABLED`). Kolejka: niezmienne rewizje
  źródła (kanoniczne pola + SHA-256, ta sama treść = no-op), zadania per język docelowy i wersję
  pipeline (unikat = deduplikacja), `claim_translation_jobs` (SKIP LOCKED + lease, restart =
  przejęcie wygasłej dzierżawy), `complete_translation_job` (CAS po lease + kontrola bieżącej
  rewizji — wynik v1 po v2 = `superseded`), `fail_translation_job` (backoff/jitter/Retry-After),
  ukrycie/purge encji, korekta ręczna z autorem i wersją (AI jej nie nadpisuje). Wszystko RPC
  service_role, tabele deny. Adapter `src/lib/translation/`: interfejs dostawcy + OpenAI
  (`openai-provider.ts` na wspólnym kliencie `src/lib/ai/openai.ts`, `gpt-6-luna`, structured
  output `strict`, bez narzędzi, `store: false`, dane w `<source_fields>`), walidacja
  kształtu i niezmienności faktów pole po polu (`facts.ts`: liczby, kwoty, waluty, daty,
  godziny, e-maile/URL/telefony, jednostki, brutto/netto, okres stawki, kwalifikacje, nazwy
  własne, negacja) — niepoprawny wynik nigdy nie trafia do bazy; logi tylko kody. Worker
  `processTranslationBatch` (dostawca poza transakcją). Budżet AI (#36): adapter przez
  `withAiBudget` (rezerwacja przed API, rozliczenie tokenami, log użycia bez treści); odmowa
  budżetu → `defer_translation_job` (zadanie wraca po 1 h / 5 min bez zużycia próby). Dowód:
  `rls.sql` sekcja TR31 z kontrolami ujemnymi TR31-N i TR31-13N; unit `translation-*`.
  **Do zrobienia:** wpięcie profili (#34), benchmark i wybór modelu (#30), SEO wersji przetłumaczonych.
  Oferty (#33, migracja `0146`, zależy od #514): odroczone triggery na `jobs`/
  `job_translations`/`job_requirements`/`companies` → przy COMMIT `sync_job_translation_source`:
  oferta publiczna (active, niewygasła, firma verified, nie demo) = `record_translation_source`
  z polami w języku oferty (opis, listy, wymagania tekstowe `requirements_mandatory.N`/
  `_optional.N`), niepubliczna = ukrycie, usunięta = purge. Każda ścieżka zapisu (publish,
  edycja, pauza/wznowienie, wygaśnięcie, moderacja, status firmy) kolejkuje zatwierdzoną treść;
  rollback bez śladu, jedna transakcja = jedna rewizja, stawka/miasto bez rewizji (wspólne
  z `jobs`), limit pól rdzenia = `skipped` bez blokady publikacji. Worker `POST
  /api/translation/process` (`MAINTENANCE_SECRET`, `src/lib/translation/run.ts`, log użycia AI),
  bez flagi `skipped`. Wersja pipeline SQL = TS (`translation-job-sync.test`). Dowód: `rls.sql`
  sekcja TR33 (dwie sesje przez dblink, kontrola ujemna TR33-N); sekcja TR31 na własnych
  encjach. Cron: Cloudflare Worker co 10 min (`infra/cloudflare-cron`, `/api/translation/process`).
  Odczyt na stronie oferty (migracja `0159`): RPC
  `get_public_job_machine_translation` (anon; tylko oferta publiczna, bieżąca rewizja bez
  `is_stale`, język bez własnego tłumaczenia/wymagań, strona pokazuje treść `default_locale`
  albo `jobs.title` — ten sam warunek co karty 0160, tylko pola wyświetlane) →
  `readMachineTranslation` w `getJobBySlug` (za flagą `AI_TRANSLATION_ENABLED`, awaria =
  oryginał + kod obszaru w logu) → `applyJobMachineTranslation`
  (`src/lib/job-machine-translation.ts`: nakładka tylko przy pełnej zgodności list, inaczej
  oryginał — nigdy mieszanka języków) → oznaczenie `job.machineTranslationNotice`/
  `manualTranslationNotice` z linkiem `job.translationOriginalLink` do oryginału. SEO bez zmian
  (canonical do oryginału, bez hreflang i JobPosting). Dowód: `rls.sql` sekcja TM159 (kontrole
  ujemne TM159-N, TM159-7N), unit `job-machine-translation`.
  Karty listy (migracja `0160`, zależy od 0159): `get_public_jobs_machine_titles(ids[],
  locale)` (anon, SECURITY DEFINER; ≤ 100 id, warunki jak 0159 + karta pokazuje treść
  `default_locale`, z której powstała rewizja; tylko `title` i `highlights.N`) → JEDNO zapytanie
  na stronę w `withListMachineTranslations` (`src/lib/jobs.ts`, za flagą, w tym samym renderze
  serwera — ISR bez zmian; awaria = oryginał + `jobs.readListMachineTranslations`) →
  `applyJobListMachineTranslation` (niepusty tytuł i ta sama liczba wyróżników, inaczej oryginał).
  Włączane jawnie `getJobs(…, …, { translateCards: true })`: strona główna (`getLatestJobs`),
  `/oferty-pracy`, landingi kategorii/miasta, profil firmy; sitemap, liczniki, facety i „Podobne
  oferty” bez przekładu. Znacznik w wierszu firmy `JobCard`: `jobs.machineTranslatedBadge`/
  `jobs.translatedBadge`. SEO bez zmian (JSON-LD i adresy kart nie zależą od przekładu). Dowód:
  `rls.sql` sekcja TM160 (kontrola ujemna TM160-N, limit 100 id, oferta wstrzymana/wygasła/firma
  zawieszona, tekst człowieka), unit `job-list-machine-translation` (flaga wyłączona = brak
  odczytu, jedno wywołanie na stronę, fallback). **Otwarte:** JobPosting/hreflang wersji
  przetłumaczonych (decyzja SEO), przekład w „Podobnych ofertach” (bez znacznika), UI korekty
  ręcznej.
  Język treści kart (#1223, bez migracji): `get_public_jobs`/profil firmy nie zwracają języka
  wybranego tłumaczenia, więc `withListContentLocales` (`src/lib/jobs.ts`, jedno zapytanie
  o tłumaczenia ofert strony pod anon) ustala `contentLocale` regułą
  `resolveJobListContentLocale` (język strony, gdy oferta go ma; inaczej jednoznaczne
  tłumaczenie z identycznym tytułem i wyróżnikami; przekład maszynowy = język strony). `JobCard`
  i pulpit kandydata (zapisane wyszukiwania) ustawiają `lang` tytułu i wyróżników, gdy różni się
  od języka strony. Awaria = karty bez `lang`. Dowód: unit `job-list-content-locale`, `job-card`,
  `classifieds-candidate-saved-search-jobs` (kontrole ujemne).
  Nazwy chronione (#740, migracja `0190` — numer tymczasowy): nazwa firmy (`companies.name`,
  wyłącznie z bazy) = `translation_source_revisions.protected_terms` rewizji oferty
  (`sync_job_translation_source` → `record_translation_source(…, p_protected_terms)`,
  normalizacja `translation_protected_terms`: ≤ 10 nazw po ≤ 200 znaków), część odcisku — zmiana
  nazwy firmy (trigger `companies` z `name`) = nowa rewizja; `claim_translation_jobs` zwraca
  listę, worker podaje ją dostawcy i `validateTranslation` (nazwa ze źródła musi zostać bez zmian,
  inaczej `facts_terms`). Pipeline `translation-v2`. Dowód: `rls.sql` sekcja TP740 (kontrole
  ujemne: odcisk bez nazw, trigger bez `name`), rollback `0190_…down.sql`
  (`translation-protected-terms-rollback.sql`, też w `portal-legal-mode-rollback.sql` przed 0177),
  unit `translation-worker`, `translation-job-sync`.
  Integralność kolejki (#644/#754/#755, migracja `0952` — numer tymczasowy): dzierżawa ważna do
  `lease_expires_at` — `complete/fail/defer_translation_job` po terminie = `stale_lease` także bez
  ponownego przejęcia, a worker nie woła modelu przy zapasie dzierżawy < 90 s
  (`MIN_LEASE_REMAINING_MS`, kod `lease_too_short`, zadanie wraca do puli); źródło tylko dla
  istniejącej, nieusuniętej encji właściwego typu (`translation_entity_exists`: oferta + firma,
  `candidate_profiles.id` + konto) — inaczej `NOT_FOUND`, ukrycie źródła encji, której nie ma,
  = purge, sieroty usunięte jednorazowo; korekta ręczna wymaga autora (null =
  `VALIDATION_FAILED: author`, autor = aktywny admin, recruiter+ firmy oferty albo właściciel
  profilu, inaczej `PERMISSION_DENIED`). Walidator faktów (#1106): negacja także w zdaniach
  z faktami przy innej liczbie zdań (kotwica = odcisk faktów zdania; łączenie/dzielenie zdań bez
  fałszywych odrzuceń). Dowód: `rls.sql` sekcja TQ952 (kontrole ujemne na definicjach sprzed 0952),
  rollback `0952_…down.sql` (`translation-queue-integrity-rollback.sql`), unit
  `translation-facts`, `translation-worker`.

  Wyścig wznowienia oferty z zawieszeniem firmy (#802, migracja `0210`):
  `sync_job_translation_source` czyta firmę z `FOR SHARE OF c` — synchronizacja oferty czeka na
  zatwierdzenie zmiany statusu firmy i widzi `suspended` (źródło nieaktywne, zadania nie wracają);
  wiersz oferty bez blokady (brak zakleszczenia ze stroną firmy); migracja ponownie synchronizuje
  aktywne źródła. Częściowy przekład (#896, bez migracji): `machineTranslation.untranslated` =
  niepuste pola bez klucza w przekładzie; opis oferty i opis firmy w oryginale mają `lang` języka
  źródła. Dowód: `rls.sql` P2C994 (kontrola ujemna: sync z 0190 reaktywuje źródło), unit
  `job-machine-translation`, `job-detail-partial-translation-lang` (kontrole ujemne).

- [x] Aplikacje — **wyłączone w trybie ogłoszeniowym (#1130, #1132, #1144)** — RPC `apply_to_job`/`transition_application` (idempotentne, historia auto, kolejka e-mail) + server actions + wpięcie do UI paneli/ApplyModal (zweryfikowane na PG)
  Dostępność w aplikacji (#190, 0074): osobna wartość `within_two_weeks` („w ciągu 2 tygodni”);
  profil kandydata zachowuje węższy zestaw `AVAILABILITY_VALUES`.
  Ponowna aplikacja (0071, #361): ten sam klucz idempotencji = retry → sukces; inny klucz przy
  istniejącej parze (także `withdrawn`) → `APPLICATION_ALREADY_EXISTS` („Już aplikowałeś…” + link do
  historii). ApplyModal: klucz w `useRef` na czas otwarcia, wyjątek sieci → komunikat `apply.errorNetwork`
  i ponowienie tym samym kluczem (#360); `UNAUTHENTICATED` (link logowania) odróżniony od
  `PERMISSION_DENIED` (konto nie-kandydata), własne komunikaty `RATE_LIMITED`/`JOB_NOT_ACTIVE`.
  Dowód: `rls.sql` B3b/B3c, J7d–J7f.
  Edycja formularza po utraconej odpowiedzi (#926): ponowienie z INNYMI danymi niż ostatnio
  wysłane (kandydat poprawił telefon/wiadomość/dostępność/odpowiedzi po błędzie sieci, którego
  pierwszy zapis mógł się już udać) dostaje NOWY klucz idempotencji zamiast ślepo ponawiać stary —
  `ApplyModal` trzyma migawkę ostatnio wysłanego payloadu (`submittedPayloadRef`) obok klucza.
  Trafienie na istniejącą aplikację z INNYM kluczem niż edytowana próba pokazuje osobny komunikat
  `apply.alreadyAppliedEdited` (edytowane dane NIE zostały zapisane) zamiast ogólnego
  `alreadyApplied`, więc UI nigdy nie przedstawia zmodyfikowanego payloadu jako potwierdzonego
  zapisu. Ponowienie bez edycji zachowuje ten sam klucz i zwykły komunikat (bez zmian, kontrola
  ujemna w teście). Bez migracji — RPC `apply_to_job` (0071/0093) już rozróżniał klucze, brakowało
  tylko odróżnienia payloadu po stronie klienta. Test: `apply-modal-network` (z kontrolą ujemną).
  Szkic przeżywa zamknięcie modalu (#913, bez migracji): zamknięcie dialogu X/Escape przed
  wysłaniem nie zeruje już wpisanych danych — `reset()` w `ApplyModal` uruchamia się TYLKO po
  realnym sukcesie wysyłki (Invariant #11: dane zostają po każdym innym zamknięciu, bez wyjątku
  na błąd). Kandydat: pola już żyły w stanie `ApplyModal`, więc wystarczyło przestać je zerować
  przy `handleOpenChange`. Gość: `GuestApplyForm` odmontowuje się razem z treścią dialogu
  (`LightDialogContent`), więc szkic (bez tokenu Turnstile i bez stanu błędów/wysyłki — te wracają
  do zera przy każdym montażu) trzyma `ApplyModal` w `useRef` (`GuestApplyDraft`, `initialDraft`/
  `onDraftChange`) i czyści go dopiero po `submitGuestApplication` zwracającym sukces — celowo bez
  `localStorage`/`sessionStorage` (decyzja z issue: bez odrębnej decyzji prywatności). Szkic nie
  przeżywa pełnego przeładowania strony ani zmiany oferty (nowa instancja komponentu) — zgodnie
  z kierunkiem z issue („aż do wysłania, zmiany oferty lub opuszczenia strony”). Dowód: unit
  `apply-modal-draft-preserve` (kandydat i gość, z kontrolą ujemną: sukces czyści szkic), E2E
  `guest-apply` (X i Escape na tej samej stronie, z kontrolą ujemną).
  Bez NISS/BIS i numerów dokumentów (#495): wiadomość do firmy i odpowiedzi na pytania
  (kandydat i gość) z numerem rejestru narodowego/BIS (mod 97), PESEL, kartą eID albo numerem
  po słowie kluczowym („paszport nr…”) → błąd przy polu, bez zapisu (`findPersonalIdentifierField`
  w akcjach + refine w Zod; detektor `src/lib/privacy/sensitive-data.ts`). Podpowiedź pod polem
  wiadomości. Test: `sensitive-data`, `apply-sensitive-id`. Wiadomości w rozmowach: ten sam
  detektor w `sendMessage` (przed trybem demo i limitem → `VALIDATION_FAILED` + `field: 'body'`,
  `reason: 'sensitiveId'`, bez RPC) i w `MessageComposer` (błąd przy polu
  `messages.composerSensitiveId`, treść zostaje, podpowiedź `composerSensitiveIdHint`
  w `aria-describedby`); bez migracji (RPC `send_message` woła tylko serwer). Test:
  `messages-sensitive-id` (kontrola ujemna). Nazwy plików załączników w rozmowach
  (#495): `checkAttachmentFile` (`src/lib/validation/message-attachment.ts`, przeglądarka i akcja
  `uploadMessageAttachment`/`storeMessageAttachment`) odrzuca nazwę z NISS/BIS, PESEL, eID albo
  „paszport nr…” (`attachmentNameForScan`: bez rozszerzenia, `_`/`+` → spacja) → `reason:
  'sensitiveId'`, komunikat `messages.attachmentSensitiveId` przy pliku, nic nie trafia do
  bucketu. Test: `message-attachment-name` (kontrola ujemna bez normalizacji separatorów),
  `message-attachments-{actions,service,ui}`. **Otwarte:** ocena prawna, treść
  poradnika i formularza CV (#495), import CV (#487).
  Pytania screeningowe (#101, migracja `0093`): recruiter+ ustala w kroku 7 kreatora do 10 pytań
  (`yes_no`/`single_choice`/`date`/`short_text`, „wymagane”, kolejność, treść w języku oferty +
  opcjonalne tłumaczenia) — zapis w tej samej transakcji co krok (`save_job_draft` →
  `set_job_screening_questions`, replace-all), WYŁĄCZNIE w szkicu (RPC + strażnik na tabeli; w
  edycji opublikowanej oferty tylko podgląd). Kandydat odpowiada w ApplyModal (widzi, że odpowiedzi
  idą do firmy i nie zmieniają dopasowania ani statusu); `apply_to_job(…, p_answers)` waliduje je
  w bazie (`SCREENING_ANSWER_REQUIRED: <id>` → błąd przy pytaniu) i zapisuje niezmienny snapshot
  pytania i odpowiedzi (`application_screening_answers`) w tej samej transakcji; retry z tym samym
  kluczem nie nadpisuje odpowiedzi. Odczyt odpowiedzi: kandydat i recruiter+ firmy oferty; widok
  w szczególe zgłoszenia. Bez reguł dyskwalifikujących i bez LLM (osobny etap). Dowód: `rls.sql`
  sekcja SQ101; unit `screening-questions`; E2E `job-wizard-screening`, `apply-screening` (fixture),
  `employer-application-screening`.
  Czyszczenie opcjonalnej odpowiedzi (#916): pytania `yes_no`/`single_choice` w
  `ScreeningQuestionsFields` mają przycisk „Wyczyść odpowiedź” (`apply.screeningClearAnswer`) —
  widoczny tylko przy pytaniu OPCJONALNYM i już zaznaczonej odpowiedzi, woła
  `onChange(id, undefined)` (rodzic — ApplyModal/GuestApplyForm — już usuwał klucz z formularza).
  Pytania wymagane nigdy nie pokazują tej kontrolki. Bez migracji. Dowód: unit
  `screening-questions-fields` (obie ścieżki, dwa pytania naraz bez wzajemnego wpływu, kontrola
  ujemna: pytanie wymagane bez przycisku).
  Historia zgłoszeń kandydata: karta z zapisanymi
  odpowiedziami ma rozwijane „Moje odpowiedzi” (`ApplicationScreeningAnswers`; licznik z
  podzapytania strony, treść przy pierwszym rozwinięciu przez `loadApplicationScreeningAnswers`
  → `getMyApplicationScreeningAnswers` pod sesją/RLS, snapshot w języku widza z fallbackiem,
  błąd z ponowieniem). Dowód: `portal-candidate.test.ts` (PG16), unit
  `candidate-application-answers`, E2E `candidate-application-answers`, `panel-a11y`.
  Kontrola treści pytań przed publikacją (#497, migracja `0103`): detektor
  deterministyczny (wzorce PL/NL/FR/EN, bez AI) w bazie (`screening_fold`,
  `screening_risk_patterns`, `screening_question_risk`) sprawdza treść i KAŻDĄ opcję we
  WSZYSTKICH językach; lustro `src/lib/screening/risk.ts` (podpowiedź w kreatorze, test
  `screening-risk` porównuje wzorce 1:1 i pilnuje braku trafień na pytania o doświadczenie,
  prawo jazdy, dostępność, języki, VCA). Kategorie: wiek, płeć, ciąża/plany rodzinne, stan
  cywilny, religia, pochodzenie, zdrowie, orientacja, związki zawodowe, poglądy polityczne,
  karalność. Trafienie ≠ ocena prawna: przy zapisie kroku pytanie trafia do
  `screening_question_reviews` (jeden wiersz na ofertę × odcisk treści, audyt
  `screening_question.review_requested`), strażnik `enforce_screening_review` blokuje KAŻDĄ
  aktywację oferty (publikacja, wznowienie, ponowne otwarcie) do akceptacji bieżącej treści
  (`SCREENING_REVIEW_REQUIRED`/`SCREENING_QUESTION_REJECTED: <pozycja>` → komunikat przy pytaniu
  w kreatorze). Zmiana treści/tłumaczenia = nowy odcisk = nowa decyzja; akceptacja nie
  publikuje. Admin: `/admin/pytania` (treść we wszystkich językach, `admin_decide_screening_review`
  — odrzucenie z uzasadnieniem, STALE_STATE dla treści nieobecnej w ofercie, audyt
  `screening_question.reviewed`, powiadomienie in-app dla zapisującego). Dowód: `rls.sql` sekcja
  SR497 (kontrola ujemna: bez strażnika oferta się publikuje); unit `screening-risk`,
  `screening-review`, `screening-review-editor`; E2E `admin-screening-review`,
  `job-wizard-screening`. Teksty komunikatów do akceptacji właściciela.
  Odrzucenie po publikacji (decyzja właściciela 26.09.2026, migracja `0154`):
  przegląd `rejected` bieżącej treści pytania oferty poza szkicem = pytanie UKRYTE, oferta
  zostaje aktywna. `get_public_job_screening_questions` go pomija (ApplyModal i gość; strona
  ISR odświeża się w oknie `revalidate`), `record_screening_answers` po cichu pomija odpowiedź
  na nie (ukryte wymagane nie jest wymagane; klucz spoza oferty nadal `VALIDATION_FAILED`),
  polityka `application_screening_answers_select` ukrywa przed firmą odpowiedzi na treść
  odrzuconą (`screening_answer_hidden` porównuje odcisk snapshotu; kandydat widzi swoje, wiersze
  zostają). Strażnik aktywacji: odrzucone pytanie blokuje tylko publikację szkicu, nie
  wznowienie/ponowne otwarcie. `admin_decide_screening_review` dla oferty poza szkicem: audyt
  `screening_question.hidden` (bez treści) i powiadomienie `system` (`status='hidden'`, tytuł
  `itemScreeningHidden` z prośbą o poprawkę) dla każdego aktywnego recruiter+ firmy. Dowód:
  `rls.sql` sekcja SH497 (kontrole ujemne: polityka 0093, pytanie bez decyzji), integracja
  `portal-screening-banner` (PG16), unit `screening-review`, E2E `tests/e2e-real/screening-hidden`
  (mutacja `screening-hidden-off` = czerwony). **Otwarte (#497):** katalog dopuszczalnych wzorców
  i wyjątków art. 9/10 (właściciel + prawnik), los zapisanych odpowiedzi na ukryte pytania
  (retencja #486), ścieżka poprawienia pytania w opublikowanej ofercie (dziś pytania zmienia
  się tylko w szkicu), zgłoszenie pytania przez kandydata (dziś ogólne zgłoszenie oferty DSA
  #41), e-mail o decyzji, informacja dla kandydata (#61), rejestr (#485).
  Aplikacja bez konta (#98, migracja `0095`, `docs/GUEST_APPLY.md`): gość w ApplyModal
  (`GuestApplyForm`: imię i nazwisko, e-mail, zgoda; reszta opcjonalna) → Turnstile
  `guest_apply` + limity IP/adres → `submit_guest_application` (service_role, zgłoszenie
  `pending` ze snapshotem zgody, e-mail `guestApplicationConfirm` w języku formularza) →
  `/aplikacja/potwierdz` (przycisk, nie GET) → `confirm_guest_application` tworzy aplikację
  z `candidate_id NULL` i snapshotem, powiadamia firmę jak `apply_to_job`, wysyła
  `guestApplicationSent` z linkiem przejęcia → `/aplikacja/przejmij` →
  `claim_guest_application` (kandydat ze zweryfikowanym, tym samym e-mailem; token działa
  raz, ponowienie tego samego konta idempotentne). W bazie tylko hash tokenu; token =
  HMAC(`GUEST_APPLY_SECRET`, cel:nonce), link składa worker. Pracodawca widzi aplikację
  z oznaczeniem „Bez konta” (e-mail, telefon, status); rozmowa i propozycja dopiero po
  przejęciu. Pytania screeningowe (#101) obowiązują także gościa: `record_screening_answers`
  w trybie bez aplikacji waliduje odpowiedzi przy wysłaniu, potwierdzenie zapisuje je do
  `application_screening_answers` (GA98-13). Retencja w `/api/maintenance`: niepotwierdzone 7 dni po ostatnim linku,
  duplikaty 7 dni po potwierdzeniu (z e-mailami), token przejęcia zerowany po 30 dniach.
  Linki (#505): token we fragmencie `#token=` → POST do cookie HttpOnly ścieżki → czysty URL;
  stary format `?token=` odrzucany w middleware (303 bez cookie, „link nieprawidłowy”) —
  `guest-legacy-link.test` z kontrolą ujemną.
  Dowód: `rls.sql` sekcja GA98; unit `guest-apply-*`; E2E `guest-apply.spec` (fixture).
  Zmiana statusu (0122): `transition_application` → `enqueue_guest_status_email` →
  `guestStatusChanged` w języku formularza (`guest_application_requests.locale` — jawnie
  zapisany język odbiorcy bez profilu, Invariant #1), klucz = id wiersza historii, tylko
  potwierdzone zgłoszenie, nieusunięta aplikacja bez konta, adres bez blokady (#44); wiersz
  kolejki = encja aplikacji (retencja #486 usuwa go z aplikacją); payload: imię gościa, firma,
  tytuł, status; CTA lista ofert, bez tokenu i linku wypisania. Dowód: `rls.sql` sekcja GS98
  (kontrole ujemne), unit `guest-status-email`. **Otwarte:** okres retencji do potwierdzenia
  w polityce prywatności (#40).
- [x] Propozycje pracy — **wyłączone w trybie ogłoszeniowym (#1141)** — RPC `send_offer`/`respond_to_offer` (idempotentne, outbox, niezależne od e-maila) + server actions + wpięcie do UI paneli (zweryfikowane na PG)
  Granica wygaśnięcia (0075, #88): `respond_to_offer` odrzuca `expires_at <= now()` — jak odczyt
  i UI. Wyścig accept/decline w dwóch sesjach: jedna wygrywa, druga `VALIDATION_FAILED`, historia
  i alerty pojedyncze (`rls.sql` PP7–PP8).
  Klucz idempotencji = cel propozycji (#853, migracja `0150`): `SendOfferButton`
  trzyma klucz per para oferta + kandydat — zmiana `jobId`/`candidateId` w tej samej instancji
  (przełączenie firmy + `router.refresh()`, lista kandydatów i pulpit) daje nowy klucz i czysty
  stan, retry tej samej pary zachowuje klucz, a odpowiedź dla poprzedniego celu nie oznacza nowej
  oferty jako wysłanej. `send_offer`: klucz znaleziony przy innej parze (także w gałęzi
  `unique_violation`) → `VALIDATION_FAILED` zamiast zwrócenia cudzej propozycji jako sukcesu.
  Dowód: `rls.sql` sekcja SK853 (kontrola ujemna: bez porównania celu klucz zwraca propozycję
  oferty A), unit `send-offer-button` (trzy przypadki #853 czerwone na starym komponencie).
  Termin mija w trakcie wizyty (#830, bez migracji): `ProposalActions` od `expiresAt` nie pozwala
  rozpocząć nowej odpowiedzi, ale nie usuwa bieżącej operacji — trwające żądanie trzyma
  zablokowane przyciski/dialog do wyniku, błąd (zwrócony i wyjątek) zostaje widoczny, otwarte
  potwierdzenie bez żądania zamyka się, a fokus trafia na `role="status"`
  `dashboard.proposalExpiredNotice`. Błąd po terminie odświeża trasę; `status` z serwera
  (`accepted`/`declined`) po własnej próbie zamienia błąd transportu w komunikat sukcesu.
  Etykieta karty zmienia się na „Wygasła” bez serwera (`onExpire` → `CandidateProposalsList`).
  Testy: unit `proposal-actions` (kontrola ujemna: stary komponent = 5 czerwonych),
  `candidate-proposals-list`.
- [~] Wiadomości — **wyłączone w trybie ogłoszeniowym (#1134)** — konwersacje/wątek/wysyłka/przeczytania, zgłoszenia i załączniki gotowe (RPC 0016 + UI `/…/wiadomosci`, zweryfikowane na PG16)
  Zgłoszenia (migracja `0116`): strona rozmowy zgłasza wiadomość drugiej
  strony („Zgłoś” pod dymkiem) albo całą rozmowę (nagłówek wątku) — `ReportContentButton`
  (powód ze słownika `MESSAGE_REPORT_CATEGORIES`, opis ≤ 1000, znacznik treści prawnej „do
  uzupełnienia”) → `reportConversationContent` (limiter 10/h na konto) → RPC pod sesją
  `report_conversation_content`: `reports.kind='message_report'` (cel `message` albo nowy
  `conversation`, `conversation_id`), dostęp jak `is_conversation_member` (obca rozmowa i
  wiadomość spoza niej = `NOT_FOUND`, własna strona = `VALIDATION_FAILED`), dowód budowany w
  bazie z treścią WYŁĄCZNIE zgłoszonej wiadomości (rozmowa: same metadane), widoczny tylko dla
  admina (`reports_select_own` pomija ten rodzaj; stan własnych zgłoszeń bez dowodu —
  `get_my_message_reports`), idempotencja po kluczu (`duplicate`), jedna otwarta sprawa na
  wiadomość i na rozmowę × zgłaszającego (`already_open`, indeksy częściowe + blokada), limit
  20/dobę w bazie, niezmienność każdej roli (`reports_message_report_immutable`). Admin:
  `/admin/zgloszenia?kind=message_report` (dowód, strony, data), rozstrzyga `admin_resolve_report`.
  Dowód: `rls.sql` sekcja MR (kontrole ujemne: obca rozmowa, powtórka, stara polityka),
  unit `message-reports`, `thread-message-list`, E2E `message-report.spec`. **Otwarte:**
  treść prawna i retencja dowodu (#40/#486 — dowód zostaje po usunięciu konta nadawcy),
  powiadomienie zgłaszającego o wyniku, zgłoszenie jako sprawa DSA.
  Załączniki (migracja `0119`): PDF/DOC/DOCX/JPG/PNG ≤ 5 MB, najwyżej 3 na
  wiadomość (`src/lib/validation/message-attachment.ts` — przeglądarka i akcja; magic bytes
  i OOXML w `src/lib/files/message-attachments.ts`). „Dołącz plik” wgrywa plik od razu
  (`uploadMessageAttachment`: `can_attach_in_conversation` → PUT do prywatnego bucketu pod
  `<rozmowa>/att-<uuid>` → `stage_message_attachment`, idempotentnie po `client_upload_id`),
  `send_message(…, p_attachment_ids)` łączy pliki z wiadomością w tej samej transakcji
  (`client_message_id` jak #147; pusta treść tylko z plikiem). Lista w wątku
  (`get_message_attachments`) i pobranie (`get_message_attachment_download`) tylko dla bieżących
  uczestników i wysłanych wiadomości; pobranie = link HMAC 60 s `/api/files/message/<id>?t=`
  (klucz pochodny od `FILE_DOWNLOAD_SECRET`, trasa ponownie sprawdza sesję, dostęp i
  `scan_status`; kwarantanna = brak pobrania). Blokada firmy (#97): strona firmowa nie wgrywa
  plików i nie widzi plików kandydata. Tabela `message_attachments` bez grantów (RPC-only),
  klient nie tworzy/zmienia wierszy `files` załączników (trigger). Usunięcie wiadomości/rozmowy
  (także konta #486) usuwa `files` → `storage_deletion_queue`; niewysłane pliki > 24 h sprząta
  `purge_stale_message_attachments` w `/api/maintenance`. Dowód: `rls.sql` sekcja MA (kontrola
  ujemna: bez strażnika `files` ścieżka zostaje podmieniona); unit `message-attachments-*`.
  Podgląd i e-mail (migracja `0135` — numer tymczasowy): JPG/PNG dopuszczone do pobrania mają
  miniaturę pod nazwą pliku (`MessageAttachmentList` → `AttachmentPreview`): link HMAC 60 s
  z `prepareMessageAttachmentDownload` wystawiany dopiero po wejściu w widok
  (IntersectionObserver), `<img loading="lazy">`, alt `messages.attachmentPreviewAlt` z nazwą;
  kwarantanna, inne typy i błąd linku/obrazu = brak miniatury (nazwa i pobranie zostają).
  `send_message` dokłada do payloadu `newMessage` tylko `attachmentCount` (bez nazw, #503;
  `payload-fields.ts`, mapa danych), strona firmowa zablokowana przez kandydata-nadawcę (#97)
  dostaje 0; e-mail pokazuje „Załączniki w wiadomości: N” (`newMessageAttachmentsLabel`, 1–3).
  Dowód: `rls.sql` sekcja MN135 (kontrola ujemna: bez warunku blokady MN135-4 czerwony), unit
  `message-attachment-preview` (kontrole ujemne: kwarantanna, pole spoza listy workera).
  **Otwarte:** AV (jak CV), podgląd w trybie demo (brak załączników demo).
  Wysyłka idempotentna (0075, #147): `send_message(conversation, body, client_message_id)` —
  `MessageComposer` trzyma jeden UUID na operację danej treści (`useRef`), ponowienie po
  zerwanym połączeniu = ta sama wiadomość bez drugiego powiadomienia/e-maila. Dowód: `rls.sql`
  sekcja PP (retry, dwie równoległe sesje przez dblink, rollback pierwszej próby).
  Izolacja kompozytora między rozmowami (#849, bez migracji): `MessagesView` montuje
  `MessageComposer` z `key={conversationId}` — przełączenie rozmowy w tej samej trasie (bez
  pełnego przeładowania) wcześniej zmieniało tylko prop `conversationId` tej samej instancji,
  więc niewysłany szkic, błąd, gotowe załączniki i klucz idempotencji (#147) zostawały i mogły
  trafić do wysyłki pod nowym adresatem. Klucz per rozmowa wymusza pełny remount (jak już miał
  `ThreadMessageList` przez `key={thread.id}`). Testy: unit `messages-view` (key = `activeParam`
  w drzewie elementów), `message-composer` (harness z przełącznikiem rozmowy: z kluczem szkic
  znika, kontrola ujemna bez klucza pokazuje mechanizm wycieku).
  Odbiorcy powiadomień/e-maili firmowych (aplikacja, wiadomość, odpowiedź na propozycję) = aktywni
  recruiter+ z aktywnym profilem (`company_recipient_ok`, 0070); e-mail o wiadomości od firmy do
  kandydata podpisany nazwą firmy. Dowód: `rls.sql` sekcja LL.
  Nadawca w wątku (#355): profil niewidoczny pod RLS → nazwa firmy dla strony firmowej (strona
  ustalana z `company_members` pod RLS), inaczej etykieta `messages.sender*Fallback`; imienia
  rekrutera nie ujawniamy (0023). Demo wiadomości w języku strony (#359). Stan ładowania listy
  i wątku (#177): `wiadomosci/loading.tsx` + `ConversationOpenPending`, E2E `messages-loading.spec`.
  Podgląd ostatniej wiadomości kandydata (#712): `getLatestMessages` (`candidate.latest-messages`)
  dobiera ostatnią nieusuniętą wiadomość rozmowy przez `ORDER BY m.created_at DESC, m.id DESC`
  (ten sam tie-breaker co w `messages.ts`/`employer.ts`) — remis `created_at` (np. wiadomości
  zapisane w tej samej transakcji/milisekundzie) nie daje już niedeterministycznego podglądu
  i flagi „nieprzeczytane” na pulpicie kandydata. Dowód: `portal-candidate.test.ts` (PG16,
  dwie wiadomości z identycznym `created_at`; kontrola ujemna: cofnięcie `, m.id DESC` = czerwony).

### Etap 6 — komunikacja
- [x] Wybór języka odbiorcy (fallback) — util + test + `resolve_recipient_locale()` w DB (INVARIANT #1 egzekwowany przy kolejkowaniu)
- [~] Kolejka e-mail + worker + ponawianie — outbox (`email_deliveries`: attempts/next_attempt_at/payload), worker `src/lib/email/outbox.ts` + route `/api/email/process` (sekret) gotowe; realna wysyłka wymaga kluczy dostawcy
  Dostawca poczty (decyzja właściciela 25.09): **EmailLabs** domyślnie, Resend jako alternatywa —
  wspólny transport `src/lib/email/transport/` (wybór `EMAIL_PROVIDER=emaillabs|resend`; pusty =
  EmailLabs przy komplecie `EMAILLABS_APP_KEY`/`_SECRET_KEY`/`_SMTP_ACCOUNT`, inaczej Resend;
  jawny bez kluczy albo nieznana wartość = brak wysyłki, bez cichego przełączenia) w obu
  workerach (`email_deliveries` i `auth.email_outbox`). EmailLabs REST v2.1: `messageId` =
  UUID wiersza + domena nadawcy (= `provider_message_id`), deduplikacja ponowień przez
  `GET /v2.1/email?messageId` przed każdą wysyłką (brak Idempotency-Key u dostawcy), ACK tylko
  z tym identyfikatorem w odpowiedzi, `X-TRACKING-OFF: 1`, nagłówki wypisania bez zmian, kody
  `EMAIL_PROVIDER_*` zamiast komunikatu dostawcy. Webhook `POST /api/email/webhook/emaillabs`
  (SHA1 sekret|data|Request-Id; Basic auth wymagany w produkcji — brak `EMAILLABS_WEBHOOK_BASIC_*` = 503, #1234;
  `X-Webhook-Date` w oknie ±24 h, parser tolerancyjny, nieczytelna = 401; inbox `emaillabs:<Request-Id>`
  pamiętany ≥ 7 dni > okno,
  hardbounce → blokada, softbounce/spambounce bez blokady, deferred → opóźnienie, ok →
  delivered). `/api/health`: `emailProvider`, `checks.emailProviderReady`/`emaillabsWebhook`.
  Opis i kroki panelu:
  `docs/EMAILLABS_SETUP.md`. Testy: `emaillabs-transport`, `emaillabs-webhook` (atrapa HTTP,
  kontrola ujemna deduplikacji). **Do zrobienia (właściciel):** domena/DKIM/SPF/DMARC, konto
  SMTP z wyłączonym open trackingiem, własnym wypisem i stopką, klucze API z prawem odczytu
  statusów, webhook, włączenie statusów „OK” u wsparcia, zmienne w Railway.
  Harmonogram: cron Railway (`scripts/railway-cron-call.mjs` → `/api/email/process`), opis w `docs/RESEND_SETUP.md` §6 (#296).
  Błąd konfiguracji nadawcy/dostawcy (#1214, migracja `0192` — numer tymczasowy): kod transportu
  `configuration_error` (zły/nieparsowalny `EMAIL_FROM`, Resend `invalid_from_address`/`*_api_key`/
  `validation_error` o domenie/nadawcy, EmailLabs 401/403 i odrzucenie wskazujące konto SMTP/domenę)
  odkłada ten i pozostałe wiersze paczki o 10 min bez zużycia próby (`EMAIL_PROVIDER_CONFIG`
  w `error_message`, 503 cronu; kolejka kont — `auth.defer_email`); odrzucenie adresata zostaje
  trwałym `failed`. `EMAIL_FROM` bez otaczających cudzysłowów (`emailFromEnv`), nieużywalny =
  worker nie pobiera kolejki, `/api/health` `emailProviderReady: false`, alarm
  `email_sender_invalid`; `ops_metrics().email.configBlocked` → alarm `email_provider_config`.
  Ponowne zakolejkowanie `failed` z N dni: RPC `requeue_failed_email_deliveries` (service_role,
  bez wygaszonych/kampanii/przyjętych, audyt) + `scripts/db/requeue-failed-emails.mjs`. Licznik
  `failedLast24h` bez wygaszonych, osobno `suppressedLast24h` (#1227). Dowód: `rls.sql` sekcja
  OM1227, rollback `0192_…down.sql`, unit `email-config-errors`, `email-outbox-lease`,
  `auth-email-worker`, `emaillabs-transport`. Pule `pg` z `query_timeout` 35 s i TCP keepalive
  (#1229, `db-pool-query-timeout`); retencja R2 liczy tylko kompletne kopie, niekompletne > 24 h
  sprzątane osobno (#1228, `backup-r2`).
  Kontrakt czasu (#731, bez migracji): `/api/email/process` daje obu kolejkom jeden budżet
  `EMAIL_RUN_BUDGET_MS` = 90 s (< limit callera 120 s < dzierżawa 300 s) i sygnał żądania
  (`src/lib/email/run-deadline.ts`); wysyłka startuje tylko z oknem ≥ 25 s do końca budżetu
  i dzierżawy, jej termin nie wykracza poza budżet; rekordy bez próby wracają do kolejki bez
  zużycia próby (`deadlineDeferred`, w auth też `leaseLost`), nie liczą się jako `failed`,
  wynik `ok: false` (503). Test `email-run-deadline` (wolny GET/POST EmailLabs, 20 listów,
  przerwanie, nakładające się przebiegi; kontrole ujemne bez budżetu). Opis `docs/CLOUDFLARE_CRON.md`.
  Zastępczo (plan Railway bez usług cron): Cloudflare Worker z Cron Triggers `infra/cloudflare-cron/`
  (`*/5` → `/api/email/process`, co godzinę → `/api/maintenance`, sekrety jako Worker secrets,
  semantyka i kody jak caller Railway; niewdrożony — kroki właściciela w `docs/CLOUDFLARE_CRON.md`;
  test `cloudflare-cron-worker` z kontrolą bramki hasła).
  Wypisanie i budżety (#45, etap 1, migracja `0087`): token HMAC (`src/lib/email/unsubscribe-token.ts`,
  `EMAIL_UNSUBSCRIBE_SECRET`; UUID konta + kategoria + 180 dni, bez e-maila w URL), link w stopce
  → `/{locale}/wypisz` (noindex, zapis dopiero po kliknięciu), nagłówki `List-Unsubscribe` +
  `List-Unsubscribe-Post` → `POST /api/email/unsubscribe` (RFC 8058, idempotentne RPC
  `email_unsubscribe`, tylko service_role; GET = 303 bez zmian). Kategorie: `src/lib/email/categories.ts`
  = `email_preference_category`; marketing domyślnie wyłączony (`email_allowed`). `claim_email_batch`
  ponownie sprawdza zgodę i wygasza wiersz (`suppressed_at`). Atomowy budżet okna
  (`take_email_send_budget`, rezerwy auth/transakcyjna; odmowa = odłożenie bez `attempts`).
  Dowód: `rls.sql` sekcja UN45 (dblink, kontrole ujemne), `email-unsubscribe.test.ts`, E2E
  `email-unsubscribe.spec`.
  Etap 2 (#45, migracja `0101`): niezmienny dowód zgody
  `email_consent_events` (trigger na `notification_preferences` — każda ścieżka zapisu; źródło
  `settings`/`unsubscribe_page`/`one_click`/`direct`, język, wersja treści `sha256:` z etykiet
  formularza — `src/lib/email/consent-wording.ts`); ustawienia przez RPC
  `set_notification_preferences`, `/wypisz` także „ze wszystkich” (`email_unsubscribe_all`).
  Budżet na odbiorcę przy kolejkowaniu (`email_recipient_budget_config` `pool:`/`template:`,
  domyślnie newsletter 1/dobę, marketing 10/dobę; `INSERT … ON CONFLICT DO UPDATE WHERE used <
  limit`; ponad limit = ślad `suppressed_recipient_budget`; wygaszony list oddaje miejsce).
  `enqueue_email` → `enqueue_email_outcome` (wynik kolejkowania). Kampanie: `email_campaigns`
  (slug + rewizja, treść w każdym języku serwisu) + `email_campaign_recipients` (PK rewizja +
  odbiorca, status reserved/queued/accepted/delivered/skipped_consent/failed/cancelled, bez treści
  i adresu), `enqueue_campaign_batch`/`process_email_campaigns` (cron `/api/maintenance`),
  aktywacja nowej rewizji wygasza niewysłane listy starej, stara nie wraca (`STALE_STATE`),
  claim wygasza listy nieaktywnej rewizji. Worker: newsletter z payloadu kampanii
  (`newsletter-delivery.ts`), `text/plain` w każdym mailu (także hook Auth), marketing tylko z
  jawnym `EMAIL_FROM` + `EMAIL_SENDER_IDENTITY` + `EMAIL_SENDER_POSTAL_ADDRESS`
  (`src/lib/email/sender.ts`, stopka). Hook Auth pobiera budżet puli `auth` (odmowa → 503 +
  `Retry-After`, przed claimem inboxu; błąd bazy = fail-open). Tracking wyłączony; kontrola
  odebranej wiadomości `scripts/check-received-eml.mjs` (`docs/RESEND_SETUP.md`). Dowód:
  `rls.sql` sekcja CM45 (dblink, kontrole ujemne), unit `email-consent-campaigns`.
  **Do zrobienia (właściciel):** wartości `EMAIL_SENDER_*`, wyłączenie trackingu w Resend i
  kontrola odebranego `.eml` na produkcji; treść prawna zgody marketingowej (#40). **Otwarte:**
  prawdziwa pauza z wznowieniem (wymaga zmiany `claim_email_batch`), rejestracja z opt-in marketingu.
  Panel kampanii (#45, migracja `0111`): `/admin/kampanie` — rewizje
  (filtr statusu, slug, kursor) z liczbami odbiorców według statusu (bez adresów),
  `/admin/kampanie/[id]` — podgląd treści w każdym języku (walidacja jak worker,
  `src/lib/admin/campaigns.ts`), rewizje sluga, „Aktywuj rewizję”/„Zatrzymaj wysyłkę” z dialogiem
  (`admin_activate_email_campaign`/`admin_cancel_email_campaign`: is_admin, CAS
  `p_expected_status` → `STALE_STATE`, `INVALID_TRANSITION`, skutek = RPC z 0101, audyt
  `email_campaign.*` bez treści i odbiorców). Bez `EMAIL_FROM` + `EMAIL_SENDER_*` +
  `EMAIL_UNSUBSCRIBE_SECRET` (`campaignSendingReady`): jawny komunikat, akcja aktywacji odmawia
  przed bazą, `/api/maintenance` nie woła `process_email_campaigns`. Dowód: `rls.sql` sekcja
  AC45 (kontrola ujemna bez CAS), unit `admin-email-campaigns` (kontrole ujemne bramki nadawcy),
  E2E `admin-email-campaigns`, `admin-a11y`.
  Edytor rewizji (#45, migracja `0155`): „Nowa kampania” na liście →
  `/admin/kampanie/nowa`, „Nowa rewizja” w szczególe → `/admin/kampanie/[id]/nowa-rewizja`
  (formularz wypełniony treścią tej rewizji, slug stały). `EmailCampaignEditor`: w każdym języku
  serwisu 1–3 oferty (slug, tytuł, miasto, stawka opcjonalnie), treść w kształcie workera
  (`isDemo: false`); walidacja `campaignEditorErrors` (`src/lib/admin/campaign-editor.ts`) =
  reguły pól workera (`src/lib/email/newsletter-rules.ts`, wspólne z `assertRenderableJobs`
  i podglądem `campaignPreview`) + limity długości; brak treści w języku = błąd przy polu, fokus
  na pierwszym błędzie, przełączany podgląd języka (`CampaignPreviewCard`, jak w szczególe),
  jeden klucz idempotencji na operację. Zapis `createEmailCampaignRevision` → RPC
  `admin_create_email_campaign_revision(client_key, slug, content)` (is_admin, `email_campaigns.client_key`
  — ten sam klucz = ta sama rewizja, `email_campaign_jobs_renderable` = lustro reguł workera,
  skutek = `create_email_campaign_revision` z 0101, audyt `email_campaign.revision_created` bez
  treści). Nowa rewizja = szkic; aktywacja i bramka nadawcy bez zmian. Dowód: `rls.sql` sekcja
  AC155 (kontrole ujemne: bez klucza duplikat, bez reguł workera oferta demo), unit
  `admin-campaign-editor` (zgodność z workerem, kontrole ujemne), E2E `admin-email-campaigns`
  (edytor), `admin-a11y` (nowe trasy).
  Równoległe paczki (#906, migracja `0210` — numer tymczasowy): `enqueue_campaign_batch` blokuje
  wiersz kampanii `FOR NO KEY UPDATE` (dawniej `FOR SHARE`), więc druga paczka czeka na pierwszą
  i widzi jej rezerwacje; `completed` tylko, gdy zapytanie nie znalazło nikogo do rezerwacji
  (konflikt nie kończy kampanii). Dowód: `rls.sql` sekcja P2C994 (dblink, limit 1; kontrola
  ujemna: definicja z 0186 kończy kampanię i pomija drugiego odbiorcę).
  Zapis a edycja w toku (#820): `createEmailCampaignRevision` jest idempotentny po `clientKey`
  (retry z tym samym kluczem NIE aktualizuje treści), więc pola edytora muszą być zablokowane
  na czas zapisu — inaczej edycja wpisana w trakcie oczekiwania na odpowiedź serwera ginie po
  cichu (formularz pokazuje nowszą wartość, zapisana i wyświetlona po nawigacji zostaje
  starsza). `EmailCampaignEditor`: pola sluga i treści ofert mają `disabled={pending}`,
  a handlery zmiany stanu (`changeContent`/`setJobField`/`addJob`/`removeJob`, onChange sluga)
  dodatkowo odrzucają aktualizację, gdy `pending` — atrybut `disabled` sam nie blokuje zdarzenia
  wywołanego poza normalną interakcją użytkownika. Dowód: unit
  `email-campaign-editor-pending-edit` (blokada sluga i pola oferty podczas zapisu, kontrola
  ujemna bez zapisu w toku, odblokowanie po błędzie).
  Doręczenia i blokady (#44, migracja `0098`): webhook `POST /api/email/webhook/resend`
  (podpis Svix przez `verifyStandardWebhook`, ±300 s, limit body 256 kB, inbox
  `processed_webhooks` `resend:<svix-id>`, brak `RESEND_WEBHOOK_SECRET` → 503). Model zdarzeń
  niezależny od dostawcy: `src/lib/email/provider-events.ts`. RPC `record_email_event`
  (service_role): status tylko „w górę”, czasy zdarzeń; trwałe odbicie i skarga → aktywna
  blokada w `email_suppressions` (jedna na adres, historia zostaje). `enqueue_email` pomija
  zablokowany adres, `claim_email_batch` wygasza wcześniejsze wiersze (`suppressed_address`).
  E-maile Auth nie są blokowane (obowiązkowe). Panel `/admin/poczta`: lista, filtr, zdjęcie
  blokady z uzasadnieniem (`admin_lift_email_suppression`, audyt). Dowód: `rls.sql` sekcja
  ML44, `email-delivery-webhook.test.ts`, `admin-email-suppressions.test.ts`, E2E
  `admin-email-suppressions.spec`. Alarmy poczty (migracja `0118`):
  sekcja `mail` w `ops_metrics()` (kohorta wysyłki 24 h i 7 dób bazowych, trwałe odbicia,
  skargi, aktywne/nowe blokady — same liczby, rola `pracujbe_ops`), progi w
  `src/lib/ops/sensors.ts` (`mail_*`: odsetek > 5% odbić / 0,3% skarg, wzrost > 2× bazy,
  > 20 nowych blokad; próba ≥ 50 listów) → `/api/health/ops` 503/200; wiek kolejek =
  istniejące `email_queue_age`/`auth_email_queue_age`. Opis `docs/railway/OPERATIONS.md`;
  dowód `rls.sql` OPS44, `ops-metrics` (PG16), `ops-sensors`. **Do zrobienia (#44):**
  kalibracja progów na ruchu produkcyjnym, adapter drugiego dostawcy.
  Minimalizacja treści (#503, migracja `0123`): worker przekazuje do
  szablonu tylko pola z `src/lib/email/payload-fields.ts` (reszta payloadu zostaje w bazie);
  poza listą m.in. podgląd rozmowy (`newMessage.preview`) i wiadomość do propozycji
  (`jobOffer.message`; od 26.09.2026 tylko oczyszczony cytat `messageExcerpt`) — e-mail prowadzi do panelu. `claim_email_batch` ponownie sprawdza
  odbiorcę firmowego (`email_recipient_authorized`: aplikacja/propozycja/wiadomość →
  `company_recipient_ok`; brak obiektu = fail-closed) → `suppressed_recipient_unauthorized`.
  Mapa danych: kolumna „Odrzucane przez workera”. Dowód: `rls.sql` sekcja ES503 (kontrola
  ujemna), unit `email-payload-minimization` (kanarki w 4 językach, kontrola ujemna). Szkic:
  `docs/legal-drafts/poczta-transfer-resend.md`. **Otwarte (właściciel/prawnik):** DPA,
  podprocesorzy, transfer, retencja u dostawcy, tracking na koncie, nazwisko kandydata w
  e-mailu do firmy, bramka konfiguracji dla nieocenionego dostawcy.
- [~] Szablony React Email PL/NL/FR/EN — komplet typów w `src/emails`; pokrycie zdarzeniami w rejestrze
  `src/emails/wiring.ts` (test `email-wiring.test.ts`, #295): kolejka — newApplication, applicationViewed
  (`viewed`), statusChanged, jobOffer, offerAccepted/Declined, newMessage, jobPublished (`publish_job`,
  0073), companyVerified/Rejected/Suspended (`admin_set_company_status`, 0084), jobMatch
  (`process_saved_search_alerts`, 0092, #100), supportContact/contactMessageAdmin (`submit_contact_message`,
  0125, #61); Auth (kolejka Better Auth, #24) — accountConfirmation/passwordReset; magicLink/emailChange/invite wysyłał tylko GoTrue (#27). **Świadomie nieużywane** (brak
  zdarzenia): welcome, contactInvitation, jobExpiring (kreator nie ustawia `expires_at`), payment/invoice
  (#51). Klucz e-maila zmiany statusu = id wiersza historii (0073, #292) — powrót do
  statusu wysyła kolejny e-mail, retry nie. Dowód: `rls.sql` sekcja NN.
  Status aplikacji w mailu = etykieta `status.*` z `src/messages` (nie enum); neutralne warianty
  treści przy braku nazwy nadawcy (`EmailCopy.anonymous`); CTA do sekcji panelu w locale odbiorcy
  (`src/lib/email/delivery-data.ts`); imię odbiorcy w powitaniu (worker czyta `profiles`); e-maile
  Auth: język wg Invariantu #1 (`src/lib/email/auth-email.ts`) i osobne treści magic link/zmiana
  e-maila/zaproszenie. Payloady (0113): `jobOffer` niesie `expiresAt` (= `offers.expires_at`)
  i kwoty oferty (#293, #22), `newMessage` — `conversationId` (CTA do wątku, #290); dowód
  `rls.sql` sekcja PL109 (kontrole ujemne), `email-payload-followups.test`. Treść wiadomości
  rekrutera świadomie poza payloadem (tekst wolny = korespondencja, #503; worker odrzuca pole `message`) — kandydat czyta ją
  w panelu. Krótki cytat (decyzja właściciela 26.09.2026, bez migracji): worker czyta
  `offers.message` w chwili wysyłki i przekazuje do szablonu tylko `messageExcerpt`
  (`src/lib/email/message-excerpt.ts`: e-maile, telefony, NISS/BIS/PESEL, numery kart
  i dokumentów — detektory `src/lib/privacy/sensitive-data.ts` — oraz URL-e → `[…]`, potem
  obcięcie do 200 znaków; po redakcji coś wykryte albo `@` → brak cytatu). `delivery-data`
  oczyszcza pole ponownie, szablon nie przyjmuje pełnego `message`; podpis cytatu
  `jobOfferExcerptLabel` w języku odbiorcy. Błąd odczytu = e-mail bez cytatu. Testy:
  `email-message-excerpt` (kanarki, 4 języki, kontrola ujemna), `email-unsubscribe` (worker).
  Spójność treści (#1093/#1117/#1118): tytuł oferty w `jobOffer`/`statusChanged`/
  `applicationViewed`/`guestStatusChanged` worker czyta w języku odbiorcy
  (`readRecipientJobTitles` w `outbox.ts`: tłumaczenie locale wiersza → język oferty → en →
  `jobs.title`, jak digest 0138; błąd = tytuł z payloadu); potwierdzenie kontaktu dla konta
  w języku konta (migracja `0205` — numer tymczasowy, `rls.sql` CT1093 z kontrolą ujemną,
  rollback `contact-recipient-locale-rollback.sql`); `EmailCopy.single` (digest z jedną ofertą),
  `EmailCopy.reporter` + `appealSubjectLabels` (odwołanie zgłaszającego = numer SPRAWY i CTA
  strony sprawy, autora = numer decyzji i dane firmy); stopka gościa bez „masz konto”; firma
  w PL bez form „(a)”; propozycja = termin panelu (propozycja/voorstel/proposition/proposal);
  gość z `offer_sent` = `guestOfferSentLabel`; newsletter linkuje ustawienia panelu wg
  `profiles.role`; `admin.agePolicySuccessHidden` z ICU plural. Test `email-copy-consistency`.
  Gołe domeny bez schematu (#716): redakcja URL-i w cytacie obejmuje też domeny bez `http(s)://`,
  `www.` ani ścieżki (np. „firma.be”, poddomena, z portem) — ograniczone do wiarygodnej listy
  TLD, żeby nie niszczyć zwykłych skrótów/inicjałów („sp. z o.o.”, „np.”, „itd.”). Dowód:
  `email-message-excerpt` (kanarki gołych domen + kontrola ujemna na zwykłych skrótach).
- [x] Powiadomienia in-app + preferencje — in-app (RPC 0016, dropdown+badge, „oznacz wszystkie") + ekran preferencji `/candidate/ustawienia` i `/employer/ustawienia` (upsert `notification_preferences` pod RLS)
  Pozycje dropdownu są linkami do obiektu (`resolveHref` wg `entity_type` i roli, rozmowa → `?c=`
  tylko dla UUID), otwarcie oznacza jedno powiadomienie; „Zobacz wszystkie” prowadzi do
  pełnej listy (#148).
  Pełna lista (#148): `/candidate/powiadomienia` i `/employer/powiadomienia` (noindex, guard
  layoutu) — `getNotificationsPage` pod sesją/RLS, po 20 kursorem `created_at` + `id`
  (`loadMoreNotifications`, kursor/locale/filtr walidowane), filtr `?nieprzeczytane=1`
  (nawigacja z `aria-current`), oznaczanie pojedynczo i wszystkich (`mark_notifications_read`,
  fokus na tytule/nagłówku, błąd z kodu), cele i tytuły z tych samych `resolveHref`/
  `titleKeyForType` co dropdown, data w Europe/Brussels + czas względny; kalka `panel-styles.ts`.
  Wczytane strony zostają po oznaczeniu i po błędzie kolejnej strony. Bez migracji (indeks
  `idx_notifications_profile`). Dowód: `portal-notifications.test.ts` (PG16: równy
  `created_at` na granicy strony, filtr, obcy kursor; mutacja kursora = czerwony), unit
  `notifications-page`, `notifications-list` (kontrola ujemna bez listy), E2E
  `notifications-list` (4 języki, obie role), `panel-a11y` (nowe trasy).
  Dzwonek (#353): nazwa z liczbą nieprzeczytanych (ICU `notifications.bellLabel`), panel = region
  nazwany tytułem, „Nieprzeczytane” dla czytnika; Escape zamyka i wraca fokusem na dzwonek, wyjście
  fokusem poza panel go zamyka. „Oznacz wszystkie” (#354): `aria-busy` + „Zapisywanie…”, jedno
  wywołanie naraz, błąd `role="alert"` bez refresh, sukces `role="status"` + fokus na tytule.
  Tryb demo (#359): layouty biorą demo z `getNotifications(locale, rola)` (czas przez Intl), bez
  literałów w `DashboardShell`. Ustawienia pracodawcy (#357): własne opisy (`settings.employer*`),
  bez przełącznika dopasowanych ofert, opis powiązany `aria-describedby`.
  Synchronizacja pełnej listy po „oznacz wszystkie” z dzwonka (#825, bez migracji):
  „Oznacz wszystkie” w dzwonku (`DashboardShell`) woła RPC i `router.refresh()` z INNEGO
  komponentu niż pełna lista — `NotificationsList` dostawał świeży `initialPage` z serwera, ale
  lokalny stan (`useState` z montowania) sam się z nim nie uzgadniał: licznik się zerował, a
  wiersze zostawały nieprzeczytane. Efekt reagujący na KOLEJNY (nie pierwszy) `initialPage`
  uzgadnia znane pozycje ze świeżych danych serwera; przy globalnym zerze oznacza WSZYSTKIE
  wczytane strony (także z „Pokaż więcej”) jako przeczytane, a widok `?nieprzeczytane=1` czyści
  do pustego stanu i kasuje kursor „Pokaż więcej” — zgodnie z tym, co pokazałoby świeże otwarcie
  tej samej strony. Widok „wszystkie” nie usuwa wierszy (dane zostają, tylko przeczytane).
  Dowód: unit `notifications-list` (rerender z nowym `initialPage`; kontrola ujemna: identyczny
  obiekt props po raz drugi nic nie zmienia).
  Wiadomości serwisowe a opt-out in-app (#1120, migracja `0221` — numer tymczasowy): filtr
  preferencji (0035) ukrywał też decyzje administratora bez żadnego e-maila (strona WWW/logo,
  opis firmy, treść oferty — `system` + `data.kind` `company_links`/`company_description`/
  `job_content_review`), więc wyłączenie „Powiadomień w aplikacji” gubiło je w każdym kanale.
  `notification_inapp_required` (lustro `src/lib/notifications/service-messages.ts`) przepuszcza
  je mimo `in_app_enabled = false`; reszta bez zmian. Pracodawca widzi w ustawieniach opis
  `settings.employerInAppEnabledDescription` (czego wyłączenie nie ukrywa). Strażnik
  `notification-inapp-service` (najnowsze definicje SQL: każde powiadomienie `system` z `kind`
  w funkcji bez `enqueue_email` = wiadomość serwisowa albo uzasadniony wyjątek rekrutacyjny;
  kontrola ujemna na definicjach sprzed 0221). Dowód: `rls.sql` sekcja NT1120 (kontrola ujemna
  po rollbacku), rollback `0221_…down.sql` (`notification-inapp-service-rollback.sql`).

- [x] Web Push alertów zapisanych wyszukiwań (#724, migracja `0219` — numer tymczasowy; za flagą
  `WEB_PUSH_ENABLED` + klucze VAPID `WEB_PUSH_VAPID_*` ze zmiennych środowiska, domyślnie wyłączone;
  klucze: `node scripts/push/generate-vapid-keys.mjs`). Decyzja produktowa: portal ogłoszeniowy —
  push WYŁĄCZNIE dla `job_match`/`saved_search` (`push_notification_allowed`, propozycje i wiadomości
  nigdy). Rejestr urządzeń `push_subscriptions` (endpoint tylko z listy usług FCM/Mozilla/Windows/Apple
  — `push_endpoint_allowed`, lustro `src/lib/push/endpoint.ts`, ochrona przed SSRF; klucze p256dh/auth;
  etykieta „przeglądarka · system” bez pełnego UA; odczyt własny pod RLS, zapis tylko RPC
  `register_/unregister_/revoke_push_subscription`, kandydat, limit 10 urządzeń, przejęcie endpointu
  przez inne konto wygasza kolejkę poprzedniego, ostatnie wycofane → `push_enabled = false`).
  Kolejka `push_deliveries` z triggera AFTER INSERT na `notifications` (unikat = deduplikacja;
  powiadomienie pominięte filtrem in-app nie ma push), `claim_push_deliveries` (service_role,
  SKIP LOCKED, wygasza po 24 h i przy wyłączonym push/alercie/urządzeniu, język ODBIORCY),
  `finish_push_delivery` (404/410 → urządzenie `gone`, 429/5xx → retry z Retry-After, 5 porażek →
  `failed`), `purge_push_data` (7 dni / 30 dni) w `/api/maintenance` po alertach. Wysyłka bez
  pakietów npm: RFC 8291 `aes128gcm` (`src/lib/push/encrypt.ts`, wektor RFC w teście) i VAPID ES256
  (`vapid.ts`) na `node:crypto`; payload = tytuł/treść z `push.*` i ścieżka panelu, bez nazwy
  wyszukiwania. `public/sw.js`: `push`/`notificationclick` (adres tylko z tego serwisu). UI:
  sekcja `PushNotificationsSettings` w `/candidate/ustawienia` tylko przy włączonej funkcji — zgoda
  przeglądarki dopiero po kliknięciu, stany: brak obsługi, zablokowane, włączone/wyłączone, lista
  urządzeń z usuwaniem. Formularz preferencji bierze `push_enabled` z bazy. Dowód: `rls.sql` sekcja
  WP724 (kontrole ujemne: bramka typu, trigger), rollback `0219_…down.sql` (`web-push-rollback.sql`),
  unit `web-push-crypto`, `web-push-endpoint`, `web-push-worker`, `web-push-actions`,
  `web-push-service-worker`, `push-notifications-settings`. **Otwarte:** metryki dostarczalności
  w `/admin/operacje`, push w eksporcie danych konta (#486), E2E z prawdziwą przeglądarką.

### Etap 7 — admin / prywatność / płatności
- [~] Cookies: baner + kategorie + centrum ustawień + zapis zgód (podstawa)
  Analityka (#570, decyzja właściciela 2026-09-25): Cloudflare Web Analytics (beacon
  bezcookie'owy, `NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN`) zamiast Google Analytics i Meta Pixel —
  usunięte z kodu, CSP, `.env.example`, CI i dokumentacji. Ładowany wyłącznie po zgodzie
  w kategorii `analytics` (`src/components/cookies/Analytics.tsx`), CSP: `static.cloudflareinsights.com`
  (script-src) + `cloudflareinsights.com` (connect-src) — tylko gdy token jest ustawiony; bez
  tokenu (stan startowy, token doda właściciel) beacon się nie ładuje, a CSP nie ma tych hostów.
  Wycofanie zgody przy działającym beaconie (#642, bez migracji): dostawca nie ma API do
  zatrzymania wykonanego skryptu, a `next/script` go nie usuwa — `withdrawLoadedBeacon`
  (`src/lib/analytics/withdraw.ts`) od razu odcina ruch do `*.cloudflareinsights.com`
  w bieżącym dokumencie (CSP `connect-src 'self'` w `<meta>` — działa też na referencje do
  `sendBeacon` trzymane przez skrypt — i zapasowo nakładka na `sendBeacon`), czeka
  najwyżej 3 s na zapis zgody w logu serwerowym (`pendingConsentPersistence`) i przeładowuje
  stronę; po przeładowaniu `AnalyticsWithdrawnNotice` pokazuje jednorazowy komunikat
  (`cookies.analyticsWithdrawnNotice`, znacznik w `sessionStorage`, komponent w osobnym chunku `React.lazy` — budżet JS listy ofert #395). Dowód: unit
  `analytics-withdraw` (kontrole ujemne), E2E `cookie-consent-categories` (atrapa beaconu
  z własną referencją do `sendBeacon` i wysyłką przy `pagehide`: zero pomiarów po wycofaniu,
  także po nawigacji klienckiej). **Otwarte:** wycofanie w innej karcie (zdarzenie zmiany
  zgody działa w obrębie jednej karty).
  Kategoria `marketing` usunięta (decyzja właściciela 25.09 — brak trackerów marketingowych):
  kategorie = necessary/preferences/analytics (`src/lib/consent-cookie.ts`, `CONSENT_CATEGORIES`),
  domyślna `CONSENT_POLICY_VERSION` = `2.0`, więc cookie sprzed zmiany (1.0, z marketingiem)
  jest nieaktualne i baner pyta ponownie. Log zgód: migracja `0130` (numer tymczasowy)
  — `record_consent` zapisuje 3 kategorie, akcja `recordConsent` odrzuca klucze spoza listy;
  wartość `marketing` zostaje w enumie dla historycznych wierszy. Nieużywane klucze
  `cookies.marketingName`/`marketingDesc` usunięte z `src/messages`. Dowód: E2E `cookie-consent-categories.spec`, `smoke.spec`,
  `one-time-link-tracking.spec`, `public-cache-headers.spec`; unit `consent-store.test`,
  `consent-action.test` (kategorie RPC = banera, kontrola ujemna 0043), `csp-report.test`
  (CSP z tokenem i bez), `privacy-data-map.test`; `rls.sql` Y2.
- [x] Panel administratora — `/admin/**` (guard role='admin'→notFound, noindex): dashboard, firmy
  (weryfikuj/odrzuć/zawieś), zgłoszenia (moderacja), użytkownicy; odczyt service-role, zapis przez RPC (0019)
  Każdy odczyt service-role w `src/lib/data/admin.ts` sam potwierdza rolę admina sesji
  (`requireAdmin` → `notFound()`), niezależnie od layoutu. `0076`: pola tożsamości i moderacji
  zgłoszeń ustala baza (trigger `reports_guard`, limity długości), helpery ról bez EXECUTE dla
  anon/PUBLIC (`is_job_company_member` zostaje — polityki anon). Dowód: `rls.sql` sekcja QQ.
  Granica błędu i 404 panelu (bez migracji): `src/app/[locale]/admin/error.tsx`
  (`AdminPanelError`) i `not-found.tsx` (`AdminNotFound`) pod layoutem `/admin` — błąd strony
  albo `notFound()` ze strony/warstwy danych zostawia menu panelu (nieznany adres = catch-all
  `[...rest]`, ogólna 404 jak dotąd); komunikaty `admin.panelError*`/`panelNotFound*`
  (bez ujawniania, czy obiekt istnieje), do kanału błędów sam kod. Guard bez zmian: `notFound()`
  rzucone przez sam layout łapie granica NADRZĘDNA, więc nie-admin nadal widzi ogólną 404, nie
  panelową (strażnik w unit `candidate-admin-panel-boundaries`).
  UX panelu (#415–#418, #420–#423): listy firm/zgłoszeń/użytkowników stronicowane kursorem
  (`created_at`+`id`, 50/stronę, `src/lib/admin/list-params.ts`) z wyszukiwaniem po stronie serwera
  (firmy: nazwa/VAT/KBO/e-mail; użytkownicy: imię/nazwisko/e-mail + filtr roli), parametry w URL.
  Zgłoszenia: filtr statusu (domyślnie otwarte + w analizie), cel z linkiem/podglądem wiadomości
  albo „obiekt usunięty”, powód ze słownika i18n; „Rozwiąż”/„Oddal zgłoszenie” z dialogiem
  potwierdzenia (`AdminConfirmDialog`). Fokus i toast po akcji w `AdminFeedbackProvider`
  (nagłówek wiersza albo strony, nigdy `<body>`). Daty w Europe/Brussels (`src/lib/datetime.ts`).
  Bez dzwonka powiadomień (`DashboardShell showNotifications={false}`). `0081`: macierz przejść
  w `admin_set_company_status`/`admin_resolve_report` + `p_expected_status` (`FOR UPDATE`,
  `STALE_STATE`), firma usunięta → `NOT_FOUND`, ponowne otwarcie zgłoszenia czyści
  `resolved_*`. Dowód: `rls.sql` sekcja ADM; E2E `admin-ux.spec`.
  Lista ofert `/admin/oferty` (bez migracji, tylko odczyt): wszystkie nieusunięte oferty
  wszystkich firm (`listAdminJobs`, `src/lib/data/admin-jobs.ts` → `requireAdmin` przed
  service-role, jedna transakcja, błąd = jawny stan). Filtr statusu EFEKTYWNEGO
  (`src/lib/admin/job-list-params.ts`: aktywna po `expires_at` = wygasła, jak `job-expiry.ts`;
  `moderated` = `jobs.moderation_decision_id`), filtr firmy `?firma=<uuid>` (link „Wszystkie
  oferty firmy” w `/admin/firmy/[id]`, nagłówek z nazwą i link do wszystkich firm),
  wyszukiwanie po tytule/slugu/mieście/nazwie firmy/identyfikatorze, kursor `created_at`+`id`.
  Tytuł linkuje do strony publicznej tylko dla oferty widocznej publicznie (aktywna, przed
  terminem, firma `verified`, nie demo), firma → szczegół firmy, „Historia zmian” → dziennik
  `?entity=job&id=` (nowy typ obiektu `job` i etykiety `job.update_published`/`job.duplicated`;
  wpis o ofercie linkuje do `/admin/oferty?q=<id>`). Oznaczenia: decyzja moderacyjna, dane
  przykładowe. Bez akcji zapisu (decyzje zapadają w `/admin/zgloszenia`). Testy: unit
  `admin-jobs` (kontrole ujemne: bez sesji/pracodawca = 404 bez zapytań, fraza tylko
  w parametrach; mutacja bez `requireAdmin` = czerwony), integracja `portal-admin-jobs` (PG16:
  kursor bez luk przy remisach, status efektywny, filtr firmy), E2E `admin-jobs` (4 języki),
  trasy w `admin-a11y`.
  Szczegół konta `/admin/uzytkownicy/[id]` (tylko odczyt, bez migracji; nazwa na liście = link):
  `getUserDetail` (`requireAdmin` → service_role) — rola, e-mail, stan konta, utworzenie,
  ostatnia aktywność (`last_seen_at`), język e-maili wyznaczony jak w kolejce
  (`resolveRecipientLocale`, Invariant #1) obok surowych `preferred/account/signup_locale`,
  członkostwa w firmach (link do `/admin/firmy/[id]`, rola, dostęp, status firmy), profil
  kandydata jako same liczniki (ukończony, widoczny, zgłoszenia poza szkicem, propozycje — bez
  treści), aktywna blokada adresu (#44, link do `/admin/poczta?q=`), skrót do dziennika
  (`?actor=<e-mail>`). Strona niczego nie zapisuje (brak akcji = brak wpisów audytu); usunięte
  albo nieistniejące konto = „nie znaleziono”, błąd odczytu = ponowienie. `auth.users`
  (np. weryfikacja e-maila) poza zasięgiem service_role — świadomie pominięte. Dowód: unit
  `admin-user-detail` (kontrola ujemna fallbacku języka), integracja `portal-admin` (PG16),
  E2E `admin-ux`, `admin-a11y` (demo-u1/demo-u3).
  Decyzja o firmie (#310, `0084`): szczegół `/admin/firmy/[id]` (`getCompanyDetail`: dane
  rejestrowe, uzasadnienie, członkowie z rolą/aktywnością, najnowsze 20 ofert + licznik), nazwa
  na liście = link. Odrzucenie/zawieszenie wymaga uzasadnienia (≤ 1000 znaków,
  `src/lib/admin/company-review.ts` = te same reguły co RPC), które trafia do
  `companies.status_reason`, `audit_logs.after_data.reason` (widoczne w dzienniku) oraz do
  KAŻDEGO aktywnego właściciela: powiadomienie in-app (`system` + `data.kind='company_status'`,
  weryfikacja = `company_verified`) i e-mail `companyVerified`/`companyRejected`/`companySuspended`
  przez `enqueue_email` (język właściciela, Invariant #1). Dowód: `rls.sql` sekcja AV310;
  unit `admin-company-review`; E2E `admin-company-review.spec`.
  Weryfikacja VAT w VIES (#92, `0088`): sekcja w `/admin/firmy/[id]` — lokalny pre-check
  numeru BE (`src/lib/vies/belgian-vat.ts`: normalizacja, 10 cyfr, suma mod 97; zły zapis nie
  trafia do VIES), adapter REST VIES (`src/lib/vies/client.ts`: timeout 4 s na próbę, 3 próby
  z backoffem i jitterem). Stany: `valid`, `invalid`, `unavailable`, `rate_limited` —
  `invalid` TYLKO przy jawnym `valid:false` w poprawnej odpowiedzi; 429/5xx/timeout/sieć/
  `actionSucceed:false`/kody concurrent-unavailable = brak możliwości weryfikacji, osobne
  teksty. Zapis wyłącznie wyników rozstrzygających (`company_vies_checks`, RPC
  `admin_record_vies_check`, audyt `company.vies_checked` z samym wynikiem); awaria nie
  nadpisuje wcześniejszego wyniku. Porównanie nazwy (`name-match.ts`) = sygnał do ręcznego
  sprawdzenia. Status firmy zmienia tylko admin. Dowód: `rls.sql` sekcja VI92, unit
  `vies-verification` (fixture'y, kontrola ujemna), E2E `admin-vies.spec`; live smoke opt-in
  `VIES_LIVE_SMOKE=1`. Automatyczne sprawdzenie przy zakładaniu firmy (decyzja właściciela
  26.09.2026, migracja `0164`): po `create_first_company` /
  `create_additional_company` / `create_company_with_owner` serwer planuje (`after`, po odpowiedzi)
  `runCompanyViesAutoCheck` (`src/lib/vies/auto-check.ts`: bieżący VAT/KBO → ten sam adapter VIES →
  zapis tylko `valid`/`invalid` przez `record_company_vies_check_auto` — EXECUTE tylko
  service_role, bez nadpisywania istniejącego wyniku, tylko dla bieżącego numeru, `checked_by`
  null, audyt `company.vies_checked` z `source: auto`). Awaria VIES/bazy nie blokuje założenia
  i nie zmienia statusu; wynik widzi admin w `/admin/firmy/[id]`. Odznaki VIES dla kandydatów
  NIE pokazujemy (tylko admin — `docs/PRODUCT_DECISIONS.md`). Dowód: `rls.sql` sekcja VA164
  (kontrole ujemne), unit `company-vies-auto-check` (atrapa VIES, awaria nie blokuje).
  Trwała kolejka (#706/#879, migracja `0191` — numer tymczasowy): trigger na `companies`
  kolejkuje firmę w `company_vies_auto_queue` przy KAŻDYM zapisie nowego prawidłowego numeru
  VAT/KBO bez wyniku dla tego numeru (założenie, dopisanie numeru w `/employer/firma`, zmiana);
  sama zmiana nazwy nie kolejkuje, usunięty numer/firma zdejmuje zadanie, wynik dla bieżącego
  numeru (auto albo admin) też. Worker `processCompanyViesAutoQueue` w `/api/maintenance`
  (≤ 10 na przebieg) + jednorazowa próba po zapisie (`after`): `claim_company_vies_auto_checks`
  (SKIP LOCKED, dzierżawa, ≤ 10 prób), niedostępność/limit/błąd → `finish_company_vies_auto_check`
  z backoffem 5 min × 2^n (≤ 6 h). Wynik dla numeru, którego firma już nie ma, jest zastępowany.
  Admin widzi stan kolejki w sekcji VIES (`admin.viesAuto*`). Dowód: `rls.sql` sekcja VQ976
  (kontrola ujemna: bez triggera dopisany numer nie trafia do kolejki), rollback
  `vies-auto-queue-rollback.sql`, unit `company-vies-auto-check`, `vies-auto-retry-admin`.
- [~] Zgłoszenia treści DSA (#41, migracja `0094`) — przyjęcie sprawy, decyzja z egzekucją
  (#42) i odwołania z retencją i raportem (#43) gotowe; treść prawna i wartości terminów (#40) otwarte. Publiczny formularz `/zglos-tresc?oferta=<slug>[&cel=firma]`
  (linki „Zgłoś ofertę/firmę” na szczególe oferty, także bez konta): limiter → Turnstile `report`
  → Zod → RPC `submit_content_report` (EXECUTE tylko service_role, `reporterId` z sesji). Sprawa
  = `reports.kind='dsa_notice'`: numer `DSA-XXXX-…` (64 bity), kod dostępu z przeglądarki (w bazie
  SHA-256), idempotencja także przy wyścigu, tylko treść publiczna (prywatna = `NOT_FOUND`),
  dowód `target_snapshot` z bazy, niezmienność (trigger dla każdej roli), historia
  `report_events` (także ze zmian w `admin_resolve_report`), limit 5/adres/24 h + jedna otwarta
  sprawa na treść, e-mail `reportReceived` przez outbox w języku zgłaszającego. Status:
  `/zglos-tresc/sprawa` (numer + kod, z linku przez fragment `#`). Panel `/admin/zgloszenia`:
  filtr rodzaju, numer, termin, dowód, kontakt, historia. Dowód: `rls.sql` sekcja DSA41; unit
  `content-report-actions`, `report-received-email`; E2E `content-report`, `content-report-form`
  (fixture). **Do uzupełnienia przez właściciela:** treść prawna (znacznik na stronie
  formularza), katalog kategorii, termin 7 dni i wymagane pola — wg mapy DSA (#40).
  Decyzja moderacyjna (#42, migracja `0099`): sprawę DSA zamyka tylko `admin_decide_report`,
  które w jednej transakcji zapisuje niezmienną decyzję (`moderation_decisions`: rodzaj
  `no_action`/`job_removed`/`company_suspended`, fakty, podstawa regulamin/prawo + wskazanie
  postanowienia, udział automatyzacji, numer `DEC-…`), wykonuje skutek (oferta `closed` /
  firma `suspended` + blokada `moderation_decision_id`, której nie zdejmie żadna zmiana statusu
  — `MODERATION_LOCKED`), zamyka sprawę, dopisuje historię i audyt `moderation.decided`,
  a potem kolejkuje e-maile. Właściciele firmy dostają uzasadnienie w swoim języku, zgłaszający
  sam wynik. Awaria dowolnej części cofa całość. Odroczony trigger odrzuca decyzję bez skutku.
  `admin_resolve_report` nie zamyka już sprawy DSA (regresja z kontrolą ujemną). CAS
  `expected_status` + `FOR UPDATE` (dwie decyzje → `STALE_STATE`). Przywrócenie:
  `admin_restore_moderation` (powód wymagany, blokada przechodzi na inną aktywną decyzję).
  Kolejka: `flag_report_for_review` (service_role — automat tylko flaguje i ustala priorytet).
  UI: dialog decyzji i cofnięcia w `/admin/zgloszenia` (`ModerationDecisionActions`),
  uzasadnienie w `/employer/firma` (`get_company_moderation_decisions`), wynik w
  `/zglos-tresc/sprawa`. Dowód: `rls.sql` sekcja MOD42; unit `moderation-decision*`; E2E
  `admin-ux` (#42). Kolejka według priorytetu: `/admin/zgloszenia?sort=priority|newest`
  (domyślnie `priority` dla `kind=dsa_notice`, `newest` dla reszty) — `review_priority` ↓,
  termin `due_at` ↑ (bez terminu na końcu), `created_at` ↓, `id` ↓; kursor `p1|priorytet|termin|
  created_at|id` (`encode/decodeAdminPriorityCursor`, kursor „najnowsze” = pierwsza strona),
  filtr `?flagged=1` (priorytet > 0 albo opis flagi z `flag_report_for_review`), parametry
  zachowywane we wszystkich linkach listy. Bez migracji (indeks z 0099). Dowód: integracja
  `portal-admin-dsa-queue` (PG16, remisy priorytetu/terminu/czasu; mutacja kursora = czerwony),
  unit `admin-list-params`, E2E `admin-ux`, `admin-a11y`. **Otwarte:** znacznik treści prawnej
  o środkach odwoławczych w panelu firmy.
  Odwołania, terminy, retencja, raport (#43, migracja `0104`): tabela
  `moderation_appeals` (jedno na decyzję, `APL-…`, niezmienne). Autor (owner/admin firmy)
  odwołuje się od ograniczenia w `/employer/firma` (`submit_moderation_appeal` pod sesją),
  zgłaszający od braku działań na `/zglos-tresc/sprawa` (numer + kod, `submit_report_appeal`
  service_role za limiterem); cudza decyzja = `NOT_FOUND`, strony nie widzą swoich danych.
  Termin liczony od POINFORMOWANIA (`moderation_informed_at`: wysłany e-mail o decyzji albo
  odczyt powiadomienia; odbicie się nie liczy; bez poinformowania termin nie biegnie).
  `admin_decide_appeal` w `/admin/odwolania`: autor decyzji nie rozpatruje, gdy jest inny admin
  (`REVIEWER_CONFLICT`, inaczej `same_reviewer`); uwzględnienie odwołania autora cofa
  ograniczenie (`moderation_restore_core`, wspólny z `admin_restore_moderation`), zgłaszającego
  — nowa decyzja z `appeal_id` i egzekucją (sprawa dismissed → resolved tylko tą ścieżką);
  historia, audyt, e-maile `appealReceived/Upheld/Reversed` w języku odbiorcy; awaria cofa
  całość. Retencja: `dsa_retention_report()` (podgląd) i `dsa_retention_run(dry_run)`
  (service_role, `dsa_retention_runs`) anonimizują sprawy dopiero po końcu drogi odwołania
  i okresie retencji — wiersze i liczby zostają. Raport: `dsa_transparency_report` + eksport
  `dsa_statements_export` (bez danych osobowych i faktów) w `/admin/raport-dsa` i
  `GET /api/admin/dsa-report` (CSV/JSON). Oba formaty to KOMPLET zakresu strumieniowany stronami po kursorze
  (#641, #670, `src/lib/admin/dsa-export-stream.ts`, `dsa-csv-stream.ts`, `dsa-json-stream.ts`): bez limitu
  stron i bez `nextCursor` w JSON; błąd bazy albo kursor niepostępujący przerywa odpowiedź (niepełny plik nie
  udaje kompletnego). Dowód: unit `dsa-export-stream` (kontrole ujemne). Opis: `docs/DATABASE.md`. Dowód: `rls.sql` sekcja
  APL43 (kontrole ujemne: jedyny admin, naiwna retencja, flaga bez odwołania); unit
  `moderation-appeals`; E2E `content-report-form` (odwołanie zgłaszającego, fixture),
  `admin-a11y` (nowe trasy). **Zatwierdzone przez właściciela 26.09.2026 (#40):** okno
  odwołania 6 mies., termin rozpatrzenia 14 dni, retencja 12 mies. (funkcje z 0104, strażnik
  `dsa-approved-terms` z kontrolą ujemną). **Do ustalenia:** zakres publikacji i przekazywania
  do bazy DSA, treść prawna o procedurze (prawnik — bez tekstów prawnych w UI). Harmonogram
  czyszczenia: `/api/maintenance` woła `dsa_retention_run` tylko za flagą `DSA_RETENTION_MODE`
  (`dry-run`/`apply`, domyślnie wyłączone, liczniki w odpowiedzi;
  `src/lib/admin/dsa-retention-mode.ts`); na produkcji ustawione `DSA_RETENTION_MODE=dry-run`
  — działa dopiero, gdy cron woła `/api/maintenance`. Odwołanie
  zgłaszającego od cofnięcia ograniczenia (migracja `0109`): ręczne cofnięcie
  wysyła `reportRestored` w języku zgłaszającego, termin od wysłania, formularz na
  `/zglos-tresc/sprawa` (znacznik treści prawnej), `submit_report_restoration_appeal`,
  rozpatruje inny admin niż cofający, uwzględnienie = nowa decyzja; od cofnięcia po odwołaniu
  autora — brak drogi. Dowód: `rls.sql` sekcja RA43. **Otwarte:** włączenie `apply` (po #40),
  retencja `audit_logs` z uzasadnieniami.
  Trwały dowód poinformowania i limity DSA (paczka M-1, migracja `0188` — numer tymczasowy;
  #1037/#1045/#1063/#1098/#1107; terminy 6 mies./14 dni/12 mies. bez zmian, strażnik
  `dsa-approved-terms`): początek biegu terminu odwołania zapisuje niezmienna tabela
  `moderation_informed` (bez grantów; triggery na `email_deliveries` + RPC odczytu decyzji), a nie
  mutowalna tabela powiadomień ani bieżący stan poczty — `email_sent` (odbicie/błąd unieważnia wpis),
  `panel_view` (odczyt decyzji w `get_company_moderation_decisions`; „oznacz jako przeczytane” nie
  liczy się), reguły zastępcze `delivery_failed` (od ostatecznej porażki wysyłki) i `no_recipient`
  (od chwili decyzji/cofnięcia; odroczony trigger przy zatwierdzeniu). Retencja i stan drogi
  odwołania korzystają z tego bez zmian; `dsa_retention_report` ma `informedByFallback`
  (kafelek w `/admin/raport-dsa`). Kod dostępu do sprawy (`reportReceived`) znika z payloadu
  zlecenia, gdy przestaje być oczekujące (strażnik BEFORE INSERT/UPDATE + jednorazowe czyszczenie).
  `submit_content_report`: limit 5/adres/24 h i „jedna otwarta sprawa na treść” pod blokadą
  doradczą per adres + częściowy indeks `reports_dsa_open_uq`. `admin_set_company_status`: zawieszenie
  także z `unverified`/`pending`, z `suspended` również `rejected` (przyciski = macierz bazy,
  test `dsa-informed-limits`). Dowód: `rls.sql` sekcja DSA960 (kontrole ujemne: zdjęty strażnik,
  trigger poczty, trigger zatwierdzenia, indeks; wyścigi dblink), rollback
  `supabase/rollback/0188_…down.sql` + `dsa-informed-rollback.sql`. **Otwarte (poza M-1):** blokada
  wiersza przy „Kopiuj jako szkic”, odpowiedź na propozycję (wyłączona), zgłoszenie wiadomości
  „otwórz ponownie” (#1107 pkt 2).
  Nieaktywny administrator nie blokuje rozpatrzenia (#909, migracja `0179`,
  `create or replace` tej samej sygnatury `admin_decide_appeal` co 0109): „inny administrator”
  dla `REVIEWER_CONFLICT` (RPC) i dla podglądu konfliktu w kolejce (`listAppeals` →
  `admin-dsa.other-admins`, `src/lib/data/admin-dsa.ts`) wymaga teraz `is_active = true`, nie
  tylko `role = 'admin' AND deleted_at IS NULL`. Konto wyłączone operacyjnie (bez zmiany roli)
  nie liczy się już jako dostępny drugi recenzent — autor pierwotnej decyzji może rozpatrzyć
  odwołanie, gdy jedyny inny admin nie może się zalogować. Testy: integracyjny PG16
  `portal-appeals.test.ts` (wyłączenie `is_active`, brak konfliktu, decyzja przechodzi,
  przywrócenie), unit `moderation-appeals.test.ts` (SQL migracji i zapytania zawierają
  `is_active = true`; kontrola ujemna: stara treść 0109 bez tego warunku).
  Anonimizacja i trwały termin (migracja `0197` — numer tymczasowy, #860/#887): #860 domyka
  dowód `moderation_informed` z 0188 (usunięcie konta strony nie przywraca odwołania i nie
  blokuje retencji sprawy; 0197 nie zmienia definicji 0188, regresję pilnuje DI860).
  `moderation_restore_core` po blokadzie sprawy odrzuca
  cofnięcie sprawy zanonimizowanej (`CASE_REDACTED`, bez zapisu i skutków); panel
  (`AdminDsaCase.redactedAt` → `ModerationDecisionActions redacted`) pokazuje
  `admin.moderationCaseRedacted` zamiast akcji. Dowód: `rls.sql` sekcja RD973 (DI860/RR887,
  kontrole ujemne: bez trwałego dowodu, rdzeń bez kontroli), rollback
  `retention-dsa-0197-rollback.sql`, unit `moderation-decision-actions`.
  Cel formularza odwołania = snapshot udanego odczytu (#884, bez migracji):
  `ReportCaseLookup` przechowuje numer sprawy i kod dostępu, którymi POWIODŁO SIĘ sprawdzenie
  (`reportTarget`, ustawiany razem z `report`), zamiast czytać `getValues()` z pól formularza
  przy renderze `AppealForm` — edycja pól po odpowiedzi (albo podczas oczekiwania na nią, bez
  wysłania drugiego odczytu) nie zmienia już celu odwołania na inną sprawę. Oba pola
  dodatkowo `disabled` podczas `isSubmitting` (obrona w głąb). Dowód: unit
  `report-case-lookup-appeal-target` (kontrola: bez edycji celuje w A; regresja: edycja na B
  podczas oczekiwania na A nadal celuje w A — czerwony na kodzie sprzed naprawy; pola
  zablokowane podczas oczekiwania).
- [~] Rejestr naruszeń RODO (#490, migracja `0106`): `/admin/naruszenia`
  (tylko admin). Wpis = incydent bezpieczeństwa albo naruszenie danych osobowych: czas
  stwierdzenia (termin 72 h liczony od niego — `breachDeadline` w `src/lib/admin/breach.ts`),
  opis, kategorie danych, liczba osób, ocena ryzyka, decyzje art. 33/34 z uzasadnieniem, daty
  zgłoszeń, przyczyny opóźnienia po 72 h, działania, zamknięcie. Reguły (sprzeczność decyzji
  z ryzykiem, wymagane uzasadnienia) w `breach_incident_validate` + CHECK-i i w lustrze TS
  `breachFormErrors`. Zapis wyłącznie RPC `admin_*_breach_*` (is_admin, CAS `version` →
  `STALE_STATE`, idempotentne `client_key`, audyt bez treści). Historia `breach_incident_events`
  i wpisy niezmienne dla każdej roli (trigger; bez DELETE/TRUNCATE). Eksport JSON/CSV
  `POST /api/admin/breaches/[id]/export` (RPC zapisuje eksport w historii; `GET` = 405, wyłącznie
  odczyt nie mutuje — #603). Zawiadomienie osób:
  `admin_notify_breach_subjects` → outbox `breachNotice` — treść wpisuje admin dla każdego
  języka odbiorców; brak wersji w języku któregoś odbiorcy = nic nie wychodzi (Invariant #1).
  Dowód: `rls.sql` sekcja BR490 (kontrole ujemne), unit `breach-register`, E2E `admin-breaches`.
  Szkic procedury (nieopublikowany): `docs/legal-drafts/procedura-naruszen.md`. **Do zrobienia
  (właściciel/prawnik):** role i kontakty dyżuru, organ i portal, treść zawiadomień, tabletop,
  zatwierdzenie procedury; okres przechowywania wpisów.
  Ponowienie zapisu po utraconej odpowiedzi (#835, bez migracji): `admin_create_breach_incident`
  przy trafieniu na już zajęty `client_key` zawsze zwraca wcześniej zapisany wiersz — retry
  z NIEZMIENIONĄ treścią jest w porządku (Invariant #11), ale retry z treścią POPRAWIONĄ między
  próbami wcześniej po cichu porzucał tę poprawkę. `createBreachIncident` (`src/lib/actions/breaches.ts`)
  po odpowiedzi RPC odczytuje zapisany wiersz service-rolem i porównuje go z właśnie wysłanym
  formularzem (`breachFormsMatch`/`breachFormFromRow`, `src/lib/admin/breach.ts` — porównanie po
  normalizacji jak w bazie: przycięte teksty, posortowane kategorie, instant zamiast tekstu daty);
  różnica → `problem: 'clientKeyReused'` z `id`/`existingVersion` istniejącego wpisu zamiast cichego
  sukcesu. `BreachIncidentForm` pokazuje komunikat i link do istniejącego wpisu oraz przycisk
  „Zapisz poprawki jako edycję” (`updateBreachIncident` z CAS po wersji) — poprawka trafia do
  bazy jako jawna edycja, nie znika. Odczyt porównawczy jest best-effort (błąd → brak konfliktu,
  nie blokuje zwykłego zapisu). Dowód: unit `breach-register` (`#835` — retry bez zmian = sukces,
  retry ze zmianą = konflikt z wersją, kontrola ujemna: awaria odczytu porównawczego nie blokuje
  zapisu; `breachFormsMatch` — zgodność po normalizacji i wykrycie różnicy pól).
  Jesienna zmiana czasu (#1112, bez migracji): `appLocalInputToUtc(value, previousIso)` —
  niezmienione pole `datetime-local` w niejednoznacznej godzinie 02:00–03:00 zwraca zapisaną
  chwilę zamiast przesunięcia o godzinę (formularz podaje wartości z `initial`). Dowód: unit
  `breach-register` (kontrola ujemna: bez podpowiedzi oba wystąpienia dają tę samą chwilę).
  Wspólny `csvCell` (#876, bez migracji): neutralizacja formuł arkusza rozszerzona o wiodący LF
  (`\n`) i pełnoszerokie warianty operatorów (`＝ ＋ － ＠`) — poprzedni regex `/^[=+\-@\t\r]/`
  pomijał oba przypadki z listy OWASP CSV Injection, więc kontrolowana wartość zaczynająca się
  od LF przed formułą (np. w uzasadnieniu wpisu) trafiała do eksportu bez prefiksu `'`. Jeden
  helper obsługuje eksport rejestru naruszeń (`breachExportCsv`) i eksport dziennika audytu
  (`auditExportCsv`, #841) — poprawka obejmuje oba. Dowód: unit `breach-register` (kontrole
  ujemne: LF, każdy pełnoszeroki wariant, zwykły tekst z `=` nie na początku zostaje bez zmian).
- [~] Mapa danych osobowych (#485/#488/#503/#504, część techniczna): `node scripts/privacy/data-map.mjs`
  generuje `docs/legal-drafts/data-map.generated.md` z migracji produkcyjnych (parser
  `scripts/privacy/schema.mjs`), klasyfikacji `src/lib/privacy/data-map.ts` (każda tabela, kategorie,
  czynności) i usług `src/lib/privacy/processors.ts` (rola/region/transfer/DPA = „DO UZUPEŁNIENIA”);
  sekcja e-maili = klucze payloadu z aktualnych funkcji SQL (`email-payloads.mjs`). Test
  `privacy-data-map.test.ts`: tabela bez wpisu albo kolumna wyglądająca na PII (np. `email`) bez
  klasyfikacji = czerwony, plik nieaktualny = czerwony, payload z CV/odpowiedziami/treścią wiadomości
  = czerwony (kontrole ujemne). Szkice `docs/legal-drafts/rejestr-czynnosci.md` i
  `dostawcy-i-transfery.md` — PROJEKT, nieopublikowany, nic w UI. **Do ustalenia (właściciel +
  prawnik):** administrator, role portal/pracodawca, podstawy, retencja, DPA i transfery.
- [x] Audit logs — triggery AFTER (0017) na applications/offers/companies + `write_audit`; actor=auth.uid()
  Podgląd w panelu (#417): `/admin/dziennik` (tylko odczyt, `listAuditLogs` → `requireAdmin`) —
  data w Europe/Brussels, aktor (nazwa albo „System”), akcja i statusy jako etykiety i18n,
  obiekt z linkiem; filtry typu obiektu, akcji, aktora, zakresu dat i `id` (skrót „Historia
  statusów” w wierszu firmy), stronicowanie kursorem.
  Filtr aktora (#857/#844, bez migracji): tekst po imieniu/nazwisku/e-mailu filtruje dziennik
  podzapytaniem `actor_id IN (SELECT … FROM profiles …)` w tym samym zapytaniu (lista i eksport,
  wspólne `readAuditRows`) — bez pośredniej listy najwyżej 100 id, więc przy ponad 100 pasujących
  kontach żaden wpis nie znika. Dowód: `portal-admin` (PG16, 120 kont, kontrola ujemna dawnego
  kroku z `LIMIT 100`), unit `admin-data-load`, `admin-audit-export`.
  Eksport CSV/JSON (bez migracji): przyciski „Eksport CSV/JSON” (`AuditExportButton`, klucze
  `admin.auditExport*`) → `POST /api/admin/audit-export?format=&entity=&action=&actor=&from=&to=&id=`
  — te same filtry i walidacja co lista (wspólny odczyt `readAuditRows` w `src/lib/data/admin.ts`),
  od najnowszego, najwyżej `AUDIT_EXPORT_LIMIT` = 10 000 wierszy (obcięcie: nagłówek
  `X-Export-Truncated`, w CSV ostatni wiersz `#truncated,10000`, w JSON `truncated`, komunikat
  w UI). Rola admina sprawdzana w `exportAuditLogs` (brak sesji/inna rola/demo → 404), `Origin` tej
  witryny (inaczej 403), `no-store`, `GET` = 405. Kolumny = to, co pokazuje lista (czas w
  Europe/Brussels z przesunięciem, akcja, obiekt, statusy, uzasadnienie, aktor jako nazwa albo
  „System”; bez e-maili i id aktorów), komórki przez `csvCell` (neutralizacja `= + - @`) —
  `src/lib/admin/audit-export.ts`. Każdy eksport w tej samej transakcji zapisuje wpis
  `audit_log.exported` (aktor = admin; tylko format, liczba wierszy, obcięcie i rodzaj filtrów —
  bez frazy aktora i treści wpisów); awaria zapisu = brak eksportu. Test: `admin-audit-export`
  (kontrole ujemne: nie-admin 404, GET 405, obcy Origin 403, formuła w CSV, limit bez obcięcia).
- [~] Retencja i prawa kandydata (#486, migracja `0105`, `docs/DATA_RETENTION.md`):
  okresy jako dane (`retention_policies`, null = kategoria wyłączona; zmiana tylko
  `admin_set_retention_policy` z audytem, rejestr usunięć ≥ 400 dni). `/api/maintenance` woła
  `run_retention_purge` (partie, SKIP LOCKED, liczniki) i worker kolejki storage
  (`src/lib/storage-deletion.ts`; `storage_deletion_queue` wypełnia trigger AFTER DELETE na `files`,
  backoff, brak ścieżek w logach). Domyślnie włączone tylko sprzątanie danych już oznaczonych
  (`deleted_file`, `deleted_profile` — 30 dni); reszta czeka na decyzję administratora danych.
  `confirmed_guest_request` = tylko wartość do decyzji właściciela (bez zadania, ślad gościa zostaje
  także przy `closed_application`); tokeny gościa czyści `purge_guest_application_requests` (#522).
  Eksport JSON (`POST /api/account/export`, Origin tej witryny, `no-store` → `export_my_data`:
  dane podane, proces, zapisane `matches`, rozmowy z `fromMe` bez tożsamości rekrutera, limit
  10/dobę, ślad `data_rights_requests` + audyt). Usunięcie konta (`request_account_erasure`,
  potwierdzenie adresem konta): jedna transakcja `erase_candidate_subject` — proces widoczny
  dla firm, powiadomienia/e-maile o nim, pliki → kolejka, `auth.users` (kaskada), tombstone;
  sprawy DSA zostają bez powiązania (`reports_guard`/`report_events_append_only` przepuszczają
  tylko FK → null). Tombstone po restore: `scripts/db/export-erasure-tombstones.sh` +
  `RESTORE_TOMBSTONES_FILE` w `restore-backup.sh` (`apply_erasure_tombstones`). UI: sekcja
  „Twoje dane i konto” w `/candidate/ustawienia` (`AccountDataSettings`, klucze `accountData.*`
  — tylko etykiety funkcji). Dowód: `rls.sql` sekcja DR486 (kontrole ujemne 5/5b/7f/9),
  `npm run test:backup` (scenariusz #486), unit `account-data`, `storage-deletion`, E2E
  `candidate-account-data`. Szkic dla prawnika (PROJEKT, nieopublikowany):
  `docs/legal-drafts/retencja-i-prawa-kandydata.md`. **Otwarte:** zatwierdzone okresy i treść
  dla kandydatów (#61), cron `/api/maintenance` i eksport rejestru usunięć (#13),
  sprostowanie/ograniczenie/sprzeciw, potwierdzenie linkiem e-mail.
  Konto pracodawcy (migracja `0161`, `docs/DATA_RETENTION.md` §5a): sekcja
  „Twoje dane i konto” w `/employer/ustawienia` (ten sam `AccountDataSettings`,
  `variant="employer"`; trasa `/api/account/export` i `deleteMyAccountAction` wybierają RPC po
  roli sesji). Eksport `export_my_employer_data` (konto, profil, profil pracodawcy, członkostwa,
  zaproszenia wysłane i otrzymane, utworzone oferty, akcje audytowe jako aktor — bez
  `before/after_data`, identyfikator tylko obiektów firmowych; powiadomienia bez treści; bez
  danych kandydatów; limit i ślad wspólne z kandydatem). Usunięcie
  `request_employer_account_erasure` (potwierdzenie adresem) → `erase_employer_subject`:
  ostatni AKTYWNY właściciel którejkolwiek firmy → `COMPANY_LAST_OWNER` (komunikat
  `accountData.deleteLastOwner`: najpierw przekaż rolę albo zamknij firmę) i nic się nie
  zmienia; inaczej członkostwa, e-maile do osoby, jej pliki (poza załącznikami rozmów),
  sesje i konto znikają, dane firmy (oferty, propozycje, wiadomości, zaproszenia) zostają
  z FK → null, audyt z `actor_id = null`, tombstone; restore (`apply_erasure_tombstones`)
  wybiera funkcję po roli. `enforce_offer_integrity` przepuszcza wyłącznie `sender_id → null`.
  Zaproszenia na adres osoby (#1233, migracja `0202`): oczekujące → `revoked`, adres zerowany we wszystkich
  (`company_invitations.email` nullable, CHECK `company_invitations_email_when_pending`), e-maile rejestracyjne
  tych zaproszeń usunięte z kolejki; wiersz = ślad zdarzenia. Dowód: `rls.sql` OD981 (kontrola ujemna).
  Dowód: `rls.sql` sekcja ER161 (kontrole ujemne: ostatni właściciel bez kontroli — firma bez
  właściciela, stara reguła propozycji wywraca usunięcie, cudzy adres nic nie usuwa), unit
  `account-data`. Odwołania i zgłoszenia w eksporcie (#1232, migracja `0207` — numer
  tymczasowy): `export_my_employer_data` = 0161 + `moderationAppeals` (kształt jak u kandydata)
  i `contentReports` (zgłoszenia treści złożone przez osobę: numer, rodzaj, kategoria, opis,
  podane dane kontaktowe, stan — bez `target_id`/`target_snapshot` i kodu dostępu); dowód
  `rls.sql` sekcja EX1232 (kontrola ujemna: definicja z 0161), rollback
  `0207_…down.sql` (`employer-export-0207-rollback.sql`); `contact_messages` poza eksportem
  (decyzja otwarta). **Otwarte:** pracodawca bez aktywnego członkostwa nie wejdzie do ustawień,
  samoobsługowe zamknięcie firmy, retencja nieaktywnych kont pracodawców.
  Wartości z opracowania 2026-09-25 (#574, migracja `0127` — numer tymczasowy): okresy w
  `retention_policies` (pliki/profile oznaczone 7 dni łącznie z obiektem, aplikacje i ich
  rozmowy 180 dni od niezmiennego `applications.closed_at` — każdy stan końcowy, także `hired`;
  CV 365 i konto 730 dni bez aktywności z ostrzeżeniem 30 dni — e-maile `inactiveCvWarning`/
  `inactiveAccountWarning` w języku odbiorcy, `retention_warnings`; ukrycie profilu 180; gość
  30/7, IP/UA 7; wnioski 1095; wartości bez zadania: zgody 1095, audyt 365, logi 30, kopie 14,
  kolumna `enforcement`). `last_seen_at` z triggera na `auth.sessions` (logowanie/odświeżenie,
  raz na godzinę). **Harmonogram WYŁĄCZONY:** `/api/maintenance` woła `run_retention_purge`
  tylko przy `RETENTION_MODE=dry-run|apply` (`src/lib/retention/mode.ts`; dry-run = podtransakcja
  wycofana, apply = kolejne partie po 200 dopóki `fullBatches` > 0, najwyżej 10). Kolejka
  storage: dead-letter po 20 próbach, `requeue_storage_dead_letters`, `ops_metrics().storageDeletion`
  + czujki `storage_deletion_age` (> 24 h) i `storage_deletion_dead_letter`. Dowód: `rls.sql`
  sekcja RV574 (kontrole ujemne), unit `guest-apply-maintenance`, `ops-sensors`,
  `retention-warning-email`. **Otwarte (#574):** włączenie `RETENTION_MODE` (właściciel), minimum
  rejestru usunięć po RET-09/RET-10, zadania dla zgód/audytu/`auth.email_outbox`/e-maili,
  kopie liczone w dniach (`backup.sh`), konto pracodawcy, język gościa na aplikacji (#546).
  Termin z ostrzeżenia dotrzymany (migracja `0197` — numer tymczasowy, #784): CV i konto
  nieaktywnego kandydata usuwane dopiero od `retention_warnings.due_at` (dawniej
  `due_at - storage_physical_deletion`, czyli do 72 h przed datą z e-maila); okres fizycznego
  usunięcia dotyczy tylko danych już oznaczonych i kolejki storage. Dowód: `rls.sql` RD784
  (termin za 2 dni / teraz / wczoraj; kontrola ujemna: dawny warunek usuwa przed terminem).
  Podgląd w panelu admina (bez migracji): `/admin/ustawienia/retencja` (link z
  `/admin/ustawienia`), TYLKO ODCZYT — każda kategoria `retention_policies` z etykietą i opisem
  z `adminRetention.keys.*` (PL/NL/FR/EN), okres i ostrzeżenie w dniach („wyłączone” = null),
  kto pilnuje terminu (`enforcement`) i ostatnia zmiana z dziennika (`retention.policy_changed`,
  aktor po nazwie); tryby crona `RETENTION_MODE`/`DSA_RETENTION_MODE`/`STORAGE_GC_MODE`
  odczytane TYMI SAMYMI funkcjami co `/api/maintenance` (`readRetentionModes`). Odczyt
  `getRetentionOverview` (`src/lib/data/admin-retention.ts`) service-rolem po `requireAdmin`;
  demo = wartości z migracji 0127/0132. Dziennik: typ obiektu `retention_policy` i etykiety akcji
  `retention.policy_changed`/`retention.policies_seeded`. Strona nie zmienia okresów ani trybów
  (decyzja administratora danych). Testy: unit `admin-retention` (kontrole ujemne: nie-admin bez
  odczytu, literówka trybu nie włącza usuwania; strażnik: kategorie z migracji = klucze
  tłumaczeń w 4 językach), E2E `admin-retention` (4 języki), trasa w `admin-a11y`.
  **Otwarte:** edycja okresu z panelu (RPC 0105 bez uzasadnienia i CAS — osobna migracja).
  Wydłużenie okresu po wysłanym ostrzeżeniu (#862, migracja `0182`):
  `admin_set_retention_policy` synchronizuje teraz `due_at` już zapisanych `retention_warnings`
  danej kategorii do co najmniej `activity_at + nowy_okres` (`greatest()`, nigdy nie obniża) —
  wcześniej zmieniała wyłącznie `retention_policies.period`, więc wydłużenie okresu PO wysłaniu
  ostrzeżenia (e-mail z konkretną datą) nie odraczało terminu i `run_retention_purge` wciąż kasował
  CV/konto wg starego, krótszego `due_at`. Skrócenie okresu też nie cofa już ustalonego, dłuższego
  terminu (nie przyspiesza usunięcia ponad to, co już obiecano). Dowód: `rls.sql` sekcja RW862
  (kontrola ujemna: goła zmiana `retention_policies.period` bez przejścia przez RPC nadal gubi CV).
- [x] Płatności — **USUNIĘTE w bezpłatnym MVP (#51, `docs/PRODUCT_DECISIONS.md`).** Portal bez
  cennika, pakietów, CTA zakupu i sprzedaży; `/employer/platnosci` → przekierowanie na `/employer`,
  brak trasy cennika (404), brak linków w nawigacji/stopce/sitemap, `/api/stripe/webhook` nie istnieje
  (404). Martwy schemat i kod billingu usunięte (decyzja właściciela 28.09.2026, migracja `0177` —
  na 0176): tabele `subscriptions`/`payments`/`invoices`/`discount_codes`/
  `checkout_intents`/`discount_redemptions`, RPC `reserve/finalize_discount`,
  `release_stale_discount_reservations`, `begin/complete_checkout`, `release_checkout_intent`,
  `release_stale_checkout_intents`, kolumna `companies.provider_customer_id`, typy
  `subscription_status`/`payment_status`/`invoice_status`; z kodu `src/lib/stripe.ts`,
  `src/lib/billing/flag.ts` (`BILLING_ENABLED`), `src/lib/data/billing.ts`, `src/lib/actions/billing.ts`,
  trasa webhooka, czujka `readinessChecks().stripe`, zadania `/api/maintenance` po rabatach i checkoutach
  (odpowiedź bez `releasedDiscounts`/`releasedCheckouts`), liczniki `staleDiscountReservations`/
  `staleCheckoutIntents` w `ops_metrics()` i czujkach, `STRIPE_*`/`BILLING_ENABLED` z `.env.example`
  (w `KONFIGURACJA_PRODUKCJI.md` §2D zostają jako „nie ustawiać”). **Zostaje (aktywne):**
  `plan_entitlements` + `company_max_active_jobs` + `get_company_entitlements` + limit aktywnych ofert
  (`ENTITLEMENT_LIMIT` → `errors.activeJobLimit`); `company_plan()` nie czyta już subskrypcji i zawsze
  zwraca `free` (zachowanie bez zmian — subskrypcji nigdy nie było); `processed_webhooks` (inbox poczty);
  kod błędu `BILLING_UNAVAILABLE` z komunikatem; dawne klucze `billing.*`/`pricing.*` w `src/messages`
  bez użycia; zależność npm `stripe` (do osobnego kroku). Parser mapy danych
  (`scripts/privacy/schema.mjs`) rozumie `drop table` i `drop column`. Powrót monetyzacji = nowa
  decyzja właściciela + osobny projekt. Dowód: `rls.sql` sekcja Z (brak obiektów, `company_plan` =
  free, limit 1, kontrola ujemna w teście rollbacku), `supabase/tests/billing-schema-rollback.sql`
  (rollback `0177_…down.sql` odtwarza schemat i działanie; wpięty przed 0176/0171 w
  `portal-legal-mode-rollback.sql`), unit `billing-disabled` (strażnik: brak plików i odwołań do
  billingu w `src/`, kontrola ujemna wzorca), `ops-sensors`, `privacy-data-map`,
  `free-mvp-ui.test`, `sitemap-robots.test`, E2E `free-mvp-no-sales.spec` (4 języki).

### Etap 7 — hardening operacyjny (bezpieczeństwo/CI)
- [~] CSP (P2-01, #585) — `next.config.mjs` (default/object/frame-ancestors/base/form-action +
  zawężone connect/img/font, Cloudflare Web Analytics od #570 (zamiast GA/Meta, usunięte); bez
  Sentry od #571). Analiza: `docs/CSP_NONCE_ANALYSIS.md` — inwentarz inline skryptów/stylów z
  buildu (pomiar Report-Only `scripts/security/csp-inline-inventory.mjs`, poza CI; test
  `csp-inline-inventory`): blokują chunki i ładunek RSC Next.js (nonce tylko per żądanie — koniec
  ISR, hash niemożliwy), skrypt banera zgód (hash albo nonce), atrybuty `style` (next/image, paski
  postępu) i `<noscript><style>`; JSON-LD i skrypty wstawiane dynamicznie (beacon CF, Turnstile)
  nie blokują. **Próba usunięcia `'unsafe-inline'` ze `script-src` zweryfikowana i COFNIĘTA** po
  realnym buildzie (`next build` + `next start`, Chromium): bez niego skrypty RSC są blokowane
  i hydracja każdej strony się psuje. Enforced `script-src` ZOSTAJE z `'unsafe-inline'` (bez
  regresji); produkcja dostaje RÓWNOLEGŁY `Content-Security-Policy-Report-Only` z tą samą
  dyrektywą, ale hashem (bez `unsafe-inline`) dla skryptu banera zgód w `<head>` (jedno źródło
  treści: `src/lib/security/csp-inline-scripts.mjs`; beacon CF jest zewnętrzny, bez treści
  inline) — obserwowalny krok, nie pełne zamknięcie #585. Report-Only raportuje do osobnej grupy
  `csp-report-only` (`/api/csp-report?policy=report-only`) z własnymi limitami (10 żądań/min
  z adresu, 60 wpisów/min na proces; wpis `disposition=report` zawsze w tym budżecie), więc
  szum skryptów RSC nie wypiera raportów egzekwowanej polityki (test `csp-report`). Dowód:
  `tests/unit/csp-inline-scripts.test.ts` (enforced bez regresji, Report-Only z hashem i kontrolą
  ujemną). **Otwarte (decyzja właściciela):** warianty A–D z analizy (nonce + rezygnacja z ISR
  na stronach publicznych = regres wydajności, sprzeczne z #298/#395).
- [~] Narzędzia i konfiguracja (audyt CFG29, #1121, bez migracji). `@react-email/*` w `dependencies`
  (#1175). Typecheck specyfikacji Playwrighta: `tsconfig.e2e.json` (rozszerza `tsconfig.json`,
  z tymi samymi `strict` i `noUncheckedIndexedAccess`) wołany przez `npm run typecheck` (job
  „Typecheck” bez zmian). Komunikaty w specach typowane strukturą `src/messages/pl.json`
  (`Messages` z `tests/e2e/fixtures/messages.ts`, import tylko typu) — literówka albo usunięty
  klucz = błąd typecheck; wartości z indeksu przez `defined(value, 'opis')`
  (`tests/e2e/fixtures/defined.ts`, czytelny błąd zamiast `!`). Strażnik
  `scripts/check-ci-workflows.mjs` pilnuje skryptu, zakresu i tego, że `tsconfig.e2e.json` nie
  wyłącza `noUncheckedIndexedAccess`/`strict` (kontrole ujemne w `ci-workflows-guard.test`). `EMAIL_REPLY_TO` jest czytany (`replyToFromEnv`, `sender.ts`):
  nagłówek Reply-To we wszystkich listach obu workerów (kolejka domenowa i kont; Resend
  `replyTo`, EmailLabs nagłówek), zła wartość albo wstrzyknięcie CRLF = bez nagłówka, bez
  wartości domyślnej (`email-reply-to.test`, kontrole ujemne). Limit Server Actions 6 MB
  zostaje globalny (Next nie ma go per akcja), ale middleware odrzuca 413 żądanie Server Action
  spoza paneli z `Content-Length` > 256 KB (`src/lib/http/public-action-body-limit.ts`,
  `public-action-body-limit.test`; bez `Content-Length` decyduje limit Next). Zależności:
  martwych pakietów już nie ma (`stripe`, `prettier-plugin-tailwindcss`, `@radix-ui/react-slot`
  usunięte wcześniej; każdy wpis `package.json` ma import albo użycie w konfiguracji — strażnik
  `dependencies-used.test` z listą wyjątków bez importu sprawdzanych w pliku konfiguracji i kontrolami ujemnymi),
  `npm audit --package-lock-only` = 0. `next lint` zastąpione `eslint` CLI (ESLint 8), lint
  obejmuje pliki konfiguracyjne. **Otwarte:** ESLint 9 (flat config, nowe `node_modules` —
  osobny krok z pełną instalacją).
- [x] Utwardzenia logowania (#1090, bez migracji; limity na konto i sesja przy potwierdzeniu
  w #1176, linki resetu w 0185): automatyczne logowanie z linku potwierdzającego tylko
  w przeglądarce, która założyła konto albo podała poprawne hasło niepotwierdzonego konta —
  cookie HttpOnly `pb_signup_browser` = HMAC adresu (`src/lib/auth/signup-browser.ts`, sekret
  Better Auth), inaczej adres potwierdzony, sesja cofnięta, logowanie ręczne; tryb
  `TRUSTED_PROXY_HEADER=cf-connecting-ip` przyjmuje `CF-Connecting-IP` tylko, gdy peer
  z `X-Real-IP` należy do zakresów Cloudflare (ominięcie Cloudflare = adres peera, połączenie
  z Cloudflare bez nagłówka = `null`); zakresy pobierane automatycznie (decyzja właściciela
  30.09.2026, `src/lib/http/cloudflare-ranges.ts`: ips-v4/ips-v6, timeout 3 s, każda linia =
  CIDR właściwej rodziny, lista pusta/krótka odrzucona, cache w procesie TTL 24 h,
  single-flight, odświeżanie w tle — żądanie nie czeka; błąd = ostatnia dobra lista, bez niej
  `CLOUDFLARE_IP_RANGES` w kodzie; po błędzie przerwa 5 min; test `cloudflare-ranges`); guardy paneli bez sesji kierują na `/logowanie?next=<strona panelu>`
  (middleware podaje ścieżkę w nagłówku żądania `x-pracujbe-return-path`, wartość od klienta
  usuwana; `safeNextPath` przy odczycie). Dowód: unit `auth-confirm-email`, `auth-email-kick`,
  `trusted-ip`, `cloudflare-ranges`, `middleware-panel-return-path`, `panel-guards-production` (kontrole ujemne).
- [x] Readiness: minimalna długość `BETTER_AUTH_SECRET` (#873). `isAuthRuntimeConfigured()`
  sprawdzała tylko obecność sekretu — produkcja mogła zostać uznana za gotową
  (`readinessChecks().auth`/`isAppReady()` = true) z sekretem krótszym niż wymagane 32 znaki,
  mimo że `createAuthServer` (`src/lib/auth/server.ts`) i tak odrzuca taką wartość w runtime
  (`dependencies.secret.trim().length < 32`). `isAuthRuntimeConfigured()` liczy teraz tę samą
  długość po `trim()` — fail-closed zamiast fałszywej gotowości. Dowód:
  `tests/unit/auth-secret-length.test.ts` (pozytywne 32 znaki, kontrole ujemne: 31 znaków, z
  otaczającymi spacjami, pusty sekret, `isAppReady()` z resztą rdzenia gotową).
- [x] Utwardzenie warstwy danych (audyt 2026-09-28, #1033/#1034/#1089/#1091/#1090, migracja `0185` —
  numer tymczasowy, rollback `supabase/rollback/0185_…down.sql`, bez zmian w trybie ogłoszeniowym):
  (1) usuwanie ofert: polityka `jobs_delete_member` pozwala roli klienta usunąć WYŁĄCZNIE szkic bez
  decyzji moderacyjnej i bez rekordów procesu (`job_has_process_records`: zgłoszenia, propozycje,
  dopasowania, zgłoszenia gościa, zapisane oferty); opublikowana oferta = zamknięcie/wygaśnięcie;
  każde usunięcie (także service_role/migracja) zapisuje audyt `job.deleted` (aktor, status, firma,
  slug — bez treści; etykieta w dzienniku admina); (2) firmy: numer rejestrowy zweryfikowanej firmy
  cofa weryfikację jak VAT, `slug`/`is_demo`/`deleted_at`/`created_at` niezmienne
  dla roli klienta (`guard_company_immutable_fields`), a bramki blokady moderacyjnej (oferta i firma)
  nie ufają samej fladze sesji `pracujbe.moderation` — działa tylko poza rolą klienta (RPC decyzji są
  definerami); (3) `files`: rola klienta tworzy plik tylko prywatny, w folderze własnego `owner_id`,
  ze statusem skanu `pending`/`skipped`, a po utworzeniu właściciel/bucket/ścieżka/typ i id encji/
  widoczność/status skanu/suma kontrolna/MIME/rozmiar są niezmienne (`guard_files_client_write`);
  `is_admin()` wymaga aktywnego i nieusuniętego profilu; `count_other_active_owners` bez EXECUTE dla
  ról klienta (strażnik `enforce_owner_invariants` liczy właścicieli zapytaniem inline pod RLS);
  (4) sesje i tokeny konta: kategorie retencji `expired_auth_session` i `expired_auth_verification`
  (7 dni po wygaśnięciu, krok `retention_purge_auth_batch` w `run_retention_purge`, jak reszta za
  `RETENTION_MODE`), usunięcie konta (`auth.users`) każdą ścieżką kasuje tokeny resetu hasła
  (`auth.verifications.value` + `reset-password:*`) i weryfikacje po adresie e-mail
  (`trg_auth_users_delete_cleanup`); (5) ustawienie/zmiana hasła (`auth.accounts`, `credential`)
  unieważnia pozostałe linki resetu konta i wycofuje niewysłane listy resetu z `auth.email_outbox`
  (`trg_auth_accounts_invalidate_reset_links`; wykorzystany link zużywa Better Auth). Strona statusu
  sprawy DSA (`/zglos-tresc/sprawa`, kod dostępu we fragmencie) wyłączona z analityki
  (`src/lib/analytics/route-policy.ts`). Dowód: `rls.sql` sekcja M2RD (kontrole ujemne: polityka 0033,
  strażnik 0084, bramki 0099, `is_admin` z 0019, brak triggerów), rollback `rls-data-hardening-rollback.sql`
  (w `scripts/test-rls.sh`), unit `analytics-route-policy`, `admin-retention`, `admin-jobs`, integracja
  `auth-actions` (dwa linki resetu). Eksport kandydata (#1091, migracja `0218` — numer tymczasowy):
  `export_my_data` dopisuje `contentReports` (zgłoszenia treści złożone przez kandydata, bez zgłoszonej
  treści, `target_id` i kodu dostępu; kształt jak w eksporcie pracodawcy) i `retentionWarnings`
  (wysłane ostrzeżenia retencji z terminem); dowód `rls.sql` sekcja CX1091 (kontrole ujemne: bez filtra
  właściciela, rollback 0218), rollback `candidate-export-reports-rollback.sql`. **Otwarte (#1091):**
  historia widoczności profilu w eksporcie (funkcja wyłączona w trybie ogłoszeniowym); (#1090): pozostałe punkty zamknięte w #1176.
- [~] Wydajność bazy i nazwy bez znaków sterujących (audyt 29.09, #1245/#1244/#1096, migracja `0206` — numer
  tymczasowy, rollback `supabase/rollback/0206_…down.sql`): indeksy pod usuwanie konta i kaskady FK
  (`notifications`/`email_deliveries` po `entity_id`, `saved_search_alerts.profile_id`, kolumny aktora
  `jobs.created_by`, `offers.sender_id`, historie statusów, `conversations.created_by`,
  `contact_messages.sender_id`, `auth.email_outbox.user_id`). Nazwa zapisanego wyszukiwania i firmy bez
  znaków sterujących (C0, DEL, C1): `save_saved_search` = reguła `rename_saved_search`, CHECK
  `saved_searches_name_no_control`/`companies_name_no_control` (istniejące wiersze oczyszczone), Zod
  `NO_CONTROL_CHARS_REGEX` (`src/lib/validation/text.ts`, komunikat `company.error.nameInvalid`), temat
  e-maila jednowierszowy (`toSingleLineHeader` w `renderEmail` i w obu transportach). Szczegół oferty
  i profil firmy czytają bazę raz na żądanie (`cache()` wspólne dla `generateMetadata` i strony); pula
  domenowa domyślnie 10 połączeń, `DATABASE_APP_POOL_MAX` (1–50). Dowód: `rls.sql` sekcja DBP1245/CC1244
  (plany z indeksem; kontrole ujemne: bez indeksu, definicja z 0092 i bez CHECK), test
  `db-perf-control-chars-rollback.sql`, unit `control-chars-names`, `runtime-pool-config`. **Otwarte:**
  #1215 (plan generyczny publicznych RPC listy — po #1259, który redefiniuje te funkcje), polityka RLS
  `matches` (#1096 pkt 3; matching wyłączony w trybie ogłoszeniowym), pozostałe kolumny aktora.
- [x] Middleware i SEO-meta (audyt 2026-09-28, bez migracji): matcher `src/middleware.ts` (#1035) nie pomija już
  ścieżek z kropką w segmencie (`/pl/oferty-pracy/a.b` szło do tras dynamicznych z pominięciem bramki hasła
  i 503 „niegotowe”) — wyłączone są tylko `api|auth|_next|_vercel|images|.well-known` (granica segmentu),
  jawna lista plików z korzenia, `/sitemap/<n>.xml` i `/<locale>/manifest.webmanifest`; drugi matcher
  przepuszcza każde żądanie z nagłówkiem `next-action`. Strażnik `middleware-matcher.test.ts` (każdy plik
  z `public/` musi omijać middleware; kontrola ujemna dawnego wzorca; kompilacja przez Next). `alternateLinks:
  false` w `src/i18n/routing.ts` (#1057): brak nagłówka HTTP `Link` z hreflang (jego `x-default` bez prefiksu
  języka był sprzeczny z metadata i sitemapą; test uruchamia prawdziwe middleware next-intl w podprocesie).
  `src/lib/seo/locales.ts` (#1084/#1097): jedno źródło `og:locale` (`język_KRAJ` + `alternateLocale`) dla
  wszystkich stron z własnym `openGraph` oraz `pickXDefaultLocale` (kolejność `routing.locales`, nie
  kolejność z bazy) dla sitemapy i hreflang oferty. Sitemap (#1042, krok 1): zostaje `force-dynamic`
  (prerender w buildzie zamroziłby pustą listę partii), ale wynik pliku i lista partii są w pamięci procesu
  3600 s z single-flight (`src/lib/cache/sitemap-cache.ts`; błąd i wynik zdegradowany nie są cache'owane).
  **Otwarte (#1042):** RPC kursorowe bez licznika (migracja); druga linia obrony (helper bramki w publicznych
  Server Actions, #1035).
- [x] Rate limiting aplikacyjny — RPC `rate_limit_hit` (`0015`) wpięty w auth/apply/wiadomości.
  Odporność osobnej bazy limitera (#608): `checkDatabaseRateLimit` (`src/lib/db/rate-limit.ts`)
  zwraca `boolean` wyłącznie dla rzeczywistej odpowiedzi RPC (`allowed`/`limited`); błędna
  konfiguracja wywołania i każda awaria (połączenie/transakcja/`SET LOCAL ROLE`/RPC/COMMIT)
  rzuca `RateLimitUnavailableError` zamiast być cicho zamienianą na „przekroczono limit”.
  `checkRateLimit` (`src/lib/rate-limit.ts`) łapie ten wyjątek i stosuje politykę per akcję
  (wzorem `src/lib/turnstile/policy.ts`): `FAIL_SAFE_ACTIONS` (auth, płatne API, publiczne
  formularze wysyłające e-maile) blokuje; pozostałe akcje przechodzą (fail-open) — awaria/
  rotacja loginu osobnej bazy limitera nie odcina już zwykłych akcji (wiadomości, ustawienia,
  edycja firmy) dla wszystkich użytkowników. Testy: `rate-limit-postgres` (jednostkowy,
  atrapa rzuca), `rate-limit` integracyjny (PG16 w Dockerze: pula zwykłej roli, odebrane
  `EXECUTE`, zamknięta pula i błędne parametry → wyjątek, nie `false`).
  Bramka dostępu — limit rozmiaru body przed parsowaniem (#911, bez migracji): `POST
  /api/site-access` czytał całe `request.formData()` (bez ograniczenia rozmiaru ani czasu
  odczytu) zanim sprawdzał, czy bramka jest w ogóle aktywna, i zanim liczył próbę w limiterze
  (#584/#625) — duże albo wolno przesyłane żądanie z jednym dużym polem formularza zużywało
  pamięć/CPU procesu przed jakąkolwiek odpowiedzią, także przy wyłączonej bramce. Naprawa:
  `readTextWithLimit` (już używane przez webhooki poczty i `/api/csp-report`, #`P2-05`) czyta
  strumień z twardym limitem 4 KiB — deklarowany `Content-Length` I faktycznie odebrane bajty,
  działa też bez tego nagłówka (chunked) — i przerywa PRZED przekroczeniem limitu; dopiero
  zmieszczone w limicie body trafia do `formData()` (przez odtworzony `Request` z tym samym
  `content-type`, więc nadal obsługuje urlencoded i multipart). Nad limitem → `413` z komunikatem
  `siteAccess.payloadTooLarge` (PL/NL/FR/EN), bez porównania hasła, bez wołania limitera i
  niezależnie od tego, czy `SITE_ACCESS_PASSWORD` jest w ogóle ustawione. Dowód: unit
  `site-access.test.ts` (body bez `Content-Length` nad limitem, deklarowany `Content-Length` nad
  limitem ze strumieniem, który nigdy się nie kończy — czyli obietnica, że handler NIE czyta go
  w całości, bramka wyłączona nadal odrzuca, kontrola ujemna: body w granicach limitu bez zmian).
  Healthcheck: single-flight nie gubi trwającego zapytania po lokalnym timeoncie (#645, bez
  migracji): `GET /api/health` (#600/#624) dzielił RÓWNOLEGŁE `pool.query('SELECT 1')` przez
  `ttl-single-flight.ts`, ale obietnica trzymana jako `inFlight` była wynikiem `Promise.race`
  z lokalnym timeoutem 2 s — gdy baza odpowiadała wolniej, wyścig kończył się (i `finally`
  zdejmował wpis `inFlight`) ZANIM realne zapytanie faktycznie się skończyło, więc kolejne,
  pozornie odrębne żądanie w tym samym oknie otwierało NASTĘPNE zapytanie na tej samej,
  być może przeciążonej puli — dokładnie to, co #600 miało ograniczać. Naprawa w
  `src/app/api/health/route.ts`: `pingCache.run` trzyma teraz BEZ TIMEOUTU realną obietnicę
  zapytania (`pingDatabaseQuery`), a `Promise.race` z timeoutem jest na zewnątrz, tylko dla
  odpowiedzi TEGO żądania — przegrana wyścigu nie kończy ani nie odłącza dzielonej obietnicy,
  która nadal blokuje nowe zapytanie, dopóki `pool.query` faktycznie się nie rozstrzygnie.
  Dowód: `tests/unit/health-route.test.ts` (żądanie po lokalnym timeoncie nie mnoży zapytań,
  dopóki poprzednie trwa; kontrola ujemna — bez naprawy test łapie regresję: drugie zapytanie
  mimo wciąż trwającego pierwszego).
  Wspólny limit aplikacji/wiadomości po IP (#852, bez migracji): `applyToJob`/`sendMessage`
  liczyły limit (`checkRateLimit('apply'|'message', …)`) TYLKO po adresie IP i PRZED sprawdzeniem
  sesji — anonimowe wywołanie (bez konta, np. bezpośrednio do Server Action) zdążało zużyć
  wspólny bucket przed odrzuceniem, blokując realnych, zalogowanych użytkowników za tym samym
  NAT/CGNAT/biurem. Naprawa: sesja PRZED limitem (brak konta = `UNAUTHENTICATED`/
  `PERMISSION_DENIED` bez dotknięcia jakiegokolwiek licznika), limit biznesowy (20 aplikacji /
  60 wiadomości na godz.) liczony PER KONTO (`identifier: me.id, perIp: false`) — dwa konta za
  tym samym adresem mają niezależne budżety, jedno konto nie omija limitu zmieniając sieć.
  Dodatkowa, znacznie szersza ochrona przed automatyzacją wielu kont z jednego adresu zostaje
  jako osobny, wyższy próg (`apply-ip` 200/godz., `message-ip` 600/godz.) — nie blokuje
  populacji współdzielącej IP po zwykłym użyciu limitu jednej osoby. Dowód: unit
  `rate-limit-account-scope` (limit budowany z identyfikatora konta, anonimowe wywołanie zero
  wywołań limitera, dwa konta = dwa niezależne klucze, kontrola ujemna: przekroczenie limitu
  konta nadal blokuje).
- [~] AI Act / art. 22 / DPIA i ePrivacy lejka (#489, #499) — część techniczna: inwentarz
  funkcji AI jako dane (`src/lib/ai/inventory.ts`; strażnik `ai-inventory.test` skanuje
  `src/`+`scripts/`, wywołanie modelu bez wpisu = czerwony test, kontrola ujemna; pliki
  matchingu/statusu/screeningu nie mogą wołać modelu), log użycia AI bez treści/PII
  (`src/lib/ai/usage-log.ts`, wpięty w import ogłoszeń), dokumentacja lejka `docs/JOB_FUNNEL.md`
  i E2E `job-funnel-no-storage` (fixture: bez zgody zero żądań; po zgodzie zero cookies/storage
  i żądanie bez `Cookie`). Wariant zgody lejka rozstrzygnięty (#575: tylko po zgodzie analitycznej).
  Szkice NIEOPUBLIKOWANE: `docs/legal-drafts/ai-act-art22-dpia.md`, `eprivacy-lejek.md`.
  **Otwarte (decyzja prawnika/właściciela):** klasyfikacja, DPIA tak/nie (tłumaczenia #514 są
  już w logu użycia i inwentarzu).
- [x] Cloudflare Turnstile (#46) — logowanie/rejestracja/reset: siteverify w Server Actions
  (`src/lib/turnstile/verify.ts`: akcja, hostname, jednorazowość, timeout 5 s), polityka awarii
  per przepływ (`policy.ts`: login fail-open, reszta fail-closed), widżet `TurnstileWidget`.
  Bez kluczy poza produkcją = wyłączony; w produkcji brak kluczy = fail-closed rejestracji/resetu.
  CSP: `challenges.cloudflare.com` (script/frame). Opis: `docs/TURNSTILE.md`. Polityka `report`
  chroni formularz zgłoszenia treści (#41), polityka `contact` — formularz kontaktu (#61).
- [~] Operacje #47 (część kodowa, migracja `0096`): czujki `GET /api/health/ops` — tylko z
  `HEALTH_CHECK_SECRET` (inaczej 404), same liczby z `ops_metrics()` (rola `pracujbe_ops` bez praw
  do tabel; login `DATABASE_OPS_URL`, pula `ops` w `pool.ts`, fallback service-role), progi w
  `src/lib/ops/sensors.ts` (wiek kolejek e-mail/auth, porzucone dzierżawy, zawieszone webhooki,
  opóźnienie maintenance, 80% połączeń) → 503 `alert` / 200 = recovery. Kopia zaszyfrowana `age`
  z manifestem i retencją (`scripts/db/backup.sh`) + odtworzenie z porównaniem sum
  (`restore-backup.sh`), test `npm run test:backup` (PG16, 8 kontroli ujemnych; nie w CI).
  Kopia poza Railwayem (#569): `backup.sh` z `BACKUP_S3_*` wysyła artefakt, potem manifest do
  prywatnego bucketu Cloudflare R2 (API S3, region `auto`; `scripts/db/lib/backup-s3.mjs` + czysta
  logika `backup-s3-core.mjs`; odmowa, gdy wskazuje bucket/klucz CV `AWS_*`) i przycina retencję
  w buckecie (`BACKUP_RETENTION`, opcjonalnie `BACKUP_S3_MAX_AGE_DAYS`; najnowsza kompletna
  zostaje). `restore-backup.sh` z `RESTORE_S3_OBJECT=latest` pobiera kluczem odczytu. Czujka
  `backup` w `/api/health/ops` (`src/lib/ops/backup-freshness.ts`, klucz odczytu
  `BACKUP_S3_READ_*`): każdy stan poza `ok` — też `unconfigured` i klucz zapisu w usłudze web
  (`misconfigured`) — to alarm `backup_*`. Obraz usługi cron `docker/backup/Dockerfile` (node 22,
  pg 18, `age`). Dowód: `backup-r2.test` (atrapa S3 `tests/helpers/fake-s3-server.mjs`, klucz
  odczytu nie zapisze), `backup-r2-image.test`, `ops-health-route.test`, scenariusz R2 w
  `npm run test:backup`.
  Obraz kopii w CI (#751, bez migracji): osobny workflow `backup-image.yml` (poza `ci.yml`, nie
  blokuje wdrożenia web; przy zmianie `docker/backup/**`/skryptów, ręcznie, co tydzień) buduje
  `docker/backup/Dockerfile` od zera (`--pull --no-cache`), smoke `scripts/db/backup-image-smoke.sh`
  (uid ≠ 0, node 22, pg_* 18, `age`, SDK S3 = `package.json`, bez npm/npx/yarn — usunięte z obrazu,
  start bez konfiguracji = kod 2 bez wypisania wartości), SBOM CycloneDX + skan Trivy (obraz
  przypięty do wersji i digestu) jako artefakt; bramka `scripts/security/backup-image-scan.mjs`
  (`scripts/lib/backup-image-scan-outcome.mjs`): HIGH/CRITICAL z dostępną poprawką = kod 1, chyba
  że terminowy (≤ 90 dni) wyjątek w `docker/backup/vulnerability-exceptions.json`; raport bez
  pakietów Debiana/Node, niepełny SBOM albo awaria skanera = kod 2. Obraz bazowy
  `node:22-bookworm-slim@sha256:…`, digest aktualizuje Dependabot (`.github/dependabot.yml`).
  Strażnik `check-ci-workflows.mjs` (job, kroki, digest skanera i `FROM`). Dowód: unit
  `backup-image-scan`, `backup-image-smoke` (atrapa docker), `backup-r2-image`, `ci-workflows-guard`
  (kontrole ujemne). Runbook: `docs/railway/BACKUP_RESTORE.md` (pochodzenie przed wdrożeniem). **Do zrobienia (właściciel):** bucket bez domeny publicznej i `r2.dev`,
  dwa tokeny, usługa `backup` w Railway, zmienne (`BACKUP_RESTORE.md`).
  Rozpoznanie bezpośredniego uruchomienia CLI (#925): `backup-s3.mjs` porównuje
  `import.meta.url` z `pathToFileURL(process.argv[1]).href` (nie z ręcznie zbudowanym
  `file://${process.argv[1]}`) — ścieżka repozytorium/wdrożenia ze spacją (albo innym znakiem
  kodowanym w URL) już nie powodowała cichego pominięcia `main()` i fałszywego kodu 0
  (`backup.sh` raportowałby wtedy sukces R2 bez żadnej wysyłki). Dowód:
  `backup-r2-space-path.test` (prawdziwy podproces z repozytorium skopiowanym do katalogu ze
  spacją; kontrola ujemna: ta sama ścieżka bez spacji ma ten sam kontrakt).
  Zgodność schematu z kodem (#1065, migracja `0184` — numer tymczasowy): build zapisuje najwyższą
  migrację (`PRACUJBE_EXPECTED_MIGRATION` z `next.config.mjs`, `scripts/db/expected-migration.mjs`),
  `public.ops_schema_state()` (EXECUTE tylko `pracujbe_ops`/`service_role`) zwraca liczbę i najwyższą
  nazwę z `app_migrations.history`, a `/api/health/ops` (`src/lib/ops/schema-state.ts`) alarmuje
  `schema_behind_code` (baza za kodem albo bez funkcji) i `schema_state_unreadable`; baza nowsza
  od kodu (rollback wdrożenia) nie jest alarmem, sekcja `schema` podaje nazwy migracji. Publiczny
  `/api/health` celowo bez porównania (nie wstrzymuje wdrożenia) — `docs/railway/WDROZENIE_MIGRACJI.md`.
  Dowód: `rls.sql` sekcja SS1065, unit `ops-schema-state`, integracja `portal-service`.
  `idx_jobs_city_trgm` + pomiar `npm run db:search-benchmark` (PG16/PG18). Dowód: `rls.sql`
  sekcja OPS47, `tests/integration/ops-metrics.test.ts`. Runbook i kroki właściciela:
  `docs/railway/OPERATIONS.md`. **Otwarte:** konfiguracja infrastruktury (sekret, login, uptime,
  cron kopii/odtworzenia), odmiana i aliasy miast w SQL.
  Panel `/admin/operacje` (migracja `0180`): strona tylko do odczytu (noindex,
  `requireAdmin` → 404 dla innej roli, bez dzwonka, link „Stan operacyjny” w nawigacji) z tymi
  samymi liczbami i stanami co `/api/health/ops` — wspólny odczyt `readOpsStatus`
  (`src/lib/ops/status.ts`: pula `ops`, zapasowo service-role), wiersze z `src/lib/ops/dashboard.ts`
  (wartość, próg, stan słowem; stan WYŁĄCZNIE z `alerts`/`warnings` czujek, brak sekcji = „brak
  danych”, nigdy „OK”): kolejki e-mail/auth (wiek najstarszego, dzierżawy, nieudane), webhooki,
  maintenance, kolejka storage (dead-letter), poczta, budżet AI, połączenia/pula, kopia. Ostatni
  przebieg maintenance: `/api/maintenance` na końcu (także nieudanego) woła `record_ops_job_run`
  (service_role) → `ops_job_runs` (jeden wiersz, czas/wynik/czas trwania/stała nazwa zadania
  z błędem), odczyt `ops_last_maintenance_run()` (`pracujbe_ops`/service_role) → czujki
  `maintenance_run_stale` (alarm > 2 h), `maintenance_run_missing`/`_failed`/`_unavailable`
  (ostrzeżenia; brak przebiegu nie daje stałego 503), pole `maintenanceRun` w `/api/health/ops`.
  Bez danych osobowych i sekretów; tryb demo = przykładowy stan oznaczony. Dowód: `rls.sql` sekcja
  OPSM (kontrola ujemna bez GRANT), unit `admin-ops-dashboard` (każdy sygnał ma wiersz — z kontrolą
  ujemną; nie-admin → 404 przed odczytem), `job-expiry`, `ops-health-route`, integracja
  `portal-service`, E2E `admin-operations` (4 języki, axe 320 px/200%), `admin-a11y`. Opis:
  `docs/railway/OPERATIONS.md` §1.
  Blokada sieci w testach Vitest (#47): `tests/setup.ts` (setupFiles obu projektów, także
  `chromium`) instaluje `tests/helpers/network-guard.ts` — `net.Socket#connect` (http/https/tls/
  undici/`fetch`/`pg`) i `globalThis.fetch` do hosta spoza localhost/127.0.0.0/8/::1 i
  `TEST_NETWORK_ALLOW` (przecinki) → `NetworkBlockedError` z podpowiedzią atrapy; gniazda Unix
  dozwolone; połączenie z własnym `lookup` (atrapa DNS, np. `jobs.test` w safe-fetch) sprawdzane
  po rozwiązaniu adresu (tylko loopback); literalny adres IP spoza allow-listy jest blokowany od
  razu także z własnym `lookup` (Node go dla IP nie woła, #772). Metody sieciowe `node:dns`
  (`resolve*`/`reverse`, `dns.promises`, instancje `Resolver`) dla nazw spoza allow-listy →
  `NetworkBlockedError` (#812; `dns.lookup` i `node:dgram` bez zmian). Etykieta pliku testu zawsze
  z `/` (`testFileLabel`, #885, wariant Windows sprawdzany przez `path.win32`).
  `VIES_LIVE_SMOKE=1` dopuszcza wyłącznie `ec.europa.eu`.
  Chromium z Playwrighta to osobny proces (poza blokadą). Błąd wskazuje test (`plik > opis > nazwa`
  ze stanu `expect`, pole `NetworkBlockedError.test`) i host. Integracja PG
  (`vitest.integration.config.ts` → `tests/integration/setup.ts`) ma tę samą blokadę: PG z Dockera
  na 127.0.0.1 (proces `docker` poza blokadą), host jawnego `INTEGRATION_PG_ADMIN_URL` dopuszczony.
  Strażnik `network-guard.test` (kontrola ujemna: bez blokady to samo połączenie przechodzi).
  Punkt „blokada HTTP w testach” zamknięty (#765 + etykieta testu i integracja).
  Wyszukiwanie (migracja `0110`): `search_fold` = `lower(unaccent)` (IMMUTABLE) po obu stronach,
  wpis jako literał LIKE (`search_like_pattern` escapuje `\ % _`), prefiltry przez GIN na
  `search_fold(title/city)` (oferty + tłumaczenia), dokładny warunek na tytule w locale; parametry
  jak w `0091`. Demo: lustro `src/lib/search-fold.ts`. Pomiar przed/po: `docs/railway/OPERATIONS.md` §3.
  Dowód: `rls.sql` sekcja SU47 (kontrola ujemna: stary ILIKE). Raporty CSP: `report-uri`/`report-to`
  → `POST /api/csp-report` (tylko log: dyrektywa, origin zasobu, ścieżka bez query/ID; 64 KB, dłuższa paczka niż 10 raportów = pierwsze 10, 20/min
  z adresu, 300 wpisów/min na proces; `src/lib/security/csp-report.ts`), `Referrer-Policy:
  strict-origin-when-cross-origin` globalnie — test `csp-report`. Limiter per adres (#648): klucz
  wyłącznie z `@/lib/http/trusted-ip` (jeden jawnie skonfigurowany nagłówek proxy, #588/#602) —
  wcześniej lokalny `clientAddress()` ufał też `X-Forwarded-For`, więc klient mógł zmieniać go
  w każdym żądaniu i rotować klucze limitera bez ograniczeń; brak zaufanego nagłówka trafia teraz
  do jednej wspólnej puli zastępczej (`0.0.0.0`), nie do osobnego klucza per wartość nagłówka.
  Ten sam wzorzec w `/api/job-funnel` pozostaje otwarty jako #646.
  Cutover i rollback (#16/#18): runbook `docs/railway/CUTOVER_ROLLBACK.md` (kolejność: bazy →
  Better Auth → Resend/cron → `APP_MODE` na decyzję właściciela; rollback = wyzerowanie zmiennych
  w odwrotnej kolejności albo redeploy ostatniego dobrego wdrożenia, baza tylko do przodu;
  obserwacja 48 h) + smoke `node scripts/railway/prod-smoke.mjs` (poza CI; bramka hasła z env,
  4 języki + health, kod ≠ 0 przy błędzie; test `railway-prod-smoke` z atrapą serwera).
  Smoke sprawdza też nagłówki bezpieczeństwa każdej strony (CSP `frame-ancestors`/`object-src`/
  `base-uri`, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`; test porównuje z nagłówkami
  `next.config.mjs` w obu trybach), opcjonalnie tryb `PROD_SMOKE_EXPECT_MODE=production|demo`
  (HSTS ≥ 1 rok i brak noindex / noindex) i wdrożony SHA `PROD_SMOKE_EXPECT_SHA` z `version`
  w `/api/health` (w produkcji z `HEALTH_CHECK_SECRET` w `x-health-token`, bez logowania sekretu).
  Partie sitemap ofert (#689): statyczna lista sprawdzeń zna tylko `/sitemap/0.xml` (strony
  statyczne) — smoke odczytuje `/robots.txt` i dopisuje sprawdzenie dla KAŻDEJ partii ofert
  (`/sitemap/1.xml`, `2.xml`, …) tam wskazanej (`parseRobotsSitemapShardPaths`), więc awaria
  generowania katalogu ofert (zapytanie, paginacja, tłumaczenia) nie umyka już wynikowi
  „wszystkie sprawdzenia zgodne” mimo zielonego `id=0`. Katalog bez partii ofert = bez zmian.
  Pierwsze wystąpienie dyrektywy CSP (#900): `securityHeaderProblems` sprawdzała obecność
  wymaganego tekstu GDZIEKOLWIEK w nagłówku (`directives.includes(...)`) — duplikat tej samej
  nazwy dyrektywy z SŁABSZĄ pierwszą wartością (np. `frame-ancestors *` przed poprawnym
  `frame-ancestors 'none'`) dawał fałszywie zielony wynik, mimo że zgodnie z CSP Level 3
  przeglądarka stosuje wyłącznie pierwsze wystąpienie nazwy. Teraz porównanie bierze TYLKO
  pierwszą wartość każdej nazwy dyrektywy z nagłówka. Dowód: test `railway-prod-smoke`
  (kanarek z odtworzenia issue + kontrola ujemna: ten sam zestaw bez duplikatów zostaje zielony).
  **Otwarte:** wykonanie cutoveru i zapis wyników w `STATUS.md` (właściciel).
- [x] Telemetria bez danych kandydata (#502, część kodowa). Kanał błędów (#571, zamiast
  Sentry — `@sentry/nextjs`, `sentry.*.config.ts` i `sentry-egress` usunięte): webhook Discorda
  `ERROR_WEBHOOK_URL` (tylko serwer; postać natywna `…/api/webhooks/<id>/<token>` → `{content,
  allowed_mentions:{parse:[]}}`, z końcówką `/slack` → `{text}`; https i host `discord.com`/
  `discordapp.com`, inny adres = brak wysyłki). `src/lib/error-webhook/` (url, message, send)
  rejestrowany w `register()` (`src/instrumentation.ts`), `onRequestError` = szablon trasy;
  `captureError` (`src/lib/error-report.ts`, izomorficzny) przekazuje tylko kod. Wiadomość: kod z `ErrorCodes` (inaczej `INTERNAL`), trasa przez `redactUrl` bez
  query/fragmentu, wydanie (`NEXT_PUBLIC_APP_VERSION`), środowisko, czas; limit 2000 znaków;
  segment-UUID w trasie wysyłanej NA ZEWNĄTRZ (`safeRoute`, `src/lib/error-webhook/message.ts`)
  jest zawsze szablonem `[id]` (np. `/candidate/aplikacje/[id]`) — inaczej niż ogólna redakcja
  ścieżek (`redactPathSegment`), gdzie UUID zostaje jako identyfikator korelacyjny w logach
  wewnętrznych; bez tego rozróżnienia raport z prywatnej strony szczegółu aplikacji
  (`POST /api/client-error`) niósł do Discorda realny UUID rekordu kandydata/pracodawcy (#776,
  naprawione — `UUID_RE` eksportowane z `src/lib/privacy/redact.ts`, dowód `error-webhook`
  z kontrolą ujemną);
  ten sam kod raz na 10 min (licznik pominiętych), 429 → przerwa wg `retry_after`, timeout 3 s,
  awaria cicha bez adresu w logach. `/api/health` → `checks.errorWebhook`. CSP bez hosta Sentry.
  Logi serwera — wspólne reguły redakcji
  `src/lib/privacy/redact.ts` (e-mail, telefon, NISS/BIS, IBAN, tokeny/JWT, query i fragment URL,
  nazwy plików dokumentów, wiersze błędów Postgresa; pola wrażliwe po nazwie; `cause`)
  w `installConsoleRedaction()` (`register()`, poza `next dev`). Dowód: `privacy-redaction`,
  `error-webhook` (oba formaty, brak wysyłki bez zmiennej, payload bez PII z kontrolą ujemną,
  limit, deduplikacja, 429, timeout, strażnik bundla klienta). Opis: `docs/TELEMETRY_PRIVACY.md`.
  Błędy przeglądarki: `POST /api/client-error` (`src/app/api/client-error/route.ts`) — tylko ta
  sama witryna (`Origin`/`Sec-Fetch-Site`, inaczej 403), body ≤ 4 KB, wyłącznie pola `code`
  (spoza `ErrorCodes` → `INTERNAL`), `route` (`safeRoute`) i `release`; każde inne pole (np.
  `message`/`stack`) = 400 bez wysyłki (`src/lib/client-error/payload.ts`); limiter w pamięci
  10/min po HMAC adresu (jak lejek ofert), adres wyłącznie z jedynego zaufanego nagłówka
  proxy (`trustedClientIp`, #588/#602 — NIGDY z `X-Real-IP`/`X-Forwarded-For` wprost, #901,
  jak wcześniej #646/#648 dla lejka ofert/CSP); bez `ERROR_WEBHOOK_URL` = 204 bez wysyłki. Klient
  (`src/lib/client-error/reporter.ts`, `ClientErrorReporter` w `[locale]/layout`, jawnie w
  `global-error`): nasłuch `error` (tylko skrypty własnej witryny) i `unhandledrejection` + granice
  błędów przez `captureError`; wysyła tylko kod, ścieżkę i wydanie (`credentials: 'omit'`,
  deduplikacja w karcie, ≤ 10 na załadowanie), pomija błędy z `digest` (zgłoszone już przez
  `onRequestError`). Odpowiedź `429` z limitera zwalnia klucz deduplikacji (#901) — odrzucona
  próba nie jest cicho gubiona jako „wysłana” i nie zajmuje budżetu karty; odpowiedź `204`
  (dostarczone) klucza nie zwalnia. Bez zgody cookies (diagnostyka bez identyfikatorów).
  Wiadomość „błąd w przeglądarce”, osobne okno deduplikacji. Dowód: `client-error` (kontrole
  ujemne: payload z PII, obcy Origin, spoofowany `X-Forwarded-For`/brak nagłówka proxy,
  strażnik grafu importów klienta), `client-error-capture`.
  Kolejność montowania (#851): w `[locale]/layout` `{children}` montuje się PRZED
  `<ClientErrorReporter />` (React 19 wykonuje efekty potomków przed rodzicem tego samego
  commitu), więc pierwszy błąd klienta złapany przez `[locale]/error.tsx` mógł trafić do
  `captureError`, zanim reporter zdążył się zainstalować w swoim `useEffect` — `captureError`
  bez reportera cicho nic nie robi i nie ponawia zgłoszenia po instalacji. `LocaleError`
  wywołuje teraz `installClientErrorReporter()` (idempotentny, jak w `global-error.tsx`) tuż
  przed `captureError`, więc pierwszy błąd na pierwszej stronie po starcie karty też dociera.
  Dowód: `locale-error-reporter-order` (pozytyw + kontrola ujemna: błąd z `digest` nadal
  pomijany).
  **Otwarte (właściciel):** wpisanie `ERROR_WEBHOOK_URL` w Railway, dostęp do kanału Discorda,
  logi Railway (retencja/dostęp), rejestr (#485).
- [x] Formularze przed hydracją i fokus po zapisie (audyt 29.09, #1236/#1237/#1238/#1243, bez migracji):
  każdy formularz obsługiwany przez `onSubmit` ma `method="post"` (bez JS albo przed hydracją natywna
  wysyłka nie trafia do query URL), a formularze widoczne w HTML z serwera (logowanie, rejestracje,
  reset i nowe hasło, sprawdzenie sprawy DSA, zgłoszenie treści, formularze firmy, zespołu,
  ustawień, szablonów, importu, kampanii, rejestru naruszeń) blokują przycisk do hydracji
  (`useHydrated`, `src/components/forms/use-hydrated.ts`) z komunikatem `<noscript>`
  (`NoScriptFormNotice`, `common.formJsRequired`). Po zapisie danych firmy, linków, agencji,
  preferencji powiadomień i „Zapisz wyszukiwanie” fokus trafia na komunikat wyniku (`tabIndex=-1`),
  „Anuluj” w `AppealForm` wraca fokusem na „Odwołaj się”; akcje nieprzeczytanego powiadomienia
  bez `shrink-0` (reflow 320 px). Dowód: E2E `forms-no-js-post` (JS wyłączony, opóźnione chunki,
  kontrola ujemna: HTML bez `method`/`disabled` wysyła hasło w query), `notifications-list`
  (`scrollWidth` 320 px, 4 języki), unit `a11y-focus-after-save` i `a11y-focus-after-pending`.
- [x] Prywatność i obserwowalność (paczka audytu 2026-09-28, bez migracji): beacon Cloudflare
  z `spa: false` i pełnym przeładowaniem przy przejściu z trasy publicznej na prywatną (link
  albo `router.push`; `src/lib/analytics/beacon.ts`, #1046, E2E `one-time-link-tracking`);
  kanał błędów niesie obszar (`Obszar:` z `area`/`task` kontekstu `captureError`, walidowany
  `safeErrorArea`) i SQLSTATE, deduplikacja po (kod, obszar, SQLSTATE), maintenance zgłasza każde
  nieudane zadanie osobno (#1066); `reportUnmappedDbError` (`src/lib/db/errors.ts`) zgłasza
  `INTERNAL` z nieznanego błędu bazy w akcjach (kandydat, onboarding, ustawienia powiadomień,
  zespół, firma, zapisane wyszukiwania; bez akcji rekrutacyjnych i `jobs.ts`, #1068); trasy prywatne (`isPrivateRoutePath`, lista
  `route-policy.ts`) dostają w middleware `Referrer-Policy: strict-origin` (sam origin jako referrer
  strony otwartej z panelu; jednorazowe linki `no-referrer`, #1218, unit `middleware-referrer-policy`,
  E2E `one-time-link-tracking`); cookie aktywnej
  firmy z `Secure` w produkcji przez `activeCompanyCookieOptions`, decyzje moderacyjne i status
  firmy unieważniają publiczny ISR (#1109); `/api/health`
  pokazuje szczegóły tylko z tokenem albo w `next dev` (`NODE_ENV=development` poza trybem produkcyjnym —
  nie po `request.url`, który za proxy Railway wskazuje localhost, #1219), zbiorczy budżet błędów
  z przeglądarki (`ERROR_WEBHOOK_CLIENT_BUDGET`),
  worker kolejki storage bierze do 10 partii po 100 na przebieg, migrator wypisuje nazwę migracji
  i SQLSTATE bez komunikatu bazy (#1105).
  Dokończenie (bez migracji): `reportUnmappedDbError` także w `jobs.ts` (`failureCode(error, obszar)`
  zgłasza też wyjątki spoza bazy), panelu admina (`admin.ts`, kampanie, próg wieku, rejestr naruszeń,
  zaufanie ofert), blokadach firm, języku e-maili i powiadomieniach (#1068). Domknięcie #1068:
  także akcje rekrutacyjne (aplikacje, wiadomości, propozycje, gość, szablony, CV, widoczność,
  zgłoszenia wiadomości — samo zgłaszanie, bez włączania funkcji), kontakt, zgłoszenia treści,
  odwołania, wiek, konto i jego eksport z SQLSTATE przez `captureActionError` (`src/lib/db/errors.ts`:
  błąd bazy = obszar + SQLSTATE, inny wyjątek = sam obszar); dawne ciche `catch` (loadery
  „Pokaż więcej”, zapisane oferty na liście, log zgód, wersja oferty, pliki CV/załączników, runtime
  auth przy resecie) zgłaszają błąd. Strażnik w `report-unmapped-db-error.test` (każdy `catch`
  w `src/lib/actions` kończący się błędem musi zgłaszać, mapowanie bazy bez `reportUnmappedDbError`
  = czerwony; kontrole ujemne; wyjątek `auth.ts` — mapowanie Better Auth, otwarte); limit akcji firmy, zespołu, agencji i odwołania autora decyzji liczony po sesji na KONTO
  + szeroki próg na IP (`checkAccountRateLimit`, `src/lib/rate-limit-account.ts`, wiadro `<akcja>-ip`
  = 10 × limit), zły format identyfikatora w `setCompanyStatus`/`resolveReport`/
  `markNotificationsRead` = `VALIDATION_FAILED` (#1109; dokończenie: upload CV i załączników liczy limit na konto po sesji przez `checkAccountRateLimit` — anonimowe wywołanie nie zużywa budżetu, a identyfikator rozmowy/zgłoszenia/propozycji w złym formacie w `sendMessage`/`markConversationRead`/`openConversation` = `VALIDATION_FAILED` przed sesją i bazą, tryb demo bez zmian; unit `candidate-cv-route-actions`, `message-attachments-actions`, `messages-actions`); panel `/admin/operacje` ocenia wiersz doby
  i miesiąca budżetu AI według poziomu danego okresu — wspólny `ai_budget_exhausted` nie podnosi
  drugiego okresu do alarmu ani nie kasuje jego ostrzeżenia (#789). Dowód: unit
  `report-unmapped-db-error`, `server-actions-1109`, `admin-ops-dashboard` (kontrole ujemne).
- [x] Warstwa danych paneli bez PostgREST (#25): loadery/akcje/layouty/onboarding/outbox na `withPortalTransaction`
  (sesja → `SET LOCAL ROLE` + `app.current_uid`, RLS w bazie) i `withServiceRole` (pula `service`, login
  `pracujbe_service_runtime`); gotowość produkcji = PostgreSQL WWW + service + Better Auth. Migracja `0107`
  (`claim_email_batch` dla `service_role`). Dowód: `tests/integration/portal-*.test.ts` (PG16). Nazwa firmy
  w wiadomościach kandydata (od 0014, migracja `0143`): `companies` jest czytelne pod RLS tylko dla
  członków firmy, więc kandydat sam nic nie odczyta — `get_conversation_summaries` (lista) i nowe
  `get_conversation_company_name` (wątek/starsze wiadomości) są SECURITY DEFINER, gejtowane tym samym
  `is_conversation_member` co 0039, i zwracają WYŁĄCZNIE `companies.name` (imienia/nazwiska rekrutera
  nadal nie ujawniają — decyzja 0023). Dowód: `rls.sql` sekcja CN143; unit
  `messages-data-result`/`conversation-thread-result`/`messages-sender-fallback`/`thread-pagination`.
  **Otwarte:** spięcie z trasami sesji (#24, zrobione w #532).
- [~] Usunięcie Supabase z runtime (#27, część kodowa): brak `@supabase/*` w `package.json`, usunięte `src/lib/supabase/*`,
  `src/lib/storage.ts` (PDF faktur — billing wyłączony #51, `pdfUrl` = null), hook GoTrue `/api/auth/email-hook` +
  `src/lib/email/auth-email.ts` (e-maile kont wysyła worker Better Auth), zmienne `NEXT_PUBLIC_SUPABASE_*`/`SUPABASE_*`/
  `SEND_EMAIL_HOOK_SECRET`, hosty `*.supabase.co` z CSP i `images.remotePatterns`. Kolejka usuwania obiektów bez bucketu →
  `STORAGE_UNCONFIGURED` (ponowienie), bez klienta Storage. Strażnik `no-supabase-runtime.test.ts`. **Otwarte (odbiór #27):**
  smoke produkcji na Railway (healthcheck, wersja w stopce, ścieżki użytkownika), domena `pracuj.be` w Cloudflare, nazwa
  katalogu `supabase/` (migracje — świadomie bez zmiany). Dokumentacja (odbiór #27, część dokumentacyjna): README,
  `docs/ARCHITECTURE.md`, checklisty bezpieczeństwa/uruchomienia/wydajności, `TURNSTILE.md`, `DATA_RETENTION.md`,
  `AUDIT_PROMPT.md` opisują stan Railway; `SUPABASE_SETUP.md`, raporty audytu/remediacji z 07.2026 i wzmianki
  w `SELF_HOSTED_RUNNERS.md` mają nagłówek „ARCHIWALNE — stan sprzed migracji na Railway (#27)”; mapa katalogów §4
  poprawiona; linki względne w `docs/` sprawdza `tests/unit/docs-links.test.ts`. Szkice prawne (`docs/legal-drafts/`)
  i dokumenty migracji (`docs/railway/`) wspominają Supabase celowo (dostawca historyczny / źródło migracji).
- [x] Integracyjne testy RLS/triggerów w CI — job `rls` (usługa `postgres:16`), `scripts/test-rls.sh`,
  `supabase/tests/{shim,rls}.sql`; `npm run test:rls`.
- [x] Zależności: **`npm audit` 0 podatności** (next-intl v4 + vitest 4.1.11 — #749, bez podatnego `@vitest/mocker` + overrides rollup/vite/esbuild/sharp/prismjs/postcss).
- [x] `next/font/local` (offline DM Sans; wcześniej Inter), PWA (ikony/manifest/service worker), storage signed URLs + upload CV (0018, Invariant #10).
  Pliki CV na Railway (#26): upload, pobranie, usunięcie i kwarantanna przez prywatny bucket S3
  Railway (`src/lib/files/*`, repozytorium `db/candidate-files.ts`, adapter `storage/railway-bucket.ts`),
  bez Supabase Storage. Pobranie = krótki (60 s) link HMAC `/api/files/cv/<id>?t=…` wystawiany
  przy kliknięciu; trasa ponownie sprawdza sesję Better Auth, własność i `scan_status`, strumieniuje
  z bucketu (bez adresu S3). Env: preset „AWS SDK” bucketu (`AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`,
  `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_URL_STYLE`) +
  `FILE_DOWNLOAD_SECRET`; `/api/health` → `fileBucket`/`fileDownloadSecret`. Bez bucketu: demo =
  `DEMO_UNAVAILABLE`, produkcja = błąd. Opis: `docs/railway/STORAGE_ADAPTER_CONTRACT.md`.
  GC sierot (#17, migracja `0117`): dzienny przebieg w `/api/maintenance` (`src/lib/storage-gc.ts`,
  `list` w adapterze) — obiekt bez wiersza `files` po 24 h → `storage_deletion_queue`, wiersz bez
  obiektu → tylko licznik; partie z kursorem (`storage_gc_sweeps`), dry-run domyślnie
  (`STORAGE_GC_MODE=delete` = kasowanie), same liczniki w odpowiedzi. Opis: `docs/DATA_RETENTION.md` §3a.
  Tryb na produkcji: `dry-run` do obserwacji liczników (decyzja właściciela 26.09.2026,
  `docs/PRODUCT_DECISIONS.md`); `delete` dopiero po nowej decyzji.
  Załączniki wiadomości w tym samym GC (#833, bez migracji): `runStorageGc` sprząta teraz DWA
  niezależne logiczne buckety jednego fizycznego bucketu Railway — CV (`candidate-files`,
  domyślnie) i załączniki rozmów (`message-files`, `bucket`/`pattern: 'attachment'`), każdy
  własnym przebiegiem (`storage_gc_sweeps` per bucket, generyczne RPC 0117 bez zmian).
  Wcześniej `list()` adaptera klasyfikował KAŻDY klucz `att-*` jako obcy niezależnie od
  wywołania — osierocony załącznik po przerwanym uploadzie nigdy nie trafiał do kolejki
  usuwania nawet po latach. `/api/maintenance` woła oba przebiegi po kolei (osobne `try/catch`,
  `messageAttachmentsGc` w odpowiedzi); awaria jednego nie blokuje drugiego. Dowód: unit
  `storage-gc`, `railway-bucket` (kontrola ujemna: `pattern` inny niż podany traktowany jako obcy).
  **Otwarte:** utworzenie bucketu (właściciel), GC
  `email_deliveries` z #17 (retencja e-maili = decyzja #574; `processed_webhooks` i `rate_limits`
  czyści `/api/maintenance` od migracji `0163`, `rls.sql` sekcja GC163), AV, PDF faktur (`storage.ts`, #27).
  Manifest PWA per język (#174): `/{locale}/manifest.webmanifest` z `lang`/`start_url`/opisem
  w danym języku (generator `src/lib/pwa/manifest.ts`, języki z `routing.locales`), nieobsługiwany
  → 404, stary `/manifest.webmanifest` = PL. Adres manifestu omija middleware (bramka hasła,
  next-intl) — strażnik `tests/unit/pwa-manifest-route.test.ts`, E2E `pwa-locale-manifest.spec`.
  Limit CV na konto (decyzja właściciela 29.09.2026, migracja `0189`): najwyżej 10 nieusuniętych plików
  i 50 MB łącznie (trigger `enforce_cv_account_quota`, lustro `CV_MAX_FILES_PER_ACCOUNT`/
  `CV_MAX_TOTAL_BYTES_PER_ACCOUNT`, komunikat `files.errorAccountLimit`); dowód `rls.sql` SD1111, unit `cv-account-quota`.
  Kontrakt soft-delete (0189): usunięta (`deleted_at`) aplikacja i propozycja są niewidoczne dla stron
  (polityki odczytu), a baza odrzuca zmianę ich statusu każdą ścieżką (także SECURITY DEFINER/service_role)
  jako `NOT_FOUND` (`trg_soft_delete_contract`); zmiana samego `deleted_at` i kluczy obcych (usuwanie konta
  `erase_*`, retencja) działa. Dowód: `rls.sql` GS98-6, SD1111-6/N4.
  Przegląd funkcji SECURITY DEFINER (migracja `0193`, numer tymczasowy): funkcje omijają RLS, więc usunięty
  wiersz nie daje roli (`current_profile_role` — brak/usunięty profil = `''`, więc wzorzec
  `<> 'candidate'` odrzuca; `is_admin` od 0185), dostępu (`can_access_*`, `is_job_manager`/`is_job_company_member`,
  `is_conversation_member`, `conversation_created_by_me`, `owns_candidate_profile`), listu
  (`email_recipient_authorized`), profilu (`ensure_candidate_profile` → `NOT_FOUND`), sukcesu ponowienia
  (`apply_to_job`) ani relacji/celu propozycji (`send_offer`). Strażnik `tests/unit/soft-delete-contract.test.ts`
  czyta najnowsze definicje z migracji: każda para (funkcja SECURITY DEFINER, tabela z `deleted_at`) ma warunek,
  funkcję pomocniczą sprawdzającą `deleted_at` albo wyjątek z uzasadnieniem (kategorie ERASE/GUARD/WRITE/NEW/
  SESSION/FORMAT/ADMIN/EXPORT/MATCH/MAINT; nieaktualny wyjątek = czerwony; kontrola ujemna na definicjach sprzed
  0193). Dowód: `rls.sql` SDR1111 (kontrole ujemne po rollbacku `0193_…down.sql`).
  Plik CV: wspólne reguły `src/lib/validation/cv-file.ts` (5 MB, PDF/DOC/DOCX) w przeglądarce i akcji;
  plik za duży/zły format odrzucony przed wysyłką (limit ciała akcji 6mb), akcja zwraca `reason`
  (`tooLarge`/`type`/`empty`) → komunikaty `files.error*` (#362).
  Rejestracja Service Workera po hydratacji (#797): `ServiceWorkerRegister` czekał wyłącznie na
  przyszłe zdarzenie `window.load` — gdy efekt montował się już po `document.readyState ===
  'complete'` (późna hydratacja/wolniejsze urządzenie), `load` już minęło i listener nigdy się
  nie odpalał, więc SW nie rejestrował się na tej wizycie. Rejestracja następuje teraz od razu
  przy `readyState === 'complete'`, inaczej czeka na `load` (`{ once: true }`) jak dotąd. Test:
  `tests/unit/service-worker-register.test.tsx` (z kontrolą ujemną).

### Etap 8 — jakość
- [x] Testy: Vitest (matching, recipient-locale, i18n keys, error-keys), integracyjne RLS+seed w CI (`postgres:16`), Playwright (smoke/seo/flows)
  Strażniki #1114 (TQ2-09/10, bez migracji): `i18n-jsx-literals` (AST każdego `.tsx` w `src/`: tekst
  z literą w treści JSX i w `aria-label`/`title`/`alt`/`placeholder`…; poza `<style>`/`<script>`;
  wyjątki: `global-error.tsx` poza next-intl, znak marki, kody walut, dwa wpisy per plik; wpis
  nieaktualny = czerwony), `i18n-unused-keys` (klucz, którego ostatniego członu nie buduje żaden
  identyfikator/literał ani klucz dynamiczny `x_${…}`/`${…}Title` w `src/`+`scripts/`; wyjątki =
  wzorce `free-mvp-no-sales`; usunięto 97 martwych kluczy × 4 języki), kontrole ujemne na
  syntetycznym kodzie (`tests/helpers/i18n-source-scan.ts`). Skrypty testów SQL (test-rls, test-seed,
  test-backup, test-restore, search-benchmark) biorą migracje z `scripts/lib/migration-files.sh`
  (czysty bash, reguły produkcyjnego loadera: każdy `NNNN_[a-z0-9_]+.sql`, bez powtórzonych
  numerów) zamiast `0*.sql` — test `migration-files-sh` (zgodność z `loadProductionMigrations`,
  kontrola ujemna `1000_…`, strażnik wzorców w `scripts/**/*.sh`). Truncate na tabelach append-only
  moderacji/DSA (obserwacja z #1180) wymaga migracji — osobno.
- [~] Testy Playwright: języki/detal oferty/CTA/noindex paneli/cookies/SEO gotowe (`flows.spec`+smoke+seo, 12 pass); do rozbudowy: aplikowanie/propozycje pod realną sesją
  Przepływ na PostgreSQL 16 (#351, #66 — częściowo): `npm run test:e2e:real`
  (`scripts/test-e2e-real.mjs` + `playwright.real-flow.config.ts`, spec `tests/e2e-real/`).
  Izolowana baza o jawnym hoście/porcie/nazwie (`E2E_PG*`, nazwa musi zawierać „e2e”), migracje
  produkcyjne, jednorazowe ograniczone loginy app/auth. Sesje Better Auth (rejestracja →
  weryfikacja → logowanie → cookie), tożsamość z cookie (`readPortalIdentity`) →
  `withUserTransaction` pod RLS. Kroki: onboarding 1–6 z błędem drugiej części kroku 5
  i `finish_onboarding`, aplikacja (podwójne kliknięcie), status, propozycja (retry), akceptacja,
  wiadomości w obie strony z licznikiem, `email_deliveries` fr/nl, obce konta bez dostępu.
  Przeglądarka widzi ofertę z bazy (`next dev` z `DATABASE_APP_URL`) i jej zniknięcie po
  zamknięciu. Kontrole ujemne: `E2E_REAL_MUTATION=rls-applications-off|finish-onboarding-noop|
  step5-swallow-error|recipient-locale-en|funnel-no-dedup|retry-new-key` — każda daje czerwony test.
  Onboarding (#66, `tests/e2e-real/candidate-onboarding.spec.ts`): kroki 1–6 osobno z odczytem
  po każdym (`support/onboarding.ts` = kontrakt `saveOnboardingStep` ze schematami kroków
  z produkcji + loader kreatora z relacjami), wznowienie („Dalej” z danymi z bazy nie gubi
  skills/languages/certificates, edycja usuwa pozycję), walidacja pól i odrzucenia w bazie bez
  zmiany stanu, równoległe zapisy kroków 3/5 i „Zakończ” bez duplikatów, `finish_onboarding`
  (niekompletny → `ONBOARDING_INCOMPLETE`), wyszukiwalność tylko po ukończeniu i opt-in
  (widok pracodawcy pod RLS). Mutacje: `searchable-without-complete|skills-append|
  completeness-guard-off|relations-dml-open`. Zestaw real-flow biegnie w CI w jobie `e2e-real`
  (usługa `postgres:16`, check blokujący od #1239 — CLAUDE.md §10); mutacje nadal ręcznie.
  Kroki UI w przeglądarce (`tests/e2e-real/ui-flow.spec.ts`, helpery `support/ui.ts`): serwer
  `next dev` z Better Auth na ograniczonym loginie auth (`DATABASE_AUTH_URL`, origin jak w stosie
  testu). Rejestracja pracodawcy (nl) i kandydata (fr) formularzami → link potwierdzenia z
  `auth.email_outbox` (język odbiorcy) → przycisk „Potwierdź” → panel wg roli; logowanie
  formularzem (złe hasło bez sesji), panel bez sesji → logowanie. Kreator onboardingu 1–6
  (błąd pola, „Zakończ” → `profile_completed` w bazie), przełącznik widoczności profilu,
  ApplyModal (podwójne kliknięcie, ponowne wysłanie → „już aplikowałeś”), menu statusu w
  szczególe zgłoszenia, propozycja z `/employer/kandydaci`, akceptacja w
  `/candidate/propozycje`, wiadomości w obu panelach, obca firma → 404 szczegółu. Wyjątki bez
  ścieżki UI: weryfikacja firmy przez RPC admina, oferta przez RPC kreatora pod sesją
  z przeglądarki, wiersz `matches` wstawia operator (pipeline P1-03). Mutacje UI:
  `respond-offer-noop|transition-noop` (czerwone są też `finish-onboarding-noop` i
  `recipient-locale-en`; `rls-applications-off` łapie tylko critical-flow — panel sam filtruje
  po aktywnej firmie). Kreator oferty (`tests/e2e-real/job-wizard.spec.ts`): 9 kroków klikanych
  w przeglądarce (nl) pod sesją Better Auth; błąd pola w kroku 1 nie tworzy oferty, po każdym
  „Dalej” odczyt szkicu w bazie (kolumny `jobs`, tłumaczenie, wymagania, umiejętności, języki
  z poziomem, certyfikaty); publikacja przy firmie niezweryfikowanej = komunikat i nadal `draft`
  (bez e-maila `jobPublished`), po weryfikacji przez admina ta sama sesja publikuje (`active`,
  slug publiczny, e-mail w języku publikującego, strona oferty dla gościa). Mutacje:
  `wizard-draft-noop|publish-unverified`. W CI: job `e2e-real` — blokujący od #1239 (12/12
  zielonych na `main`), drugi krok w trybie `CLASSIFIEDS_ONLY` (`saved-search-classifieds`).
  Straże krytycznych przepływów bez realnej bazy: unit Server Actions (`critical-flow-actions`),
  worker outboxa w `email_deliveries.locale` (`email-outbox-locale`), zgody cookies
  (`consent-store`, `consent-action`), gałąź produkcyjna sitemap/robots (`sitemap-robots`);
  E2E noindex każdej strony paneli i auth z systemu plików (`panel-noindex`) i axe na wszystkich
  trasach publicznych, 4 języki, 320/1280 px, z banerem i po jego zamknięciu (`a11y-public-routes`).
  Panele (#373, `panel-a11y`): axe critical/serious + `target-size` na wszystkich 29 trasach
  kandydata i pracodawcy (PL/EN 1280 px, 4 języki 320 px), z banerem, z otwartym menu statusu,
  centrum powiadomień i kompozytorem; kontrola ujemna (przycisk bez nazwy → czerwony). Admin: `admin-a11y`.
  Pułapka fokusu `AdminConfirmDialog` po błędzie ogólnym (#837): gdy zapis kończy się błędem
  (np. `INTERNAL`) w trakcie którego fokus stał na kontenerze dialogu (#415), fokus wraca na
  kontrolkę sprzed zapisu zamiast zostawać na kontenerze; pułapka Tab/Shift+Tab dodatkowo
  rozpoznaje sam kontener jako aktywny element (zapętla na pierwszą/ostatnią kontrolkę) —
  Shift+Tab nie wypuszcza już nawigacji na przyciemnione tło. Wspólne dla 11 miejsc korzystających
  z `AdminConfirmDialog`. Dowód: `tests/unit/admin-company-status-confirm.test.tsx` (kontrola
  ujemna: bez poprawki fokus zostaje na kontenerze).
  Zasada E2E: kontrolki po roli i nazwie z `src/messages` (`tests/e2e/fixtures/messages.ts`),
  bez `.first()`/`.nth()` na przyciskach o znaczeniu. Invariant #1 na ścieżce enqueue → worker →
  render (#348, `email-recipient-locale-e2e`): kontrakt najnowszych `resolve_recipient_locale`/
  `enqueue_email` z migracji (kolejność preferred → account → signup → `en`, locale z
  `p_profile_id`), zgodność z TS, nadawca i odbiorca w różnych językach, kontrola ujemna.
  Zgody cookies (#349/#570, `cookie-consent-categories.spec`, 4 języki): „Tylko niezbędne”,
  zgoda na analitykę → beacon Cloudflare Web Analytics (#570: zamiast Google Analytics i Meta
  Pixel — usunięte; bezcookie'owy, więc bez `_ga*`/`_fbp`/`_fbc` i bez `ga-disable`/
  `fbq('consent', …)`), same preferencje → beacon się nie ładuje, centrum zgód bez
  przełącznika „Marketing” (usunięty — decyzja właściciela 25.09), wycofanie ze stopki usuwa render beaconu natychmiast i po
  odświeżeniu zero żądań; stara wersja polityki (także cookie 1.0 z marketingiem) / uszkodzone cookie → baner z serwera
  nieukryty przed hydratacją; cookie na 180 dni; wywołanie `recordConsent` z kategoriami
  i źródłem (centrum = `cookie_settings`). Kontrakt parametrów `recordConsent` ↔
  `record_consent` z migracji (`consent-action.test`).
  Wersja polityki w receipcie (#349, migracja `0142`): `record_consent` przyjmuje opcjonalny
  `p_version` (= `ConsentRecord.v` z cookie klienta, `src/lib/consent.ts`) i zapisuje w
  receipcie DOKŁADNIE tę wersję dokumentu 'cookies', którą użytkownik faktycznie widział —
  ale TYLKO gdy istnieje jako OPUBLIKOWANY wiersz `consent_versions` (`published_at` ustawione
  i ≤ now(); nie musi być `is_current`, bo polityka mogła się zmienić już PO zgodzie). Wartość
  `NEXT_PUBLIC_CONSENT_POLICY_VERSION` musi być równa `consent_versions.version` dokumentu
  `cookies` (`docs/LAUNCH_CHECKLIST.md` §3). Nieznana/nieopublikowana/brak wersji → cichy fallback do bieżącej (jak
  przed 0142); best-effort, log zgód nie blokuje UX (Invariant #8). Kategorie jak w `0130`
  (bez `marketing`). Stara 5-argumentowa sygnatura RPC jest zastąpiona (jedyny wołający,
  `recordConsent`, zaktualizowany w tym samym PR). Dowód: `rls.sql` sekcja CVR142 (kontrole
  ujemne: nieistniejąca wersja nie trafia do receiptu, wersja nieopublikowana — przyszła lub szkic — też nie,
  authenticated nie dopisuje/nie nadpisuje receiptu cudzego konta).
  Invariant #1 na żywej bazie (#348): `rls.sql` sekcja LOC348 — `email_deliveries.locale` dla
  newApplication, applicationViewed, statusChanged, jobOffer (+ `offers.locale`), offerAccepted/
  Declined, newMessage (obie strony), companyVerified, teamInvitation; nadawca, odbiorca i oferta
  w różnych językach, fallback preferred → account → signup → `en`, komplet szablonów sekcji;
  kontrole ujemne (język sesji nadawcy, odwrócony fallback). Raport flaków z kilku lokalnych
  przebiegów (#375, poza CI): `npm run test:e2e:flaky -- --runs N` (`scripts/e2e-flaky-report.mjs`,
  opis `docs/E2E_FLAKY_REPORT.md`, test `flaky-aggregate`).
  Post 1080×1080 z prawdziwej oferty (#181): `scripts/export-job-post.mjs slug locale wyjście`
  — dane wyłącznie z `get_public_job` (`DATABASE_APP_URL`, `SET LOCAL ROLE anon`, odmowa loginu
  superusera; `scripts/lib/job-post-source.mjs`), bez JSON od operatora; renderer przyjmuje tylko
  obiekt ze źródła. Stawka tylko gdy podana, tytuł 2×77/3×60 px albo błąd przed zapisem.
  Instrukcja: `docs/design/people-passport/JOB-POST-EXPORT.md`, test `job-post-export`.
  Źródło danych (#186, migracja `0102`): `get_campaign_job` (anon) — tylko pola grafiki i tylko
  oferta `active`, nieusunięta, niewygasła, `is_demo = false` (oferta i firma), firma `verified`;
  inaczej jednakowy brak danych. Dowód: `rls.sql` sekcja CJ186 (każdy przypadek + kontrola ujemna
  po zdjęciu każdego filtra), rollback `supabase/rollback/0102_…down.sql` (test w `test-rls.sh`).
  Baner kampanii z oferty w panelu (#175): `/employer/oferty/[id]/baner` (noindex) + `GET
  /api/employer/jobs/[id]/banner` — formaty 1200×300, 300×250, 300×600, język PL/NL/FR/EN, SVG
  i PNG (kanwa w przeglądarce); dane z `get_managed_campaign_job` (recruiter+ firmy oferty albo
  admin, te same filtry), limit 60/h na konto, `private, no-store`, CSP `sandbox`, demo = 404.
  Znak jak `Logo.tsx`, tokeny `--pp-*`, osadzony DM Sans, pomiar tekstu tablicą szerokości
  (`src/lib/campaign-banner/`). Opis: `docs/design/people-passport/BANNER-EXPORT.md`. Testy:
  `campaign-banner*.test.ts` (Chromium: pomiar przeglądarki ≤ serwera), E2E `campaign-banner`.
  Baner w panelu admina: `/admin/firmy/[id]` przy każdej AKTYWNEJ ofercie firmy ma link „Baner
  kampanii” (`adminBannerHref`, `src/lib/admin/campaign-banner-link.ts`; nazwa dostępna z tytułem
  oferty) do generatora `/admin/oferty/[id]/baner?firma=<id>` — `/employer/oferty/[id]/baner` jest
  zablokowana layoutem panelu pracodawcy dla konta bez firmy. Obie strony renderuje wspólny
  `CampaignBannerView` (`src/components/employer/`), podgląd i pobranie idą przez ten sam
  endpoint (admina dopuszcza `get_managed_campaign_job`, 0102). Strona admina: noindex,
  `requireAdmin()` przed odczytem (nie-admin → 404 niezależnie od layoutu), powrót do firmy
  (parametr `firma` tylko jako bezpieczny segment), demo = „niedostępny”. Bez migracji. Testy:
  unit `admin-campaign-banner` (kontrola ujemna: pracodawca/bez sesji → 404 bez odczytu; mutacja
  bez `requireAdmin` = czerwony), E2E `admin-campaign-banner` (4 języki, link tylko przy aktywnej,
  axe), trasa w `admin-a11y`.
  Eksport grafik poza CI (#378): `scripts/lib/launch-chromium.mjs` — `PLAYWRIGHT_CHROMIUM_PATH`
  (zła ścieżka = czytelny błąd), potem przeglądarka z `playwright install` (CI bez zmian), potem
  najnowsza rewizja w `PLAYWRIGHT_BROWSERS_PATH`. Story PNG porównywane pikselami
  (`tests/helpers/png-pixels.ts`), bo rewizje Chromium inaczej kodują IDAT.
  Zrzut bez flaka (main 514e917, „Unable to capture screenshot”): skrypty robią zrzut przez
  `scripts/lib/stable-screenshot.mjs` (fonty + dwie ramki ze stałym układem, najwyżej 3 próby
  tylko tego błędu, wpis na stderr); testy z Chromium w projekcie Vitest `chromium`
  (`CHROMIUM_TEST_FILES`, jeden plik naraz), strażnik `stable-screenshot.test.ts`.
  Flaki E2E przy `failOnFlakyTests` (09.2026, bez skip i bez retry): speci biorą `AxeBuilder`
  z `tests/e2e/fixtures/axe.ts` — przed `analyze()` czeka na niepusty `<title>` (Next strumieniuje
  metadane osobno od treści; axe po nawigacji klienckiej zgłaszał `document-title`), tam też
  `expectNoindex` (dwa `meta[name="robots"]` naraz po nawigacji klienckiej). Serwer E2E
  z `--keepAliveTimeout 120000` (`ECONNRESET` na keep-alive agenta `request`). Strażnik
  `e2e-axe-ready.test.ts` (import wprost z `@axe-core/playwright` = czerwony, kontrola ujemna;
  lista przejściowa speców z otwartych PR-ów #586/#918 tylko maleje).
  Szybkie testy jednostkowe bez podnoszenia limitu 5 s (13 plików zgłaszanych pod obciążeniem):
  ciężkie moduły (worker outboxa, trasa wypisania) importowane statycznie na górze pliku, nie
  `await import()` w teście; jednorazowa rozgrzewka w `beforeAll` (render React Email —
  `tests/helpers/email-render-warmup.ts`; pdf.js; pierwszy render/walidacja formularza, listy
  i przejście kreatora do kroku 9), żeby pierwszy test nie płacił leniwych importów i JIT;
  w `waitFor` tanie zapytanie DOM, a `getByRole` raz po nim (polling ról w dużym drzewie jsdom
  rośnie z obciążeniem); render wielu szablonów = jeden test na szablon × język; styl inline
  parsowany raz na element w audycie `email-a11y`; CRC-32 z tablicą w `cv-fixtures.ts`; atrapa
  HTTP zamykana z `closeAllConnections()` (keep-alive `fetch`); krótki limit czasu w smoke tylko
  dla zawieszonej trasy. `sitemap-robots` #599 bez zmian — koszt to 60 000 wpisów produkcyjnego
  `sitemap.ts`, nie test.
- [~] Wydajność / Core Web Vitals / dostępność (audyt) — **dostępność (a11y) ZROBIONE:** bramka
  axe-core w CI (`tests/e2e/a11y.spec.ts`, uruchamiana w jobie `e2e`) blokuje przy naruszeniach
  WCAG 2.x A/AA o wadze critical/serious na kluczowych stronach publicznych (home, lista ofert,
  logowanie, rejestracja); domknięte realne naruszenia kontrastu (tokeny).
  Tytuł zawsze obecny (#1032): `htmlLimitedBots: /./` w `next.config.mjs` wyłącza strumieniowanie
  metadanych Next 15 dla każdego klienta z user-agentem — `<title>` w `<head>`, a po
  `router.refresh()`/nawigacji podmienia się atomowo (strumieniowane drzewo metadanych ma klucz
  żądania i montuje się od nowa → dokument chwilowo bez tytułu, flaka axe `document-title`).
  Strażnik `blocking-metadata-config.test` (z kontrolą ujemną), E2E `offer-trust` (tytuł w `<head>`,
  zero mutacji bez tytułu podczas odświeżenia).
  Bramka wydajności w CI (#395): kroki „Performance budget (static)” w `build` (JS gzip
  kluczowych tras = layouty + strona, fonty woff2; `scripts/perf-budget-static.mjs`) i
  „Performance budget (lab CWV)” w `e2e-perf` (LCP/CLS/TBT, mediana 3 prób, CPU 4×, 1,6 Mb/s,
  pierwsza wizyta i ze zgodą; `scripts/perf-lab.mjs`, ten sam build i Chromium). Budżety i
  progi w `perf-budgets.json`, opis w `docs/PERFORMANCE_CHECKLIST.md` §10; strażnik kroków
  w `check-ci-workflows.mjs`. INP-proxy w tym samym kroku: tapnięcie „Filtry”, zapis oferty
  (odpowiedź `getPublicSavedJobs` podmieniona na kandydata — CI bez sesji) i „Aplikuj teraz”,
  Event Timing (najdłuższy wpis interakcji), CPU 4×, mediana 3 prób vs `inpMs` (200 ms);
  kontrola ujemna `--inject-click-delay-ms 300` → czerwony.
  Dane polowe CWV — Cloudflare Web Analytics zamiast własnej zbiórki: beacon z #570/#635 (tylko
  po zgodzie `analytics`, tylko trasy publiczne, bez cookies) sam mierzy LCP/INP/CLS. Podgląd
  `/admin/wydajnosc?dni=7|28` (tylko admin, `requireAdmin`): p75 serwisu + 20 najczęstszych
  ścieżek z oceną słowną wg progów, boty pominięte, liczby próbkowane — odczyt z serwera przez
  GraphQL Analytics API (`src/lib/web-vitals/field-report.ts` czysty parser, `cloudflare-client.ts`
  server-only, token tylko w nagłówku, timeout 8 s, błąd = sam kod; env `CF_ANALYTICS_ACCOUNT_ID`,
  `CF_WEB_ANALYTICS_SITE_TAG`, `CF_ANALYTICS_API_TOKEN`). Bez konfiguracji: instrukcja (z bazą)
  albo raport przykładowy oznaczony demo (bez bazy). Bez migracji i bez endpointu `/api/web-vitals`.
  Testy: unit `web-vitals-field` (kontrole ujemne: brak konfiguracji = zero żądań, token poza
  treścią/adresem, z bazą nigdy demo), E2E `admin-web-vitals` (4 języki, brak żądań do Cloudflare
  z przeglądarki), `admin-a11y`; zgody beaconu — istniejące `cookie-consent-categories`. **Do
  zrobienia (właściciel):** token beaconu i token API w Railway; TTFB i próg alarmu w czujkach.
  Poprawki kodu z researchu wydajności: `JobCard` jako komponent serwerowy (#391; jedyna
  wyspa = przycisk zapisu z `jobId`; względna data na serwerze po dniu kalendarzowym w
  Brukseli — `src/lib/relative-date.ts`, zmienia się tylko o północy, zgodna z ISR), dialogi
  na `LightDialog*` bez przeliczania stylów całej strony przy otwarciu, z treścią montowaną
  w osobnym zadaniu po ramce z nakładką (#393; INP otwarcia < 100 ms przy CPU 4×,
  `dialog-open-inp.spec`), długi cache
  obrazów z optymalizatora i plików `public/` (#394). Font jako podzbiór łaciński (#388: Inter ~73 KB, od #5/#7 DM Sans ~42 KB; przepis
  `scripts/subset-font.py`, fonty zastępcze z metrykami w `globals.css`) i baner zgód
  w HTML z serwera, ukrywany przed malowaniem przy zapisanej zgodzie (`consent-boot.ts`, #389);
  „Przejdź do treści” renderuje `[locale]/layout` przed banerem, każdy układ ma `#main-content`.
  Zod poza JS stron publicznych (#390): helpery adresu `next` (`safeNextPath`, `loginHref`,
  `registerHref`, `relocalizeNextParam`) w `src/lib/auth/next-path.ts` bez Zoda; schematy
  zostają w `validation/auth`. Straże: graf importów `public-bundle-no-zod.test` i chunki
  z `ZodError` w `check-next-build.mjs` (layout `(public)`, home, lista ofert, poradnik).
  Szczegół oferty bez Zoda i `libphonenumber-js` w przeglądarce (#1055, bez migracji): stałe
  dostępności formularza aplikowania w `src/lib/apply/availability.ts` (bez zależności;
  `validation/application.ts` je re-eksportuje), `ApplyModal`/`GuestApplyForm` importują stąd —
  JS trasy `oferty-pracy/[slug]` 243,3 → 178,8 KB gzip. Strażnik grafu `public-bundle-no-zod`
  obejmuje szczegół oferty i `libphonenumber-js` (kontrola ujemna: komponent kliencki ze schematem
  aplikacji), `check-next-build.mjs` sprawdza chunki szczegółu (`ZodError`, `country_calling_codes`).
  Strony publiczne statyczne/ISR (#298): layout `(public)` woła `setRequestLocale` i podaje
  `locale` jawnie do Header/Footer, a `[locale]/layout` do SkipLink (inaczej next-intl czyta `headers()` → SSR `no-store`).
  Unieważnianie cache po zmianie cyklu życia oferty (#775, bez migracji): `publishJob`,
  `setJobStatus` (pause/resume/close/reopen) i `expire_due_jobs` w `/api/maintenance` (gdy
  wygasiła choć jedną ofertę) wołają wspólny `revalidatePublicJobPaths()`
  (`src/lib/jobs/public-cache.ts`) — rewaliduje wzorce z dynamicznym segmentem + typ `'page'`
  jako ŚCIEŻKI PLIKÓW tras z grupą (`PUBLIC_JOB_ROUTES`: `/[locale]/(public)`, szczegół oferty,
  `/praca`, landingi kategorii/miasta, profil firmy i jego strony), więc bez znajomości
  dokładnego sluga/kategorii/miasta zmienionej oferty. #1216 (PERF-02): niejawne tagi wpisu ISR
  Next liczy ze ścieżki pliku łącznie z `(public)` — wzorce bez grupy nie unieważniały niczego.
  Strażnik `public-job-cache-tags` (bez atrapy `next/cache`): prawdziwe `revalidatePath`
  w `workAsyncStorage`, tagi wpisu z prawdziwego `getImplicitTags`, lista = każda strona `(public)`
  z `revalidate = 60`, wpis w `cacheHandler` znika po rewalidacji; kontrola ujemna wzorców bez
  grupy. Poza zakresem: ścieżki `/employer…` bez `[locale]` w akcjach paneli. Wcześniej te akcje nie unieważniały publicznego ISR wcale (publish) albo
  tylko widoków panelu (setJobStatus) — poprzednio wyrenderowana strona (i `JobPosting`) mogła
  zostać widoczna jeszcze przez okno rewalidacji (60 s) po pauzie/zamknięciu/wygaśnięciu, a
  nowo opublikowana/wznowiona oferta nie pojawiała się od razu. Rewalidacja następuje wyłącznie
  po udanej transakcji (błąd RPC → bez wywołania). Testy: `job-lifecycle-public-cache`,
  `job-expiry` (kontrola ujemna: 0 wygaszonych ofert i błąd RPC nie rewalidują niczego).
  Oferty (home, `/praca`, landingi, szczegół) `revalidate = 60`, treść `3600` (layout). Przy
  `DATABASE_APP_URL` build nie czyta bazy: landingi przez `prerenderParamsAtBuild` (strony na pierwsze
  żądanie), odczyty ofert w `next build` zwracają pusty wynik (`isBuildPhase`), a layout `[locale]`
  ZAWSZE prerenderuje komplet języków — pusta lista dawała 500 DYNAMIC_SERVER_USAGE na logowaniu,
  rejestracji i liście ofert (strażnik `static-public-pages.test`);
  layout `(public)` odrzuca nieobsługiwany locale (`notFound`). Middleware: bramka hasła i
  odświeżone cookies sesji → `private, no-store`; alias miasta → 308 w middleware (redirect z ISR
  dublował `Location`). Własny `cacheHandler` (`src/lib/cache/isr-cache-handler.mjs`, `next.config.mjs`): LRU w pamięci
  (64 MB / 2000 wpisów), 404 losowych slugów tylko w puli pamięci (200 wpisów, TTL 60 s) — nigdy
  na dysku; wpisy runtime w `.next/cache/isr-handler` (256 MB / 5000 wpisów / 4 MB na wpis,
  najstarsze usuwane, indeks odbudowany po restarcie); strony z buildu czytane z `.next/server/app`
  bez nadpisywania; cache obrazów bez zmian. Testy: `isr-cache-handler.test` (mutacja detektora
  404 = czerwony), E2E `public-cache-headers` (40 losowych slugów = 0 plików; bez handlera +120). Straże: `static-public-pages.test`, `check-next-build.mjs`
  (prerender), E2E `public-cache-headers.spec`. Lista `/oferty-pracy` (filtry), auth, panele — per żądanie.
- [x] Dokumentacja (architektura, setup, checklisty) — podstawa
  Wydanie 1.0.0 (#103): kryteria, blokery i procedura (decyzja właściciela, zielone CI, SHA
  wdrożenia, tag `v1.0.0`, `CHANGELOG.md`) w `docs/RELEASE_1_0.md`. Build zostaje `0.YYYYMMDD.M+SHA`
  do jawnego `PRACUJBE_RELEASE_VERSION=1.0.0` (→ `1.0.0+SHA`); inna wartość przerywa build
  (`scripts/build-version.mjs`, `build-version.test.ts`).
  Strażnik zmiennych środowiska (`tests/unit/production-config-checklist.test.ts`): każda
  zmienna czytana w `src/`, `scripts/` (`.ts/.tsx/.mjs/.py`: `process.env.X`, `env.X`/`source.X`,
  destrukturyzacja, `helper(env, 'X')`, literały przy dynamicznym `env[name]`) i `next.config.mjs`
  musi mieć wpis z komentarzem w `.env.example` i w `docs/railway/KONFIGURACJA_PRODUKCJI.md`
  (skrypty operatora i usługi pomocnicze = sekcja 2E, zakomentowane w przykładzie); zmienne
  platformy/testów/CI (`E2E_PG*`, `VIES_LIVE_SMOKE`, `GITHUB_*`…) na allow-liście z uzasadnieniem;
  kontrola ujemna: zmienna tylko w kodzie = czerwony. Skrypty `*.sh` nie są skanowane.
  Stan migracji produkcji w dokumentach startowych: `docs/LAUNCH_CHECKLIST.md` §0 (wiersz „Baza”),
  §4 i sekcja 0 tego pliku podają ten sam numer ostatniej zastosowanej migracji (27.09.2026:
  `0148`). Strażnik `launch-checklist-migrations.test.ts`: trzy miejsca zgodne, numer istnieje
  w `supabase/migrations`/`database/*`, punkt „[ ]” w §4 i „`main` ma …” w §0 nie wskazują
  migracji już zastosowanej (kontrole ujemne, w tym stan sprzed 27.09 z `0145` „do
  zastosowania”). Nowa migracja na `main` nie wymaga zmiany dokumentów; po `apply` numer
  przesuwa człowiek (strażnik nie zna stanu produkcji).
- [x] Dane seed pełne — 10 firm / 50 ofert / 40 kandydatów / 48 aplikacji / 80 dopasowań; ładuje się bez błędów (guard CI `test:seed`)

---

## 12. Komendy

```bash
npm install            # instalacja
npm run dev            # dev server (http://localhost:3000/pl)
npm run build          # build produkcyjny
npm run start          # serwer produkcyjny
npm run lint           # ESLint: src/, tests/, scripts/ (.eslintrc.json ma "root": true)
npm run typecheck      # tsc --noEmit
npm run test           # Vitest (unit)
npm run test:e2e       # Playwright (port E2E_PORT, domyślnie 3000; cudzy serwer tylko z E2E_REUSE_SERVER=1)
E2E_PORT=3517 npx playwright test tests/e2e/smoke.spec.ts  # równolegle z innym przebiegiem — docs/E2E_FLAKY_REPORT.md
npm run test:e2e:real  # Playwright + izolowany PostgreSQL 16 (E2E_PG*; przepływ kandydat ↔ pracodawca)
npm run verify         # lint + typecheck + test (uruchamiaj przed commitem)
npm run test:rls       # migracje od zera + testy RLS na lokalnym PostgreSQL 16
npm run db:migrate:production  # migracje na wskazanej bazie (MIGRATION_DATABASE_URL, MIGRATION_MODE)
```

---

## 13. Konwencje kodu

- Komponenty serwerowe domyślnie; `"use client"` tylko gdy potrzebne (interakcje/hooki).
- Walidacja I/O = Zod; typy z `z.infer`. Brak `any` (strict).
- Teksty przez `useTranslations`/`getTranslations` (next-intl) — nigdy literały w JSX.
- Dostęp do DB: `src/lib/db/portal.ts` + `src/lib/db/sql.ts` (#25); nazwy zapytań/funkcji tylko stałe, wartości w `$n`. Operacje wrażliwe = Server Actions/route handlers.
- Błędy: rzucaj `AppError` z kodem (`src/lib/errors`); mapuj na komunikat tłumaczony.
- Nazwy plików: `kebab-case`; komponenty React: `PascalCase`.
- Lint (`eslint` CLI zamiast przestarzałego `next lint`, ta sama konfiguracja i wersja ESLint 8) obejmuje `src/`, `tests/`,
  `scripts/` oraz pliki `*.config.{mjs,ts}` z korzenia; `.eslintrc.json` ma `"root": true`,
  więc worktree w `.claude/worktrees/` nie dziedziczy konfiguracji z checkoutu nadrzędnego (konflikt
  pluginu `@next/next`). Reguł nie wyłączamy globalnie — lokalny `eslint-disable` tylko z komentarzem
  uzasadnienia (np. `require` w preloadzie CommonJS `tests/e2e-real/support/server-only-hook.cjs`).
- Każdy nowy przepływ krytyczny = test (unit i/lub e2e).

---

## 14. Uwaga o zakresie

Specyfikacja opisuje produkt wielkości pracy zespołu na tygodnie. Repo jest budowane
**etapami** (patrz roadmapa). Nie udawaj, że wszystko jest gotowe — aktualizuj sekcję
statusu zgodnie z rzeczywistością po każdej zmianie. Kluczowe procesy mają być **realne**
(prawdziwa DB, nie mock) — patrz sekcja 33 specyfikacji: bez mock API dla rejestracji,
logowania, profilu, ofert, aplikacji, propozycji, wiadomości, powiadomień, języków, cookies.
