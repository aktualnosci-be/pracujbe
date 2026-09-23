# Audyt: wspólna powłoka (nawigacja, stopka, offline, błędy, cookies)

Serwer: http://localhost:3100 (tryb demo, `main` @ f11170e). Chromium z `/opt/pw-browsers/chromium`.
Skrypty i zrzuty: `audit/shell/p1.js` … `p11.js`, `*.png`. Wszystkie ustalenia niżej odtworzyłem w przeglądarce, chyba że opis mówi inaczej.

Co działa poprawnie (bez uwag): skip link (pierwszy w kolejności Tab, widoczny po fokusie); hamburger 44×44 z `aria-haspopup=dialog`/`aria-expanded`; panel mobilny ma pułapkę fokusu, Escape zamyka i fokus wraca na hamburger, reszta strony jest `aria-hidden`; przełącznik języka zachowuje ścieżkę, query i hash (`/pl/oferty-pracy?q=kierowca&sort=newest#x` → `/en/...` z tym samym query), `lang` się zmienia; dialog ustawień cookies ma nazwę i opis, pułapkę fokusu, Escape, switche obsługiwane spacją, przy 320 px i 640×400 lista kategorii przewija się wewnątrz; axe (A/AA + best-practice) na `/pl` 320, `/en/offline`, zlokalizowanym 404 i otwartym dialogu cookies (`/fr`) nie zgłasza naruszeń; stopka: kontrast muted na `bg-soft` ok. Linki stopki mają 17 px wysokości, ale odstęp środków wynosi 25 px, więc spełniają wyjątek odstępu z 2.5.8.

---

## 1. [P1] Nieznana ścieżka pod `/{locale}/…` pokazuje domyślną, angielską stronę 404 Next bez `lang`, nawigacji i linku powrotu
- WCAG: 3.1.1 (Language of Page), 2.4.5, a do tego bariera użyteczności (ślepy zaułek).
- Kroki: dowolny viewport, `GET /pl/nie-istnieje` (tak samo `/nl/…`, `/fr/…`, `/en/…`, `/xx/abc`).
- Obecnie: HTTP 404, `<title>404: This page could not be found.</title>`, `<html>` bez `lang`, zero `main`, zero linków, tekst po angielsku niezależnie od języka. axe: `html-has-lang` (serious), `landmark-one-main`, `region`. Zlokalizowany `src/app/[locale]/not-found.tsx` renderuje się tylko przy jawnym `notFound()`, np. `/pl/praca/miasto/zzz` albo `/en/oferty-pracy/xyz`.
- Oczekiwane: dla każdego nieznanego adresu z prefiksem języka zlokalizowany 404 (`lang`, H1 z `errors.notFound`, link do strony głównej).
- Przyczyna: brak trasy catch-all w `[locale]`. Next-intl wymaga `[locale]/[...rest]/page.tsx` wywołującego `notFound()`. Nie ma też `src/app/not-found.tsx` dla adresów bez poprawnego locale.
- Pliki:
  - NOWY `src/app/[locale]/[...rest]/page.tsx` (`notFound()`, setRequestLocale);
  - NOWY `src/app/not-found.tsx` (neutralny, wielojęzyczny jak `global-error.tsx`, z linkami `/pl /nl /fr /en`).
- Klucze messages: nie trzeba (używa `errors.notFound`, `common.home`).
- Poboczne: niepoprawnie zakodowany URL (`/pl/oferty-pracy/%E0%A4%A`) daje domyślną angielską stronę Next „400: Bad Request”. To przypadek brzegowy, można zostawić.
- Test regresyjny (e2e): dla każdego z 4 języków `goto('/{l}/to-nie-istnieje-123')` → status 404, `html[lang={l}]`, H1 równy `errors.notFound` z pliku messages, link do `/{l}` obecny. Plus `/xx/abc` → status 404, jest `lang`, są linki do 4 języków.

