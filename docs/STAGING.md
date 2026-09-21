# Środowisko staging — wycofana koncepcja

Pracuj.be nie utrzymuje obecnie stagingu. Decyzja właściciela z 21 września
2026 ustanawia jedną produkcję Railway wdrażaną z `main`, z natywnym
`Wait for CI`. Nie twórz gałęzi `develop`, Vercel Preview ani drugiej bazy
tylko po to, aby odtworzyć poprzedni model wdrożeń.

Izolowane testy korzystają z lokalnych lub jednorazowych środowisk testowych.
Jeśli osobny staging stanie się potrzebny, wymaga nowej decyzji właściciela,
oddzielnych danych i sekretów, ochrony dostępu oraz pełnego `noindex`.

Aktualny model wdrożeń opisuje [`DEPLOYMENT.md`](./DEPLOYMENT.md), a decyzje
migracji [`railway/DECYZJE.md`](./railway/DECYZJE.md).
