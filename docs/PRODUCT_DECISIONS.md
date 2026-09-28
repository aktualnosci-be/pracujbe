# Decyzje produktowe

## 2026-09-22: bezpłatny etap rozwoju

Pracuj.be rozwijamy obecnie bez monetyzacji. Portal nie sprzedaje pakietów, subskrypcji ani
pojedynczych publikacji ofert. Interfejs nie pokazuje cennika ani zachęt do zakupu, a serwer
odrzuca próby rozpoczęcia checkoutu i zdarzenia sprzedażowego webhooka nawet wtedy, gdy w
środowisku pozostały sekrety Stripe.

Technicznie stan wyłączony wyznacza jedna jawna flaga `BILLING_ENABLED` (domyślnie wyłączona,
`src/lib/billing/flag.ts`). Bez niej klient Stripe jest nieosiągalny, a webhook odpowiada 404.
Samo jej ustawienie nie przywraca sprzedaży — ta wersja nie zawiera przepływu checkoutu.

Tabele finansowe pozostają w bazie, aby wycofanie sprzedaży nie wymagało destrukcyjnej migracji.
Ich obecność nie oznacza, że funkcja jest aktywna. Powrót do monetyzacji wymaga nowej, jawnej
decyzji właściciela oraz osobnego wdrożenia i testów.

Docelowym środowiskiem uruchomieniowym aplikacji i PostgreSQL jest Railway. Migracja techniczna
jest prowadzona osobno; ten wpis opisuje kierunek produktu, a nie potwierdza zakończenia migracji.

## 2026-09-26: weryfikacja VAT w VIES przy zakładaniu firmy

Po założeniu firmy serwer automatycznie sprawdza jej belgijski numer VAT (albo KBO) w VIES.
Robi to po wysłaniu odpowiedzi, więc zakładanie firmy nie czeka na VIES. Zapisywany jest tylko
wynik rozstrzygający („ważny” / „nieważny”). Awaria lub limit VIES niczego nie blokują, nie są
zapisywane i nie zmieniają statusu firmy. Status weryfikacji zmienia wyłącznie administrator,
który widzi wynik w szczególe firmy w panelu admina. Wynik automatyczny nie nadpisuje
wcześniejszego sprawdzenia administratora.

**Odznaki „zweryfikowano w VIES” nie pokazujemy kandydatom** — wynik VIES jest informacją
wyłącznie dla administratora. Kandydaci widzą, jak dotąd, tylko oznaczenie firmy zweryfikowanej
przez administratora.

## 2026-09-26: pytanie screeningowe odrzucone po publikacji oferty (#497)

Gdy zespół portalu odrzuci pytanie screeningowe oferty, która jest już opublikowana, pytanie
jest ukrywane od razu, a oferta pozostaje aktywna. Kandydaci nie widzą go w formularzu
aplikowania (także bez konta), odpowiedź na nie nie jest przyjmowana i nie powoduje błędu,
a firma nie widzi odpowiedzi udzielonych na to pytanie wcześniej. Te odpowiedzi zostają
w bazie do decyzji o retencji (#486). Aktywni rekruterzy firmy dostają w panelu powiadomienie
z prośbą o poprawkę. Wstrzymanie i wznowienie oferty z ukrytym pytaniem działa; pytanie
w szkicu nadal blokuje publikację do poprawki. Egzekwowanie w bazie: migracja „pytanie
odrzucone po publikacji” (0154).

## 2026-09-26: porządkowanie bucketu plików w trybie obserwacji

Dzienny przebieg wykrywania osieroconych obiektów w prywatnym buckecie (`STORAGE_GC_MODE`)
zostaje w trybie `dry-run`: liczy sieroty i braki, niczego nie kasuje. Włączenie kasowania
(`delete`) wymaga nowej decyzji po obserwacji liczników w odpowiedzi `/api/maintenance`.

## 2026-09-26: propozycja pracy a dane z konta (#494)

Zachowanie bez zmian: propozycja pracy tworzy relację firma–kandydat
(`company_can_view_candidate` po `offers`), więc aktywni rekruterzy firmy, która wysłała
propozycję, widzą imię i dane kontaktowe kandydata z konta — także gdy kandydat nie włączył
widoczności profilu dla firm. Firma, którą kandydat zablokował (#97), tego dostępu nie ma.
Po stronie kandydata propozycja pokazuje firmę; imienia rekrutera w rozmowach nadal nie
ujawniamy (0023). Decyzja zamyka punkt otwarty w sekcji widoczności profilu (#494).

## 2026-09-28: portal ogłoszeniowy (#1128)

**Decyzja produktowa: portal ogłoszeniowy (#1128).** Pracuj.be działa jako portal ogłoszeń
o pracę. Pracodawca publikuje ofertę i podaje w niej własny kanał aplikowania — adres strony
(https), adres e-mail albo telefon, co najmniej jeden (#1129). Kandydat przegląda oferty,
filtruje je, zapisuje oferty i wyszukiwania (także z powiadomieniami e-mail o nowych ofertach
według własnych filtrów, #1148) i kontaktuje się **bezpośrednio z ogłoszeniodawcą**, poza
portalem.

Portal:

- nie przyjmuje aplikacji na oferty (także bez konta), nie prowadzi statusów zgłoszeń;
- nie udostępnia firmom profili kandydatów ani plików CV i nie prowadzi wyszukiwarki kandydatów;
- nie liczy dopasowania kandydat–oferta, nie tworzy list najlepiej dopasowanych ani
  rekomendacji z profilu;
- nie wysyła propozycji pracy i nie prowadzi rozmów między kandydatem a pracodawcą;
- nie zbiera odpowiedzi na pytania screeningowe i nie importuje CV;
- nie prowadzi profilu zawodowego kandydata ani onboardingu (profil służył wyłącznie dopasowaniom
  i przeglądaniu przez firmy): kandydat po rejestracji trafia na pulpit, a ustawienia konta zostają.

Stare pytania screeningowe i ich przeglądy (sprzed tego trybu) są ukryte wszędzie w aplikacji
— u firmy, kandydata i administratora (decyzja właściciela 28.09.2026); dane zostają w bazie.

Funkcje niezgodne z tym modelem są wyłączone produkcyjnie w trybie fail-closed: jedno źródło
trybu w `src/lib/portal-mode.ts` (#1136), blokady w bazie (#1140) i strażnik CI (#1146). Kod
i tabele zostają w repozytorium (wyłączone), nie są kasowane. Portal nie działał produkcyjnie
i nie ma realnych danych rekrutacyjnych, więc wystarcza blokada nowych danych — bez procedury
zamrażania ani migracji danych (#1150). Teksty publiczne, SEO, strona dla pracodawców i Pomoc
opisują wyłącznie portal ogłoszeń (#1149, #1151); odznaka „zweryfikowana firma” znaczy, że
administrator sprawdził dane rejestrowe (tożsamość) przedsiębiorstwa — nie jest oceną firmy
ani oferty.

Ponowne włączenie funkcji rekrutacyjnych wymaga nowej, jawnej decyzji właściciela i obu kluczy
trybu (zmienna środowiskowa i stan w bazie, #1143). Zmiana „przy okazji” innej pracy jest
błędem.
