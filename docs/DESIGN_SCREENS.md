> HISTORYCZNE MAKIETY: od 2026-09-21 kierunek wizualny zastępuje [Paszport pracy](design/people-passport/README.md). Poniższy opis zachowuje kontekst funkcji; dawna paleta nie jest aktualną decyzją właściciela.

# Pracuj.be — specyfikacja ekranów (źródło prawdy dla UI)

> **To jest wizualny kontrakt UI.** Odwzorowuje 7 zatwierdzonych makiet w `docs/design/screens/`.
> Makiety mają pierwszeństwo przed ogólnymi opisami w specyfikacji tekstowej wszędzie tam, gdzie się różnią
> (dotyczy zwłaszcza palety — patrz niżej). Implementując strony/komponenty, trzymaj się tego dokumentu.

> ⚠️ **Proporcje:** makiety są pionowo **rozciągnięte** (artefakt generatora obrazu). Odwzorowuj
> **układ, kolejność sekcji i komponenty**, ale odstępy/wysokości rób **normalnie** (standardowy rytm
> 4/8px, zwarte sekcje) — NIE kopiuj przesadnych pionowych odstępów z obrazków.

Makiety (desktop + mobile na każdej):
1. `docs/design/screens/01-home.png` — strona główna
2. `docs/design/screens/02-jobs-list.png` — lista ofert (z filtrami)
3. `docs/design/screens/03-job-detail.png` — szczegóły oferty + modal aplikacji
4. `docs/design/screens/04-candidate-dashboard.png` — panel kandydata
5. `docs/design/screens/05-employer-dashboard.png` — panel pracodawcy
6. `docs/design/screens/06-candidate-onboarding.png` — kreator profilu kandydata (6 kroków)
7. `docs/design/screens/07-state-showcase.png` — stany UI (hover, filtry, modal, toast, powiadomienia, cookies)

---

## 0. Paleta — WERSJA Z MAKIETY (obowiązująca)