## 2. [P1] Menu mobilne: listy języków nie da się wybrać dotykiem, bo opcje wychodzą poza ekran
- WCAG: 2.1.1 (dla wskaźnika/dotyku bariera funkcjonalna), 1.4.10.
- Kroki: `/pl/oferty-pracy`, viewport 320×640 oraz 390×844 (isMobile, hasTouch) → tap „Menu” → tap „Język”.
- Obecnie: listbox otwiera się zawsze w dół (`top-[calc(100%+0.25rem)]` w `select.tsx`). Przełącznik stoi na dole panelu (`mt-auto`), a panel (`fixed inset-y-0`) nie ma `overflow-y-auto`. Przy 320×640 opcje mają `top` 625/661/697/733 px (viewport 640), przy 390×844 829–973 px. `scrollHeight` 774 > `clientHeight` 640, a `scrollTop` zostaje 0 (nie da się przewinąć). Playwright: „element is outside of the viewport”. Zrzut: `shell/mnav-select-390.png`. Z klawiatury (strzałki + Enter) zmiana działa.
- Oczekiwane: wszystkie 4 języki osiągalne dotykiem przy 320 px i przy typowym telefonie.
- Pliki:
  - `src/components/ui/select.tsx` (prop `side="top"` albo automatyczne odwrócenie, gdy brak miejsca pod triggerem);
  - `src/components/layout/LocaleSwitcher.tsx` (przekazanie strony otwarcia);
  - `src/components/layout/MobileNav.tsx` (`overflow-y-auto` na `Dialog.Content`, ewentualnie przełącznik wyżej).
- Klucze messages: nie trzeba.
- Test regresyjny: przy 320×640 i 390×844 z `hasTouch` otwórz menu, otwórz przełącznik i dla każdej opcji sprawdź, że `boundingBox` mieści się w viewport. Potem tap „English” → URL `/en/oferty-pracy?q=…`.

## 3. [P1] Baner cookies zasłania fokus i treść (320 px, powiększony tekst)
- WCAG: 2.4.11 (Focus Not Obscured, AA), 1.4.10/1.4.4.
- Kroki: czysty kontekst (bez zgody), `/pl/oferty-pracy` i `/fr/oferty-pracy`, Tab od początku strony aż fokus trafi do banera.
- Obecnie:
  - Baner (`fixed bottom-0`, w DOM za treścią, więc w kolejności Tab jest na końcu) przy 320×640 ma 337 px (53% ekranu). Z 33 przystanków fokusu przed banerem 18 (PL) / 22 (FR) jest **całkowicie** pod banerem, a 15 / 11 częściowo.
  - Przy 1280×800 baner ma 117–137 px i nadal 22 z 60 przystanków jest całkowicie zasłoniętych („Pokaż więcej (5)” w filtrach itd.).
  - Przy 640×400 (odpowiednik zoomu 200% dla 1280×800) baner zajmuje 181 px (45%). Z tekstem 200% (`html{font-size:200%}`) rośnie do 481 px, czyli więcej niż cały viewport. Tytuł banera jest obcięty nad krawędzią (top −32) i nie da się go przewinąć (`overflow: visible`).
  - Zrzuty: `shell/banner-320.png`, `banner-640x400*.png`.
- Oczekiwane: sfokusowany element nie jest całkowicie zasłonięty przez baner, a treść banera da się przeczytać przy powiększeniu.
- Pliki:
  - `src/components/cookies/CookieConsent.tsx`: ResizeObserver na banerze ustawia `document.documentElement.style.scrollPaddingBottom = <wysokość>` (przeglądarka przewija fokus nad baner) i czyści to po zamknięciu; `max-h-[50vh] overflow-y-auto`; kompaktowy układ mobilny, np. przyciski w siatce 1/3 zamiast 3×48 px w kolumnie.
  - Ewentualnie `src/app/[locale]/layout.tsx`, jeśli baner ma trafić wcześniej w kolejności DOM/fokusu.
- Klucze messages: nie trzeba.
- Test regresyjny: przy 320×640 i 1280×800 bez zgody przejdź Tabem przez `/pl/oferty-pracy`. Dla każdego fokusu spoza banera sprawdź `rect.top < banner.top` (element nie w pełni pod banerem). Przy 640×400 z tekstem 200% sprawdź, że tytuł i 3 przyciski banera są osiągalne (w viewport albo po przewinięciu kontenera).

## 4. [P2] Zamknięcie banera lub centrum zgód gubi fokus (trafia na `<body>`)
- WCAG: 2.4.3 (Focus Order).
- Kroki: 1280×800, `/pl`.
  - (a) Fokus na „Dostosuj” w banerze → Enter → Escape: fokus na BODY.
  - (b) „Tylko niezbędne” w banerze (Enter): baner znika, fokus na BODY.
  - (c) Stopka „Ustawienia cookies” → Enter → Escape albo „Zapisz ustawienia”: fokus na BODY zamiast z powrotem na przycisku w stopce.
