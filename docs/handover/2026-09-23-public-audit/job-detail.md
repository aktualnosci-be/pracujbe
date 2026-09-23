# Audyt: szczegóły oferty i aplikowanie (`/{locale}/oferty-pracy/[slug]`)

Środowisko: `next start` na http://localhost:3100, tryb demo (bez bazy), `main` @ f11170e, Chromium z Playwright.
Slugi użyte: `bricklayer-brussels-1002` (z podobnymi ofertami), `office-cleaner-brussels-1004` (bez podobnych),
`nie-istnieje-xyz`, `bricklayer-brussels-9999`. Skrypty: `audit/jd/t1.js` … `t10.js`, zrzuty: `audit/jd/*.png`.

Ścieżka pliku strony: `src/app/[locale]/(public)/oferty-pracy/[slug]/page.tsx` (dalej: **page.tsx**).

## Co działa (sprawdzone, bez zgłoszeń)
- ApplyModal: fokus w dialogu od razu po otwarciu (na „Zamknij”), Tab/Shift+Tab w pętli wewnątrz dialogu, Escape zamyka, fokus wraca na wyzwalacz.
- Puste wysłanie: `aria-invalid` + `aria-describedby` na telefonie i zgodzie, fokus na pierwsze błędne pole, komunikaty zrozumiałe (4 języki).
- Dwuklik „Wyślij aplikację” wysyła 1 żądanie (blokada `submitting` działa).
- Dialog na 320 px (FR) i przy 640 px + tekst 200%: brak obcięć, przewija się w pionie.
- Nieistniejący slug: HTTP 404, `noindex` (meta i `X-Robots-Tag`), poprawne `lang` i tłumaczenie w pl/nl/fr/en; długi slug (3000 znaków) i znak zerowej szerokości też dają 404.
- Brak poziomego przewijania dokumentu przy 320/375 px i przy 640 px + 200%; `lang` poprawny, brak surowych kluczy i18n; hreflang i canonical obecne.
- JobMatchCard dla anonima nic nie renderuje, bez błędów w konsoli.
- #191 (awaria podobnych ofert): w trybie demo podobne oferty ładują się poprawnie. Nie potwierdzam i nie powtarzam tego zgłoszenia.

---

## 1. [P1] Dolny pasek CTA na mobile: przycisk „Aplikuj” wychodzi poza ekran, pasek zajmuje do 31% wysokości
WCAG 1.4.10 Reflow, 1.4.4 Resize text; główne CTA.

