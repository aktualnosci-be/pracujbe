# Konfiguracja domeny pracuj.be

Publiczna domena `pracuj.be` należy do jedynej produkcji w Railway. Rekordy
pocztowe SPF, DKIM i DMARC opisuje [`RESEND_SETUP.md`](./RESEND_SETUP.md), a
model wdrożeń [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Konfiguracja Railway

W środowisku `production`, w usłudze `pracujbe`, dodaj domenę niestandardową
`pracuj.be`. Railway wskazuje bieżącą wartość rekordu DNS; w chwili przygotowania
tej instrukcji jest to CNAME `xetenf6j.up.railway.app`.

U operatora DNS ustaw dokładnie rekord pokazany przez Railway. Gdy dostawca DNS
nie pozwala na zwykły CNAME dla domeny głównej, użyj flatteningu CNAME,
ALIAS albo ANAME zgodnie z jego instrukcją. Nie kopiuj dawnych rekordów Vercela.

`www.pracuj.be` powinno przekierowywać trwale do kanonicznego
`https://pracuj.be`. Sposób przekierowania zależy od operatora DNS/proxy;
nie uruchamiaj w tym celu drugiej aplikacji.

## Weryfikacja

Nie uznawaj samego dodania domeny w panelu za gotowy cutover. Sprawdź:

- status domeny w Railway po propagacji DNS;
- poprawny certyfikat TLS i przekierowanie HTTP do HTTPS;
- odpowiedź `GET https://pracuj.be/api/health`;
- kanoniczny adres oraz przekierowanie z `www`;
- zgodność wdrożonego SHA z zielonym przebiegiem CI.

Dopóki DNS i gotowość backendu nie zostały potwierdzone, status pozostaje
otwarty w issue #18 i [`railway/STATUS.md`](./railway/STATUS.md).