**Zmiana względem specyfikacji tekstowej:** kolorem MARKI/AKCJI jest **granat**, a jasny niebieski jest **akcentem**.
(W spec. było odwrotnie — makieta wygrywa, potwierdzone przez użytkownika: „zmieniłem barwy, więc tak jak w makiecie".)

| token | hex | użycie |
|---|---|---|
| `--primary` (granat) | `#0F2A47` | przyciski główne, sidebar paneli, stopka, aktywne elementy, nagłówki logo |
| `--primary-dark` | `#0A1F38` | hover przycisków granatowych |
| `--primary-foreground` | `#FFFFFF` | tekst na granacie |
| `--accent` (niebieski) | `#2563EB` | linki, „.be" w logo, aktywny krok kreatora, akcenty, ikony aktywne |
| `--accent-dark` | `#1D4ED8` | hover linków/akcentu |
| `--foreground` (tekst) | `#0F172A` | tekst podstawowy (grafit/granat) |
| `--muted-foreground` | `#64748B` | tekst drugorzędny, etykiety, meta |
| `--background` | `#FFFFFF` | tło |
| `--soft` | `#F8FAFC` | tła sekcji, wierszy tabel, pól chip |
| `--border` | `#E2E8F0` | obramowania, linie |
| `--success` | `#16A34A` | „Zweryfikowany pracodawca", paski dopasowania, status „Rozmowa", potwierdzenia |
| `--warning` | `#D97706` | status „Obejrzana", licznik pilnych, gwiazdka „dopasowani" |
| `--error` | `#DC2626` | błędy walidacji, status „Odrzucona", liczniki nieprzeczytanych |

**Kolory statusów (pigułki / badge):**

| status | tło | tekst |
|---|---|---|
| Wysłana / `submitted` | `#EFF6FF` | `#1D4ED8` |
| Obejrzana / `viewed` | `#FEF3C7` | `#B45309` |
| Rozmowa / `interview` | `#DCFCE7` | `#15803D` |
| Odrzucona / `rejected` | `#FEE2E2` | `#B91C1C` |
| Aktywna (oferta) | kropka `#16A34A` | `#334155` |
| Zweryfikowany | `#ECFDF5` | `#15803D` |
| Dopasowanie % | pasek `#16A34A` na `#E2E8F0` | — |

**Sidebar paneli (kandydat/pracodawca):** tło `--primary` (`#0F2A47`); pozycje `#CBD5E1`; pozycja aktywna: tło jaśniejszy granat/`rgba(255,255,255,.08)` + tekst biały + lewy akcent; badge liczników na pozycjach (np. Wiadomości `2`).

**Reszta systemu bez zmian:** Inter (`next/font`), promień ~10–12px, cienie subtelne, dużo światła, mobile-first. Kontrast WCAG 2.2 AA.

> **TODO implementacyjne:** zaktualizować zmienne w `src/app/globals.css` i mapowania w `tailwind.config.ts`
> do powyższej palety (dodać token `--accent` osobno od `--primary`). Zaktualizować `manifest.ts` `theme_color` na `#0F2A47`.

---

## 1. Strona główna (`/[locale]`) — `01-home.png`

**Górny pasek (biały, sticky):** logo `Pracuj.be` (granat + „.be" niebieski) · nawigacja: Oferty pracy, Jak to działa, Dla pracodawców, Poradniki · po prawej: „Zaloguj się" (ghost) + „Dodaj ofertę" (granatowy). Mobile: hamburger + logo + ikona konta.

**Hero (lekki, NIE pełnoekranowy):**
- Nagłówek „Znajdź pracę w Belgii" (duży, granat), podtytuł „Przeglądaj sprawdzone oferty i aplikuj bez skomplikowanego CV."
- Po prawej lekka **line-art ilustracja** budynków Brukseli (Grand Place) + flaga BE. (Mobile: mniejsza, pod tekstem.)
- **Wyszukiwarka** w białej karcie z cieniem: pole „Stanowisko, słowo kluczowe" (placeholder „np. mechanik, magazynier, opiekunka"), pole „Lokalizacja" (placeholder „np. Antwerpia, Bruksela, Gandawa" + ikona pinu), przycisk „🔍 Szukaj pracy" (granatowy).
- Pod wyszukiwarką dwa linki-akcje z ikonami: „Utwórz profil kandydata / Zapisz oferty i aplikuj szybciej" oraz „Dodaj ofertę pracy / Dotrzyj do tysięcy kandydatów".
- Pasek zaufania (3 pozycje z zielonym ptaszkiem): „Szybka aplikacja bez CV", „Zweryfikowane oferty", „Praca w całej Belgii".