**Kroki:** viewport 320×640, `/fr/oferty-pracy/bricklayer-brussels-1002` (zrzut `jd/s-320-100-fr.png`).
- **Obecnie:** przycisk zapisu w pasku pokazuje całe zdanie o stanie („Un compte candidat et un service connecté sont nécessaires”). Ma 133×102 px, a „Postuler maintenant” sięga do `right=363` przy ekranie 320 px, więc tekst CTA jest obcięty (widać „Postuler maintena”). Pasek ma 127 px wysokości, a odstęp pod treścią (`h-20`) tylko 80 px. Przy 640×800 i tekście 200% pasek ma 251 px (31% ekranu). W PL/EN obcięcia nie ma, ale pasek jest równie wysoki.
- **Oczekiwane:** pasek ma jedną linię i wysokość około 72 px. CTA mieści się w całości (≥ 48 px wysokości, zgodnie z #76). Przycisk zapisu to ikona 48×48 z nazwą dostępną, a opis stanu jest przekazany przez `aria-describedby` lub tooltip.
- Dla anonima w produkcji etykieta brzmi `jobs.saveLogin` („Connectez-vous pour enregistrer cette offre”), czyli ma podobną długość, więc problem nie dotyczy tylko trybu demo.

**Zakres:** szczegóły oferty, wszystkie języki (obcięcie widoczne w FR), szerokość poniżej `lg`.
**Pliki:** page.tsx (dolny pasek, ok. l. 615–627: `PublicSaveJobButton className="flex-1"` → `iconOnly`, bez `flex-1`; odstęp dopasowany do wysokości paska), `src/components/public/PublicSavedJobs.tsx` (tryb `iconOnly`: długi opis stanu jako `aria-describedby` / sr-only zamiast widocznej etykiety).
**Messages:** nowe klucze niepotrzebne (`jobs.save`, `saveLogin`, `saveUnavailable` wystarczą).
**Test regresyjny:** e2e dla 4 języków przy 320 px: `boundingBox()` przycisku „Aplikuj” mieści się w `[0, viewport.width]`, wysokość paska ≤ 80 px, cel ≥ 48 px. Obecny test `public-zoom` sprawdza tylko `scrollWidth` dokumentu, a pasek `fixed` go nie zwiększa.

## 2. [P1] Fokus zasłonięty przez stały pasek, końcówka stopki niedostępna
WCAG 2.4.11 Focus Not Obscured (Minimum).

**Kroki:** 375×740, `/pl/oferty-pracy/bricklayer-brussels-1002`, cookies zaakceptowane, przechodzenie Tabem (`jd/t5.js`).
- **Obecnie:** kolejne elementy dostają fokus w całości pod paskiem (górna krawędź paska = 613 px): nagłówki akordeonów „Zakres obowiązków” i „Co oferujemy” (top 614/617), „Wyślij wiadomość” (616), linki stopki „O nas”, „Pytania i odpowiedzi”, „Kontakt”, przycisk „Język” (624). Po przewinięciu do końca strony przełącznik języka „Polski” i wiersz wersji zostają pod paskiem, bo odstęp 80 px jest mniejszy niż pasek 127 px.
- **Oczekiwane:** element z fokusem jest zawsze widoczny nad paskiem, a na końcu strony nic nie jest przykryte.

**Pliki:** page.tsx (oznaczyć pasek, np. `data-mobile-cta`, odstęp równy wysokości paska), `src/app/globals.css` (np. `html:has([data-mobile-cta]) { scroll-padding-bottom: <wys. paska + margines> }` poniżej `lg`).
**Messages:** nie.
**Test regresyjny:** e2e przy 375 px: Tab przez całą stronę i przy każdym kroku sprawdzenie, że `activeElement.getBoundingClientRect().bottom <= bar.top` (z pominięciem elementów samego paska); po przewinięciu do końca przełącznik języka ma być nad paskiem.

## 3. [P1] Błąd walidacji telefonu po stronie serwera wygląda jak awaria („Spróbuj ponownie”), bez błędu przy polu; w demo aplikowanie zawsze kończy się tym błędem
Invariant #11 (błędy przy polach), WCAG 3.3.1 / 3.3.3.

**Kroki:** 1280×900, `/pl/oferty-pracy/bricklayer-brussels-1002` → „Aplikuj teraz” → telefon `abc` (albo `1`), zaznaczona zgoda → „Wyślij” (`jd/t9.js`, odpowiedź akcji przechwycona).
- **Obecnie:** klient sprawdza tylko, czy pole nie jest puste. Serwer (`applicationSchema.phone`, regex `^[+]?[0-9\s().-]{6,20}$`) zwraca `{"ok":false,"error":"VALIDATION_FAILED"}`, a UI pokazuje „Nie udało się wysłać aplikacji. Spróbuj ponownie.”, bez `aria-invalid` na telefonie. Użytkownik ponawia bez końca.
- W trybie demo `jobId` to `"1002"` (nie UUID), więc **każda** próba, także z poprawnym numerem `470123456`, kończy się `VALIDATION_FAILED` i tym samym komunikatem. Zapis ma osobny stan „niedostępne” (`saveUnavailable`), aplikowanie takiego stanu nie ma.
- **Oczekiwane:** błędny format telefonu jest wykrywany na kliencie tym samym schematem, z komunikatem przy polu („Podaj poprawny numer…”). `VALIDATION_FAILED` z serwera jest mapowany na pole, a nie na ogólny błąd. W trybie demo formularz od razu informuje, że aplikowanie jest niedostępne, zamiast zachęcać do ponawiania.

**Pliki:** `src/components/public/ApplyModal.tsx` (walidacja telefonu, mapowanie `VALIDATION_FAILED`, stan demo), `src/lib/validation/application.ts` (wydzielenie reguły telefonu do wspólnego użycia na kliencie), ewentualnie `src/lib/actions/applications.ts` (zwrot pola błędu, np. `{ error, field: 'phone' }`).
**Messages:** nowe `apply.phoneInvalid` oraz np. `apply.unavailableDemo` w pl/nl/fr/en (obecnie `apply.*` nie ma klucza dla błędnego formatu).
**Test regresyjny:** unit dla współdzielonej reguły telefonu (np. `abc`, `1`, `+32 470 12 34 56`). E2E: `abc` → `#apply-phone[aria-invalid=true]` + tekst `apply.phoneInvalid` i brak `role=alert` z `errorGeneric`.

## 4. [P1] Anonim wypełnia cały formularz, zanim dowie się o logowaniu; logowanie nie wraca do oferty
Kluczowa ścieżka kandydata.

**Kroki:** anonim, `/pl/oferty-pracy/bricklayer-brussels-1002`.
- **Obecnie:** „Aplikuj teraz” otwiera pełny formularz z informacją „Użyj swojego profilu…”. Link logowania (`apply.loginRequired`) pojawia się dopiero po wysłaniu, w produkcji po `PERMISSION_DENIED`. Wszystkie wejścia do logowania na tej stronie prowadzą do `/logowanie` bez parametru powrotu: `LOGIN_HREF` w ApplyModal, zapis dla anonima (`PublicSavedJobs`), „Wyślij wiadomość” (page.tsx). `signIn` przekierowuje zawsze do panelu (`src/lib/actions/auth.ts`, `redirect({ href: panelPath(role) })`), więc kandydat traci ofertę i wpisane dane.
- **Oczekiwane:** anonim (status `anonymous` jest już znany w `PublicSavedJobsProvider`) widzi w dialogu od razu krótkie „Zaloguj się lub załóż konto, aby aplikować” z przyciskami. Link zawiera bezpieczny `next=/{locale}/oferty-pracy/{slug}` (tylko ścieżka względna, ochrona przed open redirect), a po zalogowaniu kandydat wraca do oferty.

**Pliki:** `src/components/public/ApplyModal.tsx`, `src/components/public/PublicSavedJobs.tsx`, page.tsx (link „Wyślij wiadomość”), `src/app/[locale]/(auth)/logowanie/page.tsx` + `src/lib/actions/auth.ts` (obsługa i walidacja `next`; to może być obszar sesji auth, więc warto uzgodnić).
**Messages:** ewentualnie `apply.loginIntro` (4 języki); można też użyć istniejącego `apply.loginRequired`.
**Test regresyjny:** e2e: anonim → „Aplikuj” → w dialogu widoczny link logowania z `next` wskazującym bieżącą ofertę, bez pól formularza. Unit dla sanitizacji `next` (odrzuca `//evil`, `https://…`).

## 5. [P2] Desktop: nagłówki sekcji (`<summary>`) są w kolejności Tab i Enter chowa treść, której myszą nie da się już rozwinąć
WCAG 2.4.3 / 3.2 (przewidywalność), 2.1.1.

**Kroki:** 1280×900, Tab od początku strony. Po zakładkach fokus trafia na `SUMMARY „O stanowisku”`, Enter → `details.open=false` (`jd/t7.js`, zrzut `jd/desk-collapsed.png`: opis zniknął).
- **Obecnie:** na `lg` `summary` ma `pointer-events-none`, a chevron jest ukryty. Sekcja zwinięta klawiaturą nie ma żadnej wskazówki i nie da się jej rozwinąć kliknięciem. Każda sekcja to też zbędny przystanek Tab bez widocznej funkcji.
- **Oczekiwane:** na desktopie sekcje są zwykłymi `<section>` z `h2` (bez przystanku Tab), a akordeon działa tylko na mobile. Alternatywnie: na desktopie `summary` z `tabIndex=-1` i blokadą przełączania.

**Pliki:** page.tsx (komponent `Section`, ok. l. 248–270).
**Messages:** nie.
**Test regresyjny:** e2e na 1280 px: żaden `summary` nie jest w kolejności Tab, a po naciśnięciu Enter / Space wszystkie sekcje treści pozostają widoczne.

## 6. [P2] Niepoprawna struktura `<dl>` w sekcji „Zakwaterowanie i dojazd”
WCAG 1.3.1, axe `definition-list` + `dlitem` (serious).

**Kroki:** axe (tagi wcag2a/aa/21aa/22aa) na `/{pl,nl,fr,en}/oferty-pracy/bricklayer-brussels-1002`. To jedyne naruszenia na stronie, w każdym języku.
- **Obecnie:** `dl > div(flex z ikoną) > div > dt/dd`. `dt` i `dd` są zagnieżdżone o jeden poziom za głęboko.
- **Oczekiwane:** `dl > div > (dt, dd)`, a ikona wewnątrz `dt` lub z pozycjonowaniem w tym samym `div`.

**Pliki:** page.tsx (ok. l. 457–488).
**Messages:** nie.
**Test regresyjny:** dodać `/pl/oferty-pracy/<slug>` do stron objętych bramką `tests/e2e/a11y.spec.ts`; teraz bramka nie obejmuje szczegółu oferty, dlatego to naruszenie przeszło.

## 7. [P2] Zakładki: martwa kotwica „Podobne oferty”, zła nazwa nawigacji, stałe `aria-current`
WCAG 2.4.4, 4.1.2.

**Kroki:** `/pl/oferty-pracy/office-cleaner-brussels-1004`. W HTML jest `href="#podobne"`, ale element `id="podobne"` nie istnieje, bo sekcja podobnych renderuje się tylko przy `similarJobs.length > 0`.
- Na każdej ofercie `<nav aria-label>` ma wartość `job.tabDescription` („Opis oferty”), czyli taką samą jak pierwsza zakładka. Pierwsza zakładka ma zawsze `aria-current="true"`, także po przejściu do „Informacje o firmie”.
- **Oczekiwane:** zakładka „Podobne” pojawia się tylko, gdy sekcja istnieje. Nawigacja ma osobną nazwę (np. „Sekcje oferty”). `aria-current` jest usunięte albo aktualizowane.

**Pliki:** page.tsx (tablica `tabs` ok. l. 243–247, `<nav>` ok. l. 371–389).
**Messages:** nowy `job.sectionsNav` (4 języki).
**Test regresyjny:** e2e: dla każdej oferty każdy `nav a[href^="#"]` ma istniejący cel `document.getElementById`, co sprawdzić na ofercie bez podobnych.

## 8. [P2] 404 wygasłej lub nieistniejącej oferty to ślepa uliczka: brak nagłówka i stopki, brak linku do ofert
Użyteczność (typowa sytuacja: stary link z Google lub od znajomego).

**Kroki:** 375×740, `/fr/oferty-pracy/nie-istnieje-xyz` (zrzut `jd/404-fr.png`).
- **Obecnie:** strona zawiera tylko „404”, zdanie i przycisk „Retour” prowadzący na stronę główną. Nie ma nagłówka, stopki ani przełącznika języka (komentarz w `not-found.tsx` twierdzi, że „dziedziczy Header/Footer”, ale nagłówek i stopka są w `(public)/layout`). `<title>` to ogólny tytuł strony głównej.
- **Oczekiwane:** komunikat „Ta oferta nie jest już dostępna” z przyciskiem „Zobacz aktualne oferty” (`/oferty-pracy`), w publicznym layoutie. Kod 404 i `noindex` bez zmian.

**Pliki:** nowy `src/app/[locale]/(public)/oferty-pracy/[slug]/not-found.tsx` (renderowany w `(public)/layout`) albo poprawka `src/app/[locale]/not-found.tsx`.
**Messages:** np. `job.notFoundTitle`, `job.notFoundCta` (4 języki); z istniejącego można użyć `jobs.*` dla CTA.
**Test regresyjny:** e2e: `/pl/oferty-pracy/nie-istnieje` → status 404, `noindex`, widoczny `header`, link do `/pl/oferty-pracy`.

## 9. [P2] ApplyModal: dwie kontrolki o nazwie „Telefon”, wymagane pola tylko z gwiazdką, fokus po błędzie serwera wraca na kontener
WCAG 2.4.6 / 4.1.2, 3.3.2, 2.4.3.

**Kroki:** otworzyć dialog i odczytać nazwy dostępne (`jd/t2.js`).
- **Obecnie:** combobox kodu kraju ma `aria-label={t('phone')}`, czyli tak samo jak pole numeru. Pola wymagane oznacza tylko wizualne `*` (czytane jako „gwiazdka”), bez `aria-required`. Po odpowiedzi z błędem (`role=alert`) `activeElement` to `DIV[role=dialog]`, bo przycisk był `disabled` w trakcie wysyłki.
- **Oczekiwane:** kod kraju nazwany np. „Kierunkowy kraju”. Gwiazdka `aria-hidden` i `aria-required="true"` na polu telefonu i zgodzie. Po błędzie serwera fokus przechodzi na komunikat błędu (`tabIndex=-1`) albo z powrotem na przycisk wysyłki.

**Pliki:** `src/components/public/ApplyModal.tsx`.
**Messages:** nowy `apply.dialCode` (4 języki).
**Test regresyjny:** e2e: `getByRole('combobox', { name: apply.dialCode })` i `getByRole('textbox', { name: /apply.phone/ })` są rozróżnialne; `#apply-phone` ma `aria-required`; po błędzie fokus jest na alercie.

## 10. [P2] Tekst 200%: tytuły podobnych ofert i nazwa firmy obcięte wielokropkiem
WCAG 1.4.4 / 1.4.10 (utrata treści).

**Kroki:** 1280×800, `document.documentElement.style.fontSize='200%'`, `/pl/oferty-pracy/bricklayer-brussels-1002`.
- **Obecnie:** `truncate` ucina teksty: „Monter rusztowań – Antwerpia” (scrollWidth 386 / 158), „Cieśla – Liège”, „Malarz – Kortrijk”, nazwa firmy w karcie kontaktu „Brussels Build SA” (248 / 190). W FR przy 640 px + 200% ucina też „Monteur d'échafaudages – Anvers”.
- **Oczekiwane:** zawijanie (`break-words`, `line-clamp-2` z pełną treścią, np. przez naturalne zawijanie przy większym tekście) bez utraty informacji.

**Pliki:** page.tsx (podobne oferty ok. l. 579: `truncate`; kontakt ok. l. 544: `truncate`).
**Messages:** nie.
**Test regresyjny:** e2e przy 640 px + fontSize 200%: w `#podobne` żaden `p` nie ma `scrollWidth > clientWidth`.

---

### Podział plików (dla równoległej pracy)
- page.tsx: #1, #2, #4 (link wiadomości), #5, #6, #7, #10
- `src/components/public/PublicSavedJobs.tsx`: #1, #4
- `src/components/public/ApplyModal.tsx`: #3, #4, #9
- `src/lib/validation/application.ts`, `src/lib/actions/applications.ts`: #3
- `src/app/globals.css`: #2
- `src/app/[locale]/(auth)/logowanie/page.tsx`, `src/lib/actions/auth.ts`: #4 (parametr `next`)
- `src/app/[locale]/not-found.tsx` / nowy `(public)/oferty-pracy/[slug]/not-found.tsx`: #8
- `tests/e2e/a11y.spec.ts`: #6 (rozszerzenie bramki o detal)
- `src/messages/{pl,nl,fr,en}.json`: #3 (`apply.phoneInvalid`, `apply.unavailableDemo`), #4 (opc. `apply.loginIntro`), #7 (`job.sectionsNav`), #8 (`job.notFoundTitle`, `job.notFoundCta`), #9 (`apply.dialCode`)
