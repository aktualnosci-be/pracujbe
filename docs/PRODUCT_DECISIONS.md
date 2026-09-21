# Decyzje produktowe

## 2026-09-22: bezpłatny etap rozwoju

Pracuj.be rozwijamy obecnie bez monetyzacji. Portal nie sprzedaje pakietów, subskrypcji ani
pojedynczych publikacji ofert. Interfejs nie pokazuje cennika ani zachęt do zakupu, a serwer
odrzuca próby rozpoczęcia checkoutu i zdarzenia sprzedażowego webhooka nawet wtedy, gdy w
środowisku pozostały sekrety Stripe.

Tabele finansowe pozostają w bazie, aby wycofanie sprzedaży nie wymagało destrukcyjnej migracji.
Ich obecność nie oznacza, że funkcja jest aktywna. Powrót do monetyzacji wymaga nowej, jawnej
decyzji właściciela oraz osobnego wdrożenia i testów.

Docelowym środowiskiem uruchomieniowym aplikacji i PostgreSQL jest Railway. Migracja techniczna
jest prowadzona osobno; ten wpis opisuje kierunek produktu, a nie potwierdza zakończenia migracji.
