# Konfiguracja domeny pracuj.be

Publiczna domena `pracuj.be` należy do jedynej produkcji w Railway. Rekordy
pocztowe SPF, DKIM i DMARC opisuje [`RESEND_SETUP.md`](./RESEND_SETUP.md), a
model wdrożeń [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Konfiguracja Railway

W środowisku `production`, w usłudze `pracujbe`, dodaj domenę niestandardową
`pracuj.be`. U operatora DNS ustaw dokładnie bieżące `requiredValue` zwrócone
przez API Railway albo wartość wymaganą w panelu usługi.

Gdy dostawca DNS nie pozwala na zwykły CNAME dla domeny głównej, użyj flatteningu CNAME,
ALIAS albo ANAME zgodnie z jego instrukcją. Nie kopiuj dawnych rekordów Vercela.

`www.pracuj.be` powinno przekierowywać trwale do kanonicznego
`https://pracuj.be`. Sposób przekierowania zależy od operatora DNS/proxy;
nie uruchamiaj w tym celu drugiej aplikacji.

## Cloudflare: tryb rekordu DNS a zaufany adres IP klienta (#1073)

Adres IP klienta (receipt zgody, aplikacja bez konta, limitery, bramka hasła) czytamy z
JEDNEGO nagłówka wskazanego przez `TRUSTED_PROXY_HEADER`
(`src/lib/http/trusted-ip.ts`); `X-Forwarded-For` nigdy nie jest źródłem. Nagłówek MUSI
odpowiadać trybowi rekordu w Cloudflare — to jedna decyzja, dwie zmienne, ustawiane razem:

| Tryb rekordu `pracuj.be` w Cloudflare | Kto widzi klienta | `TRUSTED_PROXY_HEADER` | Skutek pomyłki |
|---|---|---|---|
| **DNS-only** (szara chmurka) | brzeg Railway | `x-real-ip` (domyślnie; zmiennej nie trzeba ustawiać) | z `cf-connecting-ip` nagłówka nie ma: bramka hasła zwraca 503, receipty bez IP |
| **Proxied** (pomarańczowa chmurka) | Cloudflare, potem Railway | `cf-connecting-ip` | z `x-real-ip` wszyscy klienci mają adres brzegu Cloudflare: wspólny limit dla całego ruchu (masowe „za dużo prób” przy rejestracji i resecie hasła) i błędne IP w receiptach |

Uwagi:

- Domyślny wybór repozytorium to **DNS-only + `x-real-ip`** (bez zmian w Railway). Przejście na
  proxying to osobna, świadoma zmiana obu ustawień w tym samym oknie; decyzję zapisuje
  właściciel w [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) (W16).
- Przy `cf-connecting-ip` aplikacja przyjmuje `CF-Connecting-IP` tylko od połączeń z brzegu
  Cloudflare (#1090): adres peera z `X-Real-IP` (ustawia go brzeg Railway) musi należeć do
  zakresów z <https://www.cloudflare.com/ips/> (lista `CLOUDFLARE_IP_RANGES` w
  `src/lib/http/trusted-ip.ts`). Żądanie z pominięciem Cloudflare (np. na domenę wygenerowaną
  przez Railway) jest liczone pod swoim prawdziwym adresem, a nie pod wpisanym nagłówkiem.
  Nowe zakresy Cloudflare wymagają aktualizacji listy — do tego czasu ruch z nich liczy się
  pod adresem brzegu (wspólny limit, bezpieczny kierunek błędu). Zbędną domenę Railway i tak
  warto usunąć.
- Zmiana `TRUSTED_PROXY_HEADER` wymaga restartu usługi (zmienna czytana po stronie serwera).

Weryfikacja po zmianie trybu lub nagłówka (przed zdjęciem bramki hasła):

1. Otwórz `https://pracuj.be/` — bramka hasła nie może odpowiedzieć 503 (to znaczy, że
   skonfigurowany nagłówek nie dociera do aplikacji).
2. Zarejestruj konto testowe i sprawdź w bazie, że `document_acceptances.ip_address` ostatniego
   receiptu to Twój publiczny adres, a nie adres z zakresów Cloudflare
   (<https://www.cloudflare.com/ips/>) ani brzegu Railway. Receipt jest zerowany po 7 dniach.
3. Jeśli adres jest błędny — popraw parę „tryb rekordu / `TRUSTED_PROXY_HEADER`” i powtórz.

Automatyczne porównanie ruchu z nagłówkiem w `/api/health` nie jest wdrożone (aplikacja nie zna
trybu rekordu DNS); zabezpieczeniem jest powyższa weryfikacja przy zmianie.

## Weryfikacja

Nie uznawaj samego dodania domeny w panelu za gotowy cutover. Sprawdź:

- status domeny w API Railway albo panelu po propagacji DNS;
- poprawny certyfikat TLS i przekierowanie HTTP do HTTPS;
- odpowiedź `GET https://pracuj.be/api/health`;
- kanoniczny adres oraz przekierowanie z `www`;
- zgodność wdrożonego SHA z zielonym przebiegiem CI.

Dopóki DNS i gotowość backendu nie zostały potwierdzone, status pozostaje
otwarty w issue #18 i [`railway/STATUS.md`](./railway/STATUS.md).
