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