- Przyczyna: `Dialog.Root` bez `Dialog.Trigger`, otwierany zdarzeniem DOM, więc Radix nie ma elementu, do którego mógłby wrócić.
- Pliki:
  - `src/components/cookies/CookieConsent.tsx` (zapamiętać `document.activeElement` przy otwarciu i oddać mu fokus w `onCloseAutoFocus`; po wyborze w banerze przenieść fokus na `#main-content` albo na poprzedni element);
  - ewentualnie `src/lib/consent-store.ts`.
  - Przy okazji: istnieją dwa `CookieSettingsButton` (`src/components/layout/CookieSettingsButton.tsx`, którego używa stopka, i `src/components/cookies/CookieSettingsButton.tsx`, nieużywany) do scalenia.
- Klucze messages: nie trzeba.
- Test: każda ze ścieżek (a–c) kończy się fokusem na elemencie otwierającym (c, a) albo na `#main-content` (b), nigdy na `body`.

## 5. [P2] Przełącznik kategorii cookies w stanie „wył.” ma kontrast 1,5:1
- WCAG: 1.4.11 (Non-text Contrast).
- Kroki: otwórz centrum zgód (dowolny język, dowolny viewport).
- Obecnie: tor switcha `bg-muted-foreground/30` daje rgba(97,97,97,.3) na białym, efektywnie #D0D0D0 ≈ **1,54:1** z tłem dialogu. Gałka jest biała (`bg-background`), więc wyłączony przełącznik praktycznie znika na białym tle.
- Oczekiwane: granica/tor co najmniej 3:1 z tłem, np. tor `bg-muted-foreground` albo obramowanie `border-muted-foreground` w stanie off.
- Pliki: `src/components/cookies/CookieConsent.tsx` (`ConsentSwitch`).
- Klucze messages: nie trzeba.
- Test: e2e z otwartym dialogiem liczy kontrast `getComputedStyle(switch).backgroundColor` (po złożeniu alfa) względem tła dialogu i sprawdza ≥ 3.

## 6. [P2] Offline: #76 potwierdzam. Service worker w ogóle nie używa `/{locale}/offline`, tylko przestarzałego `public/offline.html`
- #76 potwierdzone: `/{pl,nl,fr,en}/offline` przy 320 px ma CTA **44 px** wysokości we wszystkich 4 językach (szerokość 169/172/118/110 px). Brak poziomego scrolla.
- Dodatkowo odtworzone:
  - `public/sw.js` przy braku sieci serwuje `/offline.html` (precache), a nie trasę React. Ten plik to stara identyfikacja: granat `#0F2A47`, logo „P”, `lang="pl"` z nieoznaczonymi zdaniami NL/FR/EN (3.1.2), przycisk **37 px**. Zrzut: `shell/offline-static.png`. Użytkownik offline nigdy nie widzi nowej strony.
  - Strona `/{locale}/offline` ma `<title>` strony głównej („Pracuj.be — Praca w Belgii bez CV”, 2.4.2). H1 to ogólne `common.error` („Coś poszło nie tak”) bez informacji o braku połączenia. Link „Spróbuj ponownie” prowadzi na `/` zamiast ponowić bieżący adres (2.4.4: nazwa nie odpowiada działaniu).
- Pliki:
  - `src/app/[locale]/offline/page.tsx` (h-12, `generateMetadata` z tytułem, dedykowany komunikat, przycisk reload jako mała wyspa kliencka albo link z właściwą nazwą);
  - `public/offline.html` (nowa identyfikacja i `lang` na fragmentach) albo `public/sw.js` (precache i fallback do lokalizowanego widoku, z podbiciem `VERSION`);
  - `tests/e2e/offline-brand.spec.ts` (asercja wysokości ≥ 48).
- Klucze messages: potrzebne nowe (np. `offline.title`, `offline.description`) we wszystkich 4 plikach `src/messages/{pl,nl,fr,en}.json`, jeśli komunikat ma mówić o braku sieci.
- Test regresyjny: e2e z `context.setOffline(true)` po rejestracji SW. Nawigacja pokazuje stronę offline w nowej identyfikacji z przyciskiem ≥ 48 px, a kliknięcie po `setOffline(false)` ładuje pierwotny adres.