**Sekcje pod hero:**
- **Najnowsze oferty pracy** (nagłówek + link „Zobacz wszystkie oferty →"): lekka **lista-tabela** (nie ciężkie karty): logo firmy · stanowisko + firma · 📍 miasto · typ etatu · „X godz. temu" · ikona zapisu. 4 wiersze.
- **Popularne kategorie** (2 kolumny) — ikona + nazwa + „X ofert": Produkcja, Logistyka i transport, Budownictwo, Opieka i zdrowie, Sprzątanie, Gastronomia… + „Zobacz wszystkie →".
- **Popularne lokalizacje** (2 kolumny) — 📍 miasto + „X ofert": Antwerpia, Bruksela, Gandawa, Liège, Charleroi, Hasselt… + „Zobacz wszystkie →".
- **Jak to działa?** — 4 kroki z ikonami w kółkach i strzałkami między nimi: 1. Znajdź ofertę, 2. Aplikuj szybko, 3. Rozmawiaj, 4. Zacznij pracę. Obok karta „Jesteś pracodawcą?" (soft tło) z przyciskiem „Dodaj ofertę pracy" + mała ilustracja ludzi.
- **Stopka (granatowa):** logo + opis + kolumny (Dla kandydatów / Dla pracodawców / Przydatne informacje / O nas) + selektor języka „🇧🇪 PL ⌄".
- **Baner cookies** (na dole, ciemny): tekst + 3 przyciski „Zaakceptuj wszystkie" / „Odrzuć opcjonalne" / „Dostosuj" (równorzędne).

**Mobile:** akordeony dla „Popularne kategorie", „Popularne lokalizacje", „Jak to działa?"; wyszukiwarka pionowo; cookies jako karta.

---

## 2. Lista ofert (`/[locale]/oferty-pracy`) — `02-jobs-list.png`

**Górny obszar:** breadcrumb „Strona główna / Oferty pracy" · nagłówek „Oferty pracy w Belgii" (+ ilustracja jak w hero, mniejsza) · podtytuł · pasek wyszukiwarki (jak na home).

**Układ 2-kolumnowy (desktop):**
- **Lewy sidebar „Filtry"** (+ „Wyczyść wszystko"):
  - **Kategoria** — checkboxy z licznikami (Produkcja 1 248, Logistyka i transport 982, Budownictwo 764, Opieka i zdrowie 612, Sprzątanie…) + „Pokaż więcej (6) →".
  - **Lokalizacja** — pole „Wybierz lokalizację" + checkboxy z licznikami + „Pokaż więcej →".
  - **Wynagrodzenie (brutto/mies.)** — suwak zakresu (€1 500 – €4 500+).
  - **Rodzaj umowy** — checkboxy z licznikami (Umowa o pracę 3 245, Umowa zlecenie 1 128, Tymczasowa 632, Freelance/B2B 298).
  - **Wymagany język** — select.
  - **Zakwaterowanie** — checkboxy (Zapewnione, Niedostępne, Nie dotyczy) z licznikami.
  - **Transport** — checkboxy (Dostępny, Niedostępny) z licznikami.
  - **Data dodania oferty** — select „Dowolna".
  - Przycisk „Pokaż 3 786 ofert" (granatowy, sticky na dole sidebara).
