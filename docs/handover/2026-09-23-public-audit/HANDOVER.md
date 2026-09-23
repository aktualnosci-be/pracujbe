# Handover — audyt i poprawki publicznej części + integracja PR (23.09.2026, ok. 16:40 UTC)

Sesja integrująca: https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
Repozytorium: `aktualnosci-be/pracujbe`. Produkcja: Railway, jedna usługa z `main`, natywne „Wait for CI”.

> **Zasada nadrzędna:** nie ufaj temu dokumentowi bardziej niż GitHubowi. Każdy stan poniżej zweryfikuj
> komendami z sekcji 9 przed działaniem. SHA i numery PR są z chwili zakończenia sesji.

---

## 0. TL;DR — co zrobić najpierw

1. Sprawdź kolejkę CI (sekcja 9.2). W chwili zakończenia oczekiwały (kolejność FIFO współdzielonego runnera):
   `#187 (054d41b)` → **`main 1ad9c31` (run 35880665034)** → `#254` → `#256` (inna sesja) → **`main da68cec` (run 35888776954)** → `#257`.
2. **Scal [#246](https://github.com/aktualnosci-be/pracujbe/pull/246)** — CI 9/9 zielone dla `defba40` (run 35870370202). Sprawdź konflikty z `main` i scal (squash, `expectedHeadSha`).
3. Sprawdź wynik [#247](https://github.com/aktualnosci-be/pracujbe/pull/247) (P1, CTA pracodawcy) — mógł się zakończyć po moim odczycie.
4. Po zielonym CI `main 1ad9c31` → potwierdź wdrożenie Railway tego SHA (sekcja 9.4). **Produkcja stoi na `4447d00` (08:21 UTC).**
5. Wypychaj gotowe gałęzie jako PR-y **wg priorytetu z sekcji 5** (najpierw P1), max ok. 3 moje PR-y w kolejce naraz.
6. Po scaleniu #187 → zrób #244 (P1) i #245 (P2) od nowa na aktualnym `main` (oba dotykają `src/lib/data/candidate.ts`).

---

## 1. Kontekst i ograniczenia (od właściciela)

- Pracujemy małymi PR-ami: jeden PR = jedna logiczna poprawka, z testem regresyjnym i **kontrolą ujemną** (celowe przywrócenie błędu → test pada).
- Scalać tylko po **pełnym zielonym CI (9/9 jobów) dla dokładnego SHA gałęzi**, po sprawdzeniu konfliktów i ponownym sprawdzeniu `main`.
- Po scaleniu **sprawdzić wdrożenie Railway**, zanim napiszesz, że zmiana działa na produkcji.
- **CI:** jeden współdzielony self-hosted runner, joby są serializowane (grupa `pracujbe-shared-runner-workspace`, `queue: max`). Nie uruchamiaj wielu przebiegów naraz. Nie wypychaj pustych commitów „na odświeżenie”. Nie ponawiaj działających przebiegów. Awaria runnera z #50 wymaga diagnostyki hosta; nie ma dostępu SSH.
- **Nie zmieniaj** `runs-on` na `ubuntu-latest`. Kolejność jobów pilnuje `scripts/check-ci-serialization.mjs`.
- **#61:** nie publikuj wymyślonej polityki prywatności ani danych kontaktowych. Treści zatwierdza właściciel. #133 czeka na #61.
- Tylko 4 języki: PL/NL/FR/EN. **Nie dodawaj RO/UK.**
- **Inna sesja** prowadzi Railway/PostgreSQL (#159 scalony, #242 scalony, #256 otwarty). Nie zmieniaj ich gałęzi (`claude/zealous-meitner-2zl2v3`) ani obszaru (migracje, `supabase/tests/*`, role DB).
- Produkcja tylko na Railway, z `main`, bez stagingu i bez monetyzacji (#51).
- Właściciel zdecydował (AskUserQuestion) dla #187: scenariusze z danymi fikcyjnymi uruchamiać **osobnym krokiem w jobie E2E**, a nie przez samo `testIgnore`.
- Właściciel zgodził się na #127 (build reuse), ale **nie** na priorytetową grupę concurrency dla `main` (niebezpieczna przed etapem 2 z #50).

---

## 2. Co zostało scalone w tej sesji

| PR | Temat | Squash SHA na main |
|---|---|---|
| [#199](https://github.com/aktualnosci-be/pracujbe/pull/199) | błąd zamiast pustej listy ofert pracodawcy (#185) | `732c684` |
| [#198](https://github.com/aktualnosci-be/pracujbe/pull/198) | karta tożsamości kandydata (#172) | `0c0f34f` |
| [#178](https://github.com/aktualnosci-be/pracujbe/pull/178) | walidowany eksport baneru (#175) | `1ad9c31` |
| [#241](https://github.com/aktualnosci-be/pracujbe/pull/241) | przycisk zmiany zgód na /polityka-cookies (#235) | `da68cec` |

Inna sesja scaliła w tym czasie #242 (`83d2872`). Obecny `main` = **`da68cec`**.

**Żadna z tych zmian nie jest jeszcze na produkcji** (patrz sekcja 3).

---

## 3. Railway i CI — kluczowy problem operacyjny

- Ostatnie udane wdrożenie Railway: **`4447d002`**, deployment `3b57fe36-4613-4497-a6f9-d68467bee128`, 08:21 UTC.
- Railway: projekt `captivating-vision` (`48e730ef-dc35-489f-8d09-4a4da0fcda55`), serwis web `cfc05c59-39ef-4555-9c67-7b888ee07c3c`, środowisko `d0c9b3d0-5ae3-4a4f-9332-3c3c74ebffc0`. Postgres: serwis `16a53eb4-59ba-4ca2-97b1-a8e853aa29d8`.
- `https://pracuj.be/api/health` (14:05 UTC): `{"status":"ok","mode":"demo", checks: supabase:false, serviceRole:false, httpsSiteUrl:true, ...}`. **Produkcja działa w trybie demo**, nie ogłaszaj produkcyjnej bazy.
- **Mechanizm opóźnień:**
  - Railway wdraża SHA z `main` po jego zielonym CI (`Wait for CI`).
  - Przebieg `main` czeka w tej samej kolejce FIFO co wszystkie PR-y. Pełny przebieg trwa ok. 15–20 min.
  - Rano oczekujące przebiegi `main` znikały jako `cancelled` z 0 jobów przy kolejnym pushu. Po 15:00 takie przebiegi zostają w kolejce, więc każdy pełny przebieg `main` zajmuje runner.
  - Opisane w komentarzu w [#15](https://github.com/aktualnosci-be/pracujbe/issues/15#issuecomment-5796246753).
- **Moja strategia:**
  - Zostaw **najwcześniejszy** oczekujący przebieg `main`, bo to najszybsza droga na produkcję. Teraz to `1ad9c31`, run `35880665034`.
  - Anuluj tylko **pośrednie** oczekujące przebiegi `main` między najwcześniejszym a najnowszym; nowszy `main` zawiera ich zmiany.
  - Anulowane w tej sesji (wszystkie jeszcze w kolejce, bez jobów): `35869498162` (8fc4ea4), `35877912770` (732c684), `35877947279` (0c0f34f), `35886915475` (83d2872).
- Po zielonym `1ad9c31` Railway powinien wdrożyć `1ad9c31`, a po zielonym `da68cec` wdrożyć `da68cec`. Zweryfikuj SHA wdrożenia (sekcja 9.4).
- **Railway MCP** zaczął zwracać błąd schematu (`Structured content does not match the tool's output schema`) dla `list-deployments`. Wcześniej działał. Alternatywa: GitHub Deployments API albo panel Railway.
- **PR [#254](https://github.com/aktualnosci-be/pracujbe/pull/254)** (`edd5c44`, Refs #127): E2E używa buildu z joba Build (cache Actions, klucz `next-build-<sha>-<run_id>-<attempt>`, `scripts/check-next-build.mjs`, fallback na build). Oszczędza ok. 2,5 min na przebieg. Po scaleniu zmierz medianę 3 przebiegów przed i po, i dopisz w #127.
  - Ryzyko: jeśli cache na self-hosted nie działa, E2E wróci do zwykłego buildu.
  - Kontrola ujemna skryptu: usunięty `routes-manifest.json` daje exit 1.
- Właściwa naprawa kolejki to etap 2 z #50: osobny `--work` dla każdego z runnerów `vps-d22a03f1` i `vps-d22a03f1-2`. Po nim można dać `main` własną grupę concurrency. **Wymaga hosta.**

---

## 4. PR-y otwarte w chwili zakończenia

| PR | Gałąź / SHA | Stan CI | Uwagi |
|---|---|---|---|
| [#246](https://github.com/aktualnosci-be/pracujbe/pull/246) | `claude/public-landing-h2` `defba40` | **9/9 zielone** | P2 #210, H2 na landingach. **Gotowy do scalenia.** |
| [#247](https://github.com/aktualnosci-be/pracujbe/pull/247) | `claude/public-employer-cta` `93626ce` | był w kolejce/w toku | P1 #201, martwe CTA `/dla-pracodawcow`. Sprawdź wynik. |
| [#187](https://github.com/aktualnosci-be/pracujbe/pull/187) | `codex/candidate-applications-pagination-180` `054d41b` | w kolejce | Przejęty od sesji Codex. Wcześniejszy run 35852915318 (405c96a) padł w 12 E2E. Poprawka w `054d41b` + merge `main` (`a3d9e12`): testy fixture wykluczone z głównego configu **i uruchamiane osobnym krokiem w jobie E2E**; limit 120 s w configu fixture; `waitForLoadState('networkidle')` przed kliknięciem. Lokalnie dwa zimne przebiegi 8/8 + 4/4. Komentarz w PR. |
| [#254](https://github.com/aktualnosci-be/pracujbe/pull/254) | `claude/ci-reuse-next-build` `edd5c44` | w kolejce | Refs #127 (sekcja 3). |
| [#257](https://github.com/aktualnosci-be/pracujbe/pull/257) | `claude/public-catch-all-404` `30b6445` | w kolejce | P1 #200: catch-all `[locale]/[...rest]` → `notFound()` + główny `not-found.tsx` z `lang`. Agent shell. |
| [#256](https://github.com/aktualnosci-be/pracujbe/pull/256) | `claude/zealous-meitner-2zl2v3` | w kolejce | **Inna sesja (DB), nie ruszać.** |
| [#128](https://github.com/aktualnosci-be/pracujbe/pull/128) | `codex/title-dup-118` `e0988e1` | run 35840648542, próba 2 była pending | Przejęty od Codex. Uwaga: podwójna marka zostaje też na `praca/kategoria`, `praca/miasto` i home (komentarz w #118), PR tego nie obejmuje. |
| [#133](https://github.com/aktualnosci-be/pracujbe/pull/133) | `codex/issue-6-email-footer-links` | — | Czeka na treści z #61. Nie scalać bez nich. |
| #70, #74 | `codex/serialize-shared-port-e2e`, `codex/actions-node24` | stare | Brak wspólnej bazy z `main` (`no merge base`). Nie dotykałem. |

---

## 5. Gotowe gałęzie bez PR — wszystkie wypchnięte na GitHub (bez PR, więc bez CI)

Każda gałąź to jeden commit z testem regresyjnym i opisaną kontrolą ujemną w commit message albo w opisie PR (`jd/pr/*.md`, `pr-216.md`). Lokalnie przeszły lint, typecheck i odpowiednie E2E. **Przed PR-em każdą zrebase'uj na aktualny `main`, zbuduj i powtórz E2E**, bo bazy są różne (kolumna „baza”).

Pełna tabela (gałąź, SHA, baza, refs, tytuł): [`branches.md`](./branches.md).

### Kolejność wypychania (P1 najpierw)

| # | Gałąź | Issue | Uwagi |
|---|---|---|---|
| 1 | `claude/public-detail-cta-bar` `c0666a7` (baza da68cec, już zrebase'owana) | P1 #202 | Opis PR: [`jd/pr/cta.md`](./jd/pr/cta.md) + dopisek „po rebase na da68cec: build + lint + typecheck + e2e cta-bar/passport/flows/smoke = 22 passed”. Commit bez „Closes”: dodaj `Closes #202` w PR. |
| 2 | `claude/public-cookie-banner-focus` `b473379` | P1 #203 + #206 | Portal banera za skip-linkiem, `--cookie-banner-h`, `max-h-[60dvh]`, zawijanie przycisków; `globals.css` scroll/padding-bottom. Test `tests/e2e/cookie-banner.spec.ts` (24). |
| 3 | `claude/public-filter-sidebar-sticky` `03f0a7a` | P1 #216 | Panel filtrów o wysokości viewportu z własnym scrollem; uwzględnia `--cookie-banner-h` (fallback 0). Opis: [`pr-216.md`](./pr-216.md). |
| 4 | `claude/public-auth-error-focus` `81379af` | P1 #217 | Fokus na komunikat po błędzie wysyłki (AuthForm, NewPasswordForm). |
| 5 | `claude/public-header-scroll-padding` `473555b` | P1 #208 | `html { scroll-padding-top: 5rem }` + test Shift+Tab na końcu `a11y.spec.ts`. Inny hunk `globals.css` niż nr 2. |
| 6 | `claude/public-filter-apply-without-count` `9800e99` | P1 #220 | Przycisk nie jest wyłączany przy awarii licznika; bez liczby pokazuje `jobs.filterButton`; zmienia `tests/unit/job-filter-live-facets.test.tsx` (zgoda integratora). |
| 7 | `claude/public-mobile-locale-touch` `9ea4a5b` | P1 #243 | Lista języków w menu mobilnym otwiera się nad przyciskiem (agent shell). |
| 8 | `claude/public-auth-login-next` `92526ce` | P1 #223 (Refs) | `safeNextPath` w `src/lib/validation/auth.ts` (tylko `/{locale}/…`, bez `//`, schematów, backslasha, znaków sterujących, max 512); `signIn`/rejestracja/callback. **Bezpieczeństwo (open redirect): przejrzyj dokładnie.** Druga część: linki z `?next=` w `ApplyModal.tsx` (`LOGIN_HREF`), `PublicSavedJobs.tsx` i „Wyślij wiadomość” na detalu oferty — **niezrobiona**. |
| — | P2 (kolejność dowolna, uważaj na konflikty w tych samych plikach): |||
| | `claude/public-panel-noindex-121` `0de65f8` | #121 | Usuwa martwy `/pl/dashboard`; candidate/employer/admin × 4 języki; meta robots po sprawdzeniu URL i H1. noindex jest podwójnie (layout + page), więc kontrola ujemna wymagała usunięcia z obu. |
| | `claude/public-i18n-usage-test` `3612ef7` | #239 | AST: klucze `t()` istnieją; zgodność argumentów ICU; `KNOWN_MISSING` = 15 kluczy z #236. |
| | `claude/public-offline-cta-48` `67b5230` | #76 | CTA offline 48 px. |
| | `claude/public-offline-fallback` `1dd6607` | #248 | Nowy `public/offline.html` / SW w nowej identyfikacji. **Sprawdź zawartość i czy są nowe klucze `offline.*`.** Commit bez „Closes”. |
| | `claude/public-not-found-chrome` `99eb78d` | #249 | Nawigacja i tytuł 404. Zależy logicznie od #257. |
| | `claude/public-nav-a11y` `6b0389b` | #250 | Nazwy `nav`, `aria-current`, link domu w menu mobilnym. |
| | `claude/public-locale-lang-focus` `b9f517e` | #251 | `lang` na opcjach, fokus po zmianie języka. Konflikt z nr 7 w `LocaleSwitcher.tsx`/`MobileNav.tsx` możliwy. |
| | `claude/public-header-text-reflow` `1c993a5` | #252 | Nagłówek przy 768–1150 px i tekście 200%. |
| | `claude/public-footer-guides` `d8a1749` | #253 | Link do poradników w stopce. |
| | `claude/public-cookie-switch-contrast` `7e2c689` | #214 | Kontrast przełącznika zgód; inny fragment `CookieConsent.tsx` niż nr 2 (możliwy drobny konflikt). |
| | `claude/public-detail-dl` `88636c1` | #204 | `<dl>` (axe serious). Detal oferty nie jest w bramce `a11y.spec`. |
| | `claude/public-detail-sections` `8ad19fc` | #205 | Sekcje na desktopie nie zwijają się klawiaturą. |
| | `claude/public-detail-wrap` `93fa67b` | #211 | Zawijanie zamiast `truncate` przy 200%. |
| | `claude/public-detail-tabs` `1c5ef65` | #207 | **Nowy klucz `job.sectionsNav`** (messages). |
| | `claude/public-apply-modal-a11y` `d718501` | #209 | **Nowy klucz `apply.dialCode`** (messages). |
| | `claude/public-filter-results-plural` `9e9993a` | #226 | **Zmiana `filters.showResults` na ICU plural** (messages) + helper ICU w `job-filter-passport.spec.ts` i `public-zoom.spec.ts`. |
| | `claude/public-jobs-results-focus` `804b154` | #224 | H2 z licznikiem; fokus na H2 po zatwierdzeniu; dialog zaczyna od pierwszego pola. |
| | `claude/public-jobs-empty-exit` `df97197` | #228 | Reset słowa kluczowego i miasta; `?page` poza zakresem → ostatnia strona. |
| | `claude/public-jobs-chip-wrap` `dd58616` | #230 | Łamanie długich słów w chipach. |
| | `claude/public-jobs-sort-menu` `2356c78` | #233 (Refs) | `SortMenu` z Escape i kliknięciem poza; cele chipów 44 px do dokończenia po #230. |
| | `claude/public-hub-tiles-reflow` `24f4ff7` | #213 | Siatka `auto-fill minmax(min(100%,18rem),1fr)` + `break-words`. |
| | `claude/public-landing-breadcrumbs` `f9aeea9` | #215 | Nowy `src/components/public/Breadcrumbs.tsx`, `min-h-11`. |
| | `claude/public-city-alias-redirect` `bed9b2e` | #219 | `city-alias.ts` 308 z tłumaczeń `locations.*`; nowe `praca/kategoria/page.tsx`, `praca/miasto/page.tsx` → `/praca`. |
| | `claude/public-guides-text-wrap` `2051cbe` | #237 | `break-words hyphens-auto` w poradnikach. |
| | `claude/public-guides-breadcrumb-current` `86e1d15` | #238 | `aria-current` w breadcrumbie poradników. |
| | `claude/public-guides-reading-time` `c703904` | #240 | Czas czytania z treści (200 słów/min); **E2E na tej gałęzi nie uruchomione**, tylko unit. |
| | `claude/public-auth-h1` `22c8a17` | #225 | `CardTitle` z opcjonalnym `as` (domyślnie `div`, panele bez zmian). |
| | `claude/public-auth-validation` `c5224bc` | #227 | `.min(1, …Required)`; zgoda przez `z.custom` `fatal:false`; kontrakt `registerEmployerSchema.innerType().shape` zachowany. |
| | `claude/public-auth-locale-switcher` `f4a5267` | #231 | `LocaleSwitcher` w layoucie auth. Uwaga: przy zmianie języka `?next=` zostaje w starym locale. |
| | `claude/public-auth-login-employer-link` `ce8641e` | #232 | Link do rejestracji pracodawcy na logowaniu. |

Gałęzie robocze `claude/public-wip-*` są puste (= stary `main`) i można je usunąć. Nie wypychałem ich.

### Niezrobione (issue istnieje)

- #222 (stan ładowania filtrów): budować na #220 po jego scaleniu.
- #229 (linki w zgodzie przy rejestracji; rich text `auth.agreeTerms`): wymaga blokady messages, bez nowych treści prawnych.
- #212 (fokus po zamknięciu banera): po scaleniu `cookie-banner-focus`.
- #218 (token `--input` 1,35:1): globalny, dotyka paneli. Zrobić na końcu, z przeglądem paneli.
- #221 (rozszerzenie bramki `a11y.spec` na wszystkie trasy): **dopiero po scaleniu poprawek**, inaczej padnie.
- #223, część detalu: linki z `next` (patrz nr 8).
- #234 (test GA zawsze przechodzi): wymaga zmiany CI/configu; tylko issue.
- #236 (brakujące klucze `application.error.*` / `offer.error.*`).
- #255 (niestabilny `jobs-list-header` „bez JS”, 2 porażki na 32 na czystym `main`).
- #244 (P1) i #245 (P2): po scaleniu #187, od nowa na aktualnym `main`. Lokalna praca Codex (`C:\Users\matma\...\pracujbe-candidate-dashboard-read-errors-244`) nie jest dostępna w chmurze, więc nie traktuj jej jako zrobionej.
- #145: dodano komentarz z odtworzeniem (błąd walidacji telefonu pokazywany jako ogólny; w demo `jobId` = „1002”, nie UUID, więc każda próba aplikowania kończy się błędem).
- #189: dodano komentarz (zmiana języka z `?location=Bruksela`).
- #61: komentarz o placeholderach stron prawnych (bez proponowania treści).

---

## 6. Issues utworzone w tej sesji

P1: #200, #201, #202, #203, #206, #208, #216, #217, #220, #223, #243.
P2: #204, #205, #207, #209, #210, #211, #212, #213, #214, #215, #218, #219, #221, #222, #224, #225, #226, #227, #228, #229, #230, #231, #232, #233, #234, #235, #236, #237, #238, #239, #240, #248, #249, #250, #251, #252, #253, #255.
Komentarze: #15 (Railway), #187 (poprawka E2E), #118, #145, #189, #61.

Raporty audytu z krokami odtworzenia: `auth-candidate.md`, `employer-prelogin.md`, `jobs-list.md`, `job-detail.md`, `city-category.md`, `content-pages.md`, `shell.md`, `a11y-crosscut.md`, `i18n-tests.md` (w tym katalogu). Skrypty Playwright do odtworzenia leżą w podkatalogach (`a11y/`, `jd/`, `cc/`, `shell/`, `content/`, `i18n/`, `employer/`, `auth-candidate/`, `jobs-list-scripts/`).

---

## 7. Ustalenia audytu potwierdzone, ale bez osobnego issue (do rozważenia)

- `src/app/[locale]/layout.tsx` wysyła do przeglądarki cały katalog tłumaczeń (ok. 60 KB), w tym teksty płatności z #51 (niewidoczne).
- `JobCard.tsx` przepełnia się przy 640 px i tekście 200% (zgłoszone przez 2 audytorów).
- `LocaleSwitcher` ma 36 px wysokości.
- Sam kafelek logo `.be` i ikony rozpychają nagłówek do 453 px przy 320 px i tekście 200% (`Header.tsx`, `Logo.tsx`; logo to obszar #7).
- `mapAuthError` zamienia `email_not_confirmed` na „Nieprawidłowy e-mail lub hasło” (tylko z kodu, wymaga Supabase).
- `error.tsx` woła samo `reset()` bez `router.refresh()` (tylko z kodu).
- Canonical/hreflang lokalnie wskazują `localhost:3000` (fallback `env.siteUrl`, nie błąd kodu). Dlatego `seo.spec.ts` pada lokalnie na innych portach.
- CLAUDE.md, Invariant #2: zdanie „test wykrywa brakujące/nieużywane klucze” jest nieprawdziwe. Po #239 wykrywa brakujące, ale nie nieużywane.

---

## 8. Jak pracowałem (proces z agentami)

- Faza 1: 9 równoległych agentów audytu, tylko do odczytu, na wspólnym serwerze demo `:3100`.
- Faza 2: każdy agent miał własny worktree `/workspace/wt/<nazwa>` i **wyłączną listę plików**:
  - cookies: `src/components/cookies/**`, `globals.css`, `a11y.spec`
  - shell: 404/error/offline/Header/MobileNav/LocaleSwitcher/Footer
  - jobs: lista ofert, FilterSidebar, FilterSheet, Pagination
  - detail: `[slug]/page.tsx` (bez `generateMetadata`), ApplyModal, PublicSavedJobs
  - auth: `src/components/auth/**`, `(auth)/**`, `validation/auth.ts`, `actions/auth.ts`, `ui/card.tsx`
  - city: `praca/**`, LandingHubGrid, Breadcrumbs
  - content: poradniki, `_legal`, polityka-cookies, `guides.ts`
  - tests: `seo`/`flows`/`smoke`.spec, `tests/unit/i18n-*`
  - employer: HeroSearch, ForCompanies
- Blokady plikowe (w scratchpadzie, znikają z kontenerem):
  - `locks/messages`: jeden właściciel zmian `src/messages/*.json` naraz. W chwili zakończenia trzymał ją agent jobs dla #226; gałęzie #207 i #209 czekały.
  - `locks/ci-slot-{1,2,3}`: max 3 moje PR-y w kolejce CI.
  - `locks/build.lock`: jeden `next build` naraz, przez `flock`.
- **Pułapka:** `git stash` jest wspólny dla wszystkich worktree. Do kontroli ujemnych używaj kopii plików albo `git checkout origin/main -- plik`, nie stasha.
- **Pułapka:** `pkill -f "next start -p N"` potrafi zabić powłokę wywołującą (exit 144). Zabijaj po PID z `lsof -i :N` / `ss -ltnp`.
- Lokalnie zawsze pada `tests/unit/organic-story-assets.test.ts` (brak `chrome-headless-shell-1228` w `/opt/pw-browsers`); tak samo na czystym `main`. W CI przechodzi.

---

## 9. Komendy (wszystkie użyte w sesji)

### 9.1 Przygotowanie środowiska (kontener chmurowy)

```bash
cd /workspace/pracujbe
git fetch origin
git checkout main && git pull --ff-only origin main
npm ci --no-audit --no-fund          # ok. 1,1 GB node_modules
npm run build                        # tryb demo, bez env
# Serwer do audytu/testów (port dowolny ≠ 3000, jeśli CI/inna sesja używa 3000):
npx next start -p 3100 > /tmp/server.log 2>&1 &
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/pl
```

Playwright w kontenerze: przeglądarka w `/opt/pw-browsers/chromium` (wersja domyślna Playwrighta nie istnieje, nie uruchamiaj `playwright install`):

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/<plik>.spec.ts
# playwright.config.ts czyta PLAYWRIGHT_CHROMIUM_PATH; serwer startuje na :3000 (reuseExistingServer lokalnie)
```

Worktree i config dla innych portów ([`pw.worktree.config.mjs`](./pw.worktree.config.mjs), umieść jako `/workspace/wt/pw.config.mjs` i dodaj symlink `/workspace/wt/node_modules`):

```bash
git worktree add -b claude/public-<temat> /workspace/wt/<nazwa> origin/main
ln -s /workspace/pracujbe/node_modules /workspace/wt/<nazwa>/node_modules
ln -s /workspace/pracujbe/node_modules /workspace/wt/node_modules
cd /workspace/wt/<nazwa> && npm run build
WT=/workspace/wt/<nazwa> PORT=3201 npx playwright test --config /workspace/wt/pw.config.mjs <plik|grep>
```

Skrypty audytowe (`node <plik>.js`) używają `require('/workspace/pracujbe/node_modules/playwright')` i `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. Oczekują serwera na `:3100`.

### 9.2 Stan GitHub i CI (brak `gh` CLI, używaj GitHub MCP)

- Lista PR: `mcp__github__list_pull_requests` (`state: open`).
- Przebiegi: `mcp__github__actions_list` `method: list_workflow_runs` (filtr `status: pending` / `completed`).
- Kontrole PR: `mcp__github__pull_request_read` `method: get_check_runs`. **Wymagane 9 jobów:** Install & cache deps, Lint, Typecheck, Unit tests (Vitest), SCA (npm audit), Build (Next.js), RLS integration (PostgreSQL 16), Migration runner (PostgreSQL 16), E2E (Playwright).
- Log joba: `mcp__github__get_job_logs` (`job_id`, `return_content: true`, `tail_lines: 150`).
- Anulowanie **oczekującego** pośredniego przebiegu `main`: `mcp__github__actions_run_trigger` `method: cancel_workflow_run` (bywa 502, wtedy ponów raz).
- Scalanie: `mcp__github__merge_pull_request` `merge_method: squash`, `expectedHeadSha: <pełny SHA>`.

Konflikty z `main` przed scaleniem:

```bash
cd /workspace/pracujbe && git fetch -q origin
git merge-tree --write-tree origin/main origin/<gałąź> >/dev/null && echo clean
# gdy lokalny ref jest niejednoznaczny (gałąź istnieje też lokalnie):
git fetch -q origin <pełny SHA> && git merge-tree --write-tree origin/main <pełny SHA> >/dev/null && echo clean
git ls-remote origin 'refs/heads/claude/public-*'
```

Przed pushem gałęzi (wymagane przez repo):

```bash
npm run lint && npm run typecheck && npm test          # = npm run verify
node scripts/check-ci-serialization.mjs                  # gdy dotykasz .github/workflows
npm run build && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test <dotknięte spec>
```

Rebase gotowej gałęzi i push (bez force na cudzych gałęziach; na własnych `claude/public-*` rebase jest OK przed pierwszym PR):

```bash
cd /workspace/wt/<nazwa>
git fetch origin main && git checkout <gałąź> && git rebase origin/main
npm run build && npm run lint && npm run typecheck && <E2E>
git push -u origin <gałąź>          # po rebase już wypchniętej gałęzi: --force-with-lease (tylko własne claude/public-*)
```

Commit message (wymóg sesji):

```
<tytuł po polsku>

<opis>

Closes #NNN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XVJ4Hs1HCb3iGP8yRhBPkV
```

Treść PR: sekcje `## Zmiana`, `## Dlaczego` (Closes #N), `## Testy` (lokalnie + kontrola ujemna), `## Ryzyko`, `## Cofnięcie`. Na końcu:
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Komentarze i issues na GitHubie kończ stopką `---` + `_Generated by [Claude Code](https://claude.ai/code)_`.

### 9.3 #187: uruchomienie testów fixture lokalnie

```bash
cd /workspace/wt/pr187      # albo świeży checkout codex/candidate-applications-pagination-180
cat > .local-fixture.config.ts <<'EOF'
import base from './playwright.applications-fixture.config';
export default { ...base, projects: base.projects!.map(p => ({ ...p, use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } })) };
EOF
rm -rf .next
TEST_APPLICATIONS_FIXTURE=full  npx playwright test --config .local-fixture.config.ts   # 8 testów
TEST_APPLICATIONS_FIXTURE=error npx playwright test --config .local-fixture.config.ts   # 4 testy
rm .local-fixture.config.ts     # NIE commituj
```

### 9.4 Weryfikacja wdrożenia

```bash
curl -sS -m 20 https://pracuj.be/api/health     # status/mode; bez sekretu nie zwraca SHA
curl -sS -m 20 -o /dev/null -w '%{http_code}\n' https://pracuj.be/pl
```

Railway MCP: `mcp__Railway__list-deployments` z `projectId: 48e730ef-dc35-489f-8d09-4a4da0fcda55`, opcjonalnie `status: SUCCESS`. Porównaj `meta.commitHash` z SHA `main`. Pod koniec sesji narzędzie zwracało błąd schematu; wtedy panel Railway albo GitHub Deployments.

---

## 10. Pliki w tym katalogu

- `HANDOVER.md`: ten dokument.
- `branches.md`: tabela wszystkich 43 wypchniętych gałęzi (SHA, baza, refs, tytuł).
- `BRIEF.md` / `IMPL.md`: instrukcje dla agentów fazy 1 i 2 (reguły własności, blokad, testów, PR).
- `QUEUE.md`: ostatni stan kolejki pushy.
- `*.md` z raportami audytu (9 obszarów), `jd/pr/*.md` i `pr-216.md` z gotowymi opisami PR.
- `pw.worktree.config.mjs`: config Playwright dla worktree (`WT`, `PORT`).
- Podkatalogi ze skryptami odtworzenia (Node + Playwright).