## 7. [P2] Zlokalizowane 404 i strona błędu nie mają nagłówka ani stopki, tytuł dokumentu jest mylący, a „Wstecz” prowadzi na stronę główną
- WCAG: 2.4.2 (Page Titled), 2.4.4 / 2.5.3 (nazwa vs działanie).
- Kroki: `/pl/praca/miasto/zzz` (404 z `notFound()`), dowolny język.
- Obecnie: brak `header`/`footer`/skip linku (komentarz w `not-found.tsx` twierdzi, że je dziedziczy, ale chrome jest w `(public)/layout.tsx`, a `not-found` i `error` leżą poziom wyżej). `<title>` to tytuł strony głównej. Jedyny przycisk ma etykietę `common.back` („Wstecz”/„Back”), a prowadzi do `/`. To samo w `error.tsx` (drugi przycisk).
- Oczekiwane: tytuł z informacją o 404/błędzie, etykieta `common.home` dla linku do `/` i najlepiej pełna nawigacja (Header/Footer), żeby użytkownik mógł iść dalej.
- Pliki:
  - `src/app/[locale]/not-found.tsx` (Header/SkipLink/Footer albo przeniesienie, `generateMetadata` z tytułem, etykieta `common.home`);
  - `src/app/[locale]/error.tsx` (etykieta `common.home`);
  - ewentualnie `src/app/[locale]/(public)/not-found.tsx`.
- Klucze messages: istniejący `common.home` wystarczy. Tytuł strony 404 może użyć `errors.notFound`.
- Uwaga do kodu (nie odtworzone w przeglądarce, bo w demo nie da się wymusić wyjątku RSC): `error.tsx` na „Spróbuj ponownie” woła samo `reset()`. Dla błędów komponentów serwerowych w Next 15 nie pobiera to ponownie danych, więc ponowienie może niczego nie zmienić. Zalecany wzorzec to `startTransition(() => { router.refresh(); reset(); })`. Komunikaty są z i18n, bez technikaliów, a przycisk ma nazwę (Inv. #8 spełniony). `global-error.tsx` jest poprawny: wielojęzyczny, `lang` na fragmentach, przycisk 48 px.
- Test: e2e `/{l}/praca/miasto/zzz` → jest `banner` i `contentinfo`, `document.title` ≠ tytuł strony głównej, link o nazwie `common.home` ma `href=/{l}`.

## 8. [P2] Menu mobilne: link do strony głównej ogłaszany jako „Pracuj.be Menu”, brak `aria-current` w nawigacji
- WCAG: 2.4.4 (Link Purpose), 4.1.2 (drobne).
- Kroki: 320×640, `/fr/oferty-pracy` → „Menu”. `ariaSnapshot`: `dialog "Pracuj.be Menu"` → `link "Pracuj.be Menu" /url: /fr`. `Dialog.Title asChild` owija link, więc link do strony głównej ma nazwę „… Menu”. Ani w headerze desktop, ani w panelu mobilnym link „Oferty pracy” na `/oferty-pracy` nie ma `aria-current="page"`, a `<nav>` w headerze i w panelu nie mają `aria-label`.
- Pliki: `src/components/layout/MobileNav.tsx` (osobny `Dialog.Title` sr-only z `nav.menu`, link logo z `aria-label={common.home}` albo `appName`), `src/components/layout/Header.tsx` (`aria-current` przez `usePathname` w małej wyspie albo przekazanie ścieżki; `aria-label` dla nav).
- Klucze messages: nie trzeba (`nav.menu`, `common.home` istnieją).
- Test: ariaSnapshot panelu zawiera `dialog "Menu"` i `link` do `/{l}` bez słowa „Menu”; na `/pl/oferty-pracy` link „Oferty pracy” ma `aria-current=page`.

## 9. [P2] Przełącznik języka: nazwy języków bez `lang`, a po zmianie fokus ląduje na `<body>`
- WCAG: 3.1.2 (Language of Parts), 2.4.3.
- Kroki: `/pl/…`, otwórz przełącznik (stopka albo panel mobilny). Opcje „Nederlands”, „Français”, „English” są w dokumencie `lang=pl` bez atrybutu `lang`, więc czytnik czyta je polską fonetyką. Po wyborze (klawiatura, desktop i mobile) `document.activeElement` = BODY, a panel mobilny się zamyka.
- Pliki: `src/components/layout/LocaleSwitcher.tsx` (`<span lang={loc}>` w `SelectItem` i w wartości; po `router.replace` fokus na `#main-content` albo z powrotem na trigger przełącznika).
- Klucze messages: nie trzeba.
- Test: każda `[role=option]` ma potomka z `lang` równym swojej wartości. Po zmianie języka klawiaturą `activeElement` nie jest `body`.

---

### Poza zakresem / bez uwag
- Znane issues: #76 potwierdzam (pkt 6). Pozostałe z listy nie dotyczą tego obszaru.
- `global-error.tsx`: nie da się go wymusić w demo; z przeglądu kodu jest bez zastrzeżeń.