- **Prawa kolumna (wyniki):**
  - Pasek: „Znaleźliśmy 3 786 ofert pracy" · po prawej „Sortuj: [Najnowsze ⌄]".
  - **Aktywne filtry** jako chipy z „×" (Antwerpia, Bruksela, „Wynagrodzenie: 1 500 – 4 500 €+") + „Wyczyść filtry".
  - **Wiersze ofert:** logo firmy · stanowisko (pogrubione) · firma + „✓ Zweryfikowany pracodawca" (zielony) · 📍 lokalizacje (może 2) · 💶 „€ X – Y / mies. brutto" · pigułki (Umowa o pracę, Pełny etat, Zmiany, Część etatu…) · data („Dzisiaj/Wczoraj/2 dni temu") · ikona zapisu. **Hover:** jasnoniebieskie tło + niebieskie obramowanie (patrz screen 7.1).
  - **Paginacja:** 1 2 3 4 5 … 95 >.
- **Mobile:** wyszukiwarka; pasek „Filtry (2)" (badge z liczbą aktywnych) + „Sortuj: Najnowsze"; chipy aktywnych filtrów; oferty jako karty (stackowane, logo + tytuł + zapis, meta pod spodem, pigułki); **panel filtrów jako bottom-sheet** z „Pokaż 3 786 ofert".

---

## 3. Szczegóły oferty (`/[locale]/oferty-pracy/[slug]`) — `03-job-detail.png`

**Nagłówek:** „‹ Wróć do wyników wyszukiwania" · tytuł „Magazynier" · logo + firma + „✓" + ocena „4,2/5 (123 opinie)" · meta w rzędzie z ikonami: 📍 Antwerpia, Belgia · 💶 2 250–2 550 € brutto/mies. · 📄 „Umowa o pracę tymczasową z możliwością stałej" · 🗂 Pełny etat · 🕐 Praca zmianowa · „Opublikowana: 2 dni temu" · „✓ Zweryfikowany pracodawca". Po prawej: „Udostępnij" + „Zapisz ofertę" (outline).

**Zakładki:** Opis oferty | Informacje o firmie | Podobne oferty.

**Treść (lewa/środek):** Opis stanowiska (akapit) · **Obowiązki** (checklista ✓) · **Wymagania** (checklista ✓) · **Oferujemy** (siatka 2-kol. z ikonami) · **Zakwaterowanie i dojazd** (ikony + tekst) · **Informacje o firmie** (karta: logo, nazwa+✓, branża, liczba pracowników, opis, „Dowiedz się więcej o firmie →").

**Prawy panel (sticky):**
- Duży przycisk „⚡ Aplikuj teraz — Zajmie to tylko 2 minuty" (granatowy) + „♡ Zapisz ofertę" (outline).
- Karta „Kontakt do pracodawcy": avatar, imię, rola, „Języki: PL, EN, NL", 📞 telefon, ✉ e-mail, „Wyślij wiadomość".
- Karta „Podobne oferty" (mini-lista) + „Zobacz więcej ofert".

**Modal „Aplikuj teraz" (szybka aplikacja):** nagłówek + „Użyj swojego profilu, aby szybko aplikować." · zielony baner „Twoje dane z profilu zostaną dołączone do aplikacji." · Telefon (kod kraju + numer) · Dostępność (select „Od zaraz") · „Dodaj wiadomość (opcjonalnie)" (textarea, licznik 0/500) · checkbox zgody (Polityka prywatności) · „🔒 Wyślij aplikację" (granatowy) · „Twoja aplikacja zostanie wysłana do AGO Jobs & HR". (Wariant lekki modala w screen 7.3.)

**Mobile:** meta jako lista; treść w **akordeonach** (Opis stanowiska, Obowiązki, Wymagania, Oferujemy, Zakwaterowanie i dojazd, Informacje o firmie); **sticky dolny pasek**: „✓ Zapisano w ulubionych" + „⚡ Aplikuj teraz".

---

## 4. Panel kandydata (`/[locale]/candidate`) — `04-candidate-dashboard.png` · `noindex`

**Sidebar (granatowy):** logo · Podsumowanie (aktywne), Polecane oferty, Zapisane oferty, Moje aplikacje, Wiadomości `2`, Profil, Ustawienia · dół: Pomoc, Wyloguj się, selektor „PL ⌄".

**Topbar:** „Witaj, Adam 👋" · dzwonek `2` · avatar + „Adam Kowalski / Zobacz profil".

**Baner:** „Nowa propozycja pracy dopasowana do Twojego profilu. Zobacz ofertę →" (zielony ✓, zamykalny).

**4 karty statystyk:** Nowe oferty **24** (Dopasowane do Ciebie), Aktywne aplikacje **5** (W trakcie rekrutacji), Wiadomości **2** (Nieprzeczytane, czerwony), Kompletność profilu **78%** (pasek postępu) — każda z linkiem („Zobacz oferty →" itd.).

**Polecane oferty pracy** (tabela): Oferta (logo+tytuł+firma) · Lokalizacja · Dopasowanie (% + zielony pasek) · zapis. „Zobacz wszystkie →".

**Moje ostatnie aplikacje** (tabela): Oferta · Firma · Data aplikacji · **Status** (pigułki: Wysłana niebieska, Obejrzana amber, Rozmowa zielona, Odrzucona czerwona) · „…".

**Prawa kolumna:** karta „Kompletność profilu" (kołowy 78% „Dobry poziom" + checklista sekcji z ✓ lub „+ Dodaj" + „Uzupełnij profil" granatowy) · „Najnowsze wiadomości" (lista z kropkami nieprzeczytania) + „Zobacz wszystkie wiadomości".

**Mobile:** statystyki 2×2; polecane oferty i aplikacje jako karty ze statusami; **dolny tab bar**: Podsumowanie, Oferty, Aplikacje, Wiadomości, Profil.

---

## 5. Panel pracodawcy (`/[locale]/employer`) — `05-employer-dashboard.png` · `noindex`

**Sidebar (granatowy):** przełącznik firmy „AGO Jobs & HR / Pracodawca ⌄" · Podsumowanie (aktywne), Oferty, Kandydaci, Aplikacje `12`, Wiadomości `5`, Firma, Płatności, Ustawienia · dół: Pomoc, Kontakt, Wyloguj się.

**Topbar:** dzwonek `5` · „Jan Kowalski / AGO Jobs & HR ⌄".

**Nagłówek:** „Podsumowanie" · „Witaj Janie! Sprawdź, co dzieje się w Twojej rekrutacji." · „+ Dodaj ofertę pracy" (granatowy).

**4 karty statystyk** (ikona w kolorowym soft-kwadracie + delta): Aktywne oferty **8** (+2), Nowe aplikacje **42** (+18, zielona), Dopasowani kandydaci **26** (+7, amber gwiazdka), Wiadomości wymagające odpowiedzi **5** (2 pilne, czerwona).

**Twoje aktywne oferty** (tabela z checkboxami): Oferta (+ID) · Lokalizacja · Nowe aplikacje · Dopasowani · Status („● Aktywna" zielony) · menu „…" (Zobacz ofertę, Edytuj ofertę, Podgląd ofert, Zatrzymaj ofertę, **Usuń ofertę** czerwony). Pasek „Zaznaczone: 1 · [Działania zbiorcze ⌄]".

**Lejek rekrutacyjny (ostatnie 30 dni):** 4 etapy (Wyświetlenia ofert 4 126 → Aplikacje 287 → Rozmowy 38 → Zatrudnieni 6) z % konwersji między nimi. (Prosty lejek, bez ciężkich wykresów.)

**Prawa kolumna:** „Top dopasowani kandydaci" (avatar, imię, rola/miasto, % dopasowania, zapis) + „Przejdź do kandydatów" · karta „Twój pakiet" (Standard, „Aktywny do 24.06.2025", lista ✓: 8/10 ofert aktywnych, Widoczność standardowa, Dostęp do bazy CV, „Zmień pakiet" granatowy).

**Mobile:** statystyki 2×2; aktywne oferty jako karty (tytuł, lokalizacja, „X aplikacji · Y dopas.", status, „…"); „+ Dodaj ofertę pracy"; top kandydaci; **dolny tab bar**: Podsumowanie, Oferty, Kandydaci, Wiadomości `5`, Więcej.

---

## 6. Kreator profilu kandydata (`/[locale]/candidate/onboarding`) — `06-candidate-onboarding.png`

**Nagłówek:** „Twój profil kandydata" · „Utwórz swój profil, a my dopasujemy do Ciebie najlepsze oferty pracy w Belgii." · wskaźnik „✓ Zapisano ×".

**Stepper (6 kroków, poziomy — desktop / kropki 1–6 — mobile):**
1. Dane podstawowe (Informacje o Tobie) — aktywny
2. Preferencje pracy (Czego szukasz?)
3. Doświadczenie (Twoja historia zawodowa)
4. Umiejętności i języki (Co potrafisz?)
5. Dostępność (Kiedy możesz pracować?)
6. Podsumowanie (Sprawdź i opublikuj)

**Lewy sidebar:** „Kompletność profilu" (kołowy 45%) + checklista kroków ze stanem („Brak" dla niewypełnionych, ✓ dla gotowych) · karta „Potrzebujesz pomocy? Zobacz poradnik".

**Formularz kroku 1 „Dane podstawowe":** Imię, Nazwisko, Miasto zamieszkania (+pin), Numer telefonu (+podpowiedź), Adres e-mail, Data urodzenia (date picker), Obywatelstwo (select), Pozwolenie na pracę w Belgii (select). **Informacje dodatkowe:** Prawo jazdy (pigułki-toggle: Nie posiada / Kategoria B [zazn.] / Kategoria C / Kategorie C+E), Własny samochód (Nie/Tak toggle), Gotowość do relokacji (select), **Oczekiwane wynagrodzenie** (kwota + EUR) — pokazany **stan błędu**: czerwone obramowanie + „Wprowadź kwotę oczekiwanego wynagrodzenia."

**Stopka formularza:** „Zmiany są zapisywane automatycznie" (✓) · przyciski „Anuluj", „Zapisz i wyjdź", „Dalej: Preferencje pracy →" (granatowy).

**Mobile:** kropki kroków; pola pionowo; sekcja „Informacje dodatkowe" jako akordeon; toast „✓ Zapisano — Twoje zmiany zostały zapisane"; sticky „Dalej: Preferencje pracy".

**Wymóg:** autozapis po każdym kroku (zgodny z INVARIANT #11 i spec. sekcja 13).

---

## 7. Stany UI — `07-state-showcase.png`

Legenda: biały = stan domyślny · granat = stan aktywny/otwarty · zielony ✓ = informacja zwrotna.

1. **Hover na ofercie** — wiersz: jasnoniebieskie tło + niebieskie obramowanie, kursor pointer.
2. **Otwarty panel filtrów** — desktop: panel wysuwany z prawej; mobile: bottom-sheet. Pola: Lokalizacja (select), Promień (suwak, „25 km"), Kategoria (select), Typ umowy (checkboxy: Pełny etat ✓, Część etatu, Tymczasowa), Doświadczenie (select). Przycisk „Zastosuj filtry (124)" (granat) — licznik pasujących ofert.
3. **Modal aplikacji (lekki)** — „Aplikuj szybko" · firma · „Twoje dane kontaktowe" (Imię, Nazwisko, E-mail, Telefon) · „Dołącz CV z mojego profilu" (checkbox zazn.) · „Anuluj" (outline) / „Wyślij aplikację" (granat).
4. **Toast zapisania** — „✓ Oferta została zapisana. Znajdziesz ją w zakładce »Zapisane»." (zielony ✓, zamykany, prawy dół).
5. **Dropdown powiadomień** — „Powiadomienia / Oznacz wszystkie jako przeczytane" · pozycje z kropką nieprzeczytania (Nowa oferta dopasowana, Twoja aplikacja została wyświetlona, Wiadomość od pracodawcy) + czas · „Zobacz wszystkie powiadomienia".
6. **Centrum ustawień cookies (rozszerzone)** — „Ustawienia plików cookie" + opis · kategorie z przełącznikami: Niezbędne („Zawsze aktywne", zablokowany), Analityczne (on), Marketingowe (off), Personalizacja (on) · „Więcej informacji o plikach cookie" · przyciski „Odrzuć opcjonalne" / „Zapisz ustawienia" / „Zgadzam się na wszystkie" (granat). Mobile: to samo w węższym układzie.

---

## Wnioski implementacyjne (dla redesignu po zakończeniu workflow)

1. **Paleta:** zaktualizować `globals.css` + `tailwind.config.ts` do sekcji 0 (rozdzielić `--primary` granat i `--accent` niebieski). `manifest.ts` `theme_color = #0F2A47`.
2. **Komponenty do zbudowania/dostrojenia:** `JobRow` (wiersz listy, wariant hover), `FilterSidebar` + `FilterSheet` (mobile), `SalaryRange` (suwak), `StatusPill` (mapa kolorów statusów), `StatCard`, `MatchBar`, `Stepper`, `DashboardSidebar` (granatowy) + `BottomTabBar` (mobile), `ApplyModal` (pełny i lekki), `NotificationsDropdown`, `Toast`, `CookieSettingsDialog` (przełączniki), `PricingPackageCard`, `RecruitmentFunnel`.
3. **Ilustracja hero:** lekka line-art panoramy Brukseli (SVG, inline, jednokolorowa) + flaga BE — bez ciężkich zdjęć.
4. **Layouty paneli:** osobny `(dashboard)` layout z granatowym sidebarem (desktop) i dolnym tab barem (mobile); `noindex`.
5. Wszystkie teksty przez i18n (namespace'y wg `CLAUDE.md`); rozbudować klucze o statusy, filtry, panele.
