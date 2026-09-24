# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do #493. **Nie jest treścią prawną serwisu** i nie trafia na strony
> `/regulamin` ani `/polityka-prywatnosci`. Strony prawne pozostają placeholderem z `noindex`
> do czasu zatwierdzenia treści (#61). Brzmienia poniżej opisują, co dziś pokazuje formularz
> (klucze w `src/messages/*.json`), i pytania do rozstrzygnięcia.

## 1. Co zmieniła część techniczna

Formularze mają osobne, **domyślnie niezaznaczone** pola. Każde ma własny, niezmienny dowód
(tabela, wersja pokazanej treści, kanał, język, czas):

| Element | Charakter | Wymagany? | Dowód w bazie |
|---|---|---|---|
| Akceptacja regulaminu | warunek umowy o świadczenie usługi | tak (konto) | `document_acceptances.kind = terms_acceptance` |
| Zapoznanie się z informacją o prywatności | obowiązek informacyjny (art. 13 RODO), **nie zgoda** | tak (potwierdzenie) | `document_acceptances.kind = privacy_notice_ack` |
| E-maile z nowościami (marketing) | zgoda opcjonalna (art. 6 ust. 1 lit. a) | nie | `email_consent_events` (#513): `category = marketing`, `source = signup` |

- Wersja treści: identyfikator `consent_versions`, gdy dokument zostanie opublikowany; do tego
  czasu `sha256:` etykiety w języku formularza.
- Kanał: `signup` (rejestracja) albo `onboarding` (krok 6 profilu kandydata).
- Zapisy sprzed zmiany mają `kind = legacy_combined` — to ślad dawnego wspólnego checkboxa
  „Akceptuję regulamin i politykę prywatności”. **Nie są** zgodą na żaden cel opcjonalny.
- Zgodę na marketing można wycofać w ustawieniach powiadomień i linkiem wypisania w e-mailu;
  każda zmiana trafia do tego samego dziennika `email_consent_events` (#513). Odmowa przy
  rejestracji nie tworzy wpisu (marketing jest domyślnie wyłączony).
- Aplikacja bez konta: jedno pole — potwierdzenie zapoznania się z informacją o prywatności
  (dotychczasowy snapshot wersji polityki w `guest_application_requests.consent_*`).

## 2. Brzmienia robocze (PL, obecnie w interfejsie)

**Rejestracja kandydata i pracodawcy**

1. `Akceptuję [regulamin].`
2. `Zapoznałem(-am) się z [informacją o prywatności].`
3. Grupa „Opcjonalnie”:
   `Chcę dostawać e-maile z nowościami Pracuj.be. Mogę to wyłączyć w ustawieniach.`

Komunikaty błędów: „Zaakceptuj regulamin, aby założyć konto.” · „Potwierdź, że
zapoznałeś(-aś) się z informacją o prywatności.”

**Onboarding kandydata (krok 6)** — pola 1 i 2 jak wyżej, bez zgód opcjonalnych.

**Aplikowanie (z kontem i bez konta)**

`Zapoznałem(-am) się z [informacją o prywatności]. Zgłoszenie trafi do pracodawcy tej oferty.`

Tłumaczenia NL/FR/EN mają ten sam sens i są w `src/messages/{nl,fr,en}.json` (klucze
`auth.termsAcceptLinks`, `auth.privacyNoticeAckLinks`, `auth.marketingOptIn`,
`onboarding.*`, `apply.privacyNoticeAck`).

## 3. Pytania do prawnika

1. Czy potwierdzenie zapoznania się z informacją o prywatności ma być **wymagane**, czy
   wystarczy widoczna informacja z linkiem przed przyciskiem? (Technicznie to jedna linia —
   schemat `privacyNoticeAck` w `src/lib/validation/auth.ts` i warunek w `record_signup_consents`.)
2. Czy przekazanie danych pracodawcy przy aplikowaniu opiera się na art. 6 ust. 1 lit. b
   (działania przed zawarciem umowy) — wtedy pole przy aplikowaniu jest wyłącznie informacyjne?
3. Brzmienie zgody marketingowej: zakres (e-mail, ewentualnie inne kanały), administrator,
   częstotliwość; czy potrzebny odrębny wariant dla pracodawców (B2B).
4. Czy pracodawca akceptuje regulamin w imieniu firmy (reprezentacja) i czy potrzebne jest
   osobne oświadczenie o umocowaniu.
5. Czy publikacja profilu kandydata (widoczność dla pracodawców) wymaga zgody, czy wystarczy
   osobne, świadome działanie z opisem widoczności (#485/#487). Obecnie to osobny przełącznik
   po ukończeniu onboardingu; ten szkic go nie zmienia.
6. Jak opisać historyczne zapisy `legacy_combined` w polityce prywatności / rejestrze czynności.
7. Okres przechowywania dowodów akceptacji i zgód po usunięciu konta (dziś usuwane kaskadowo
   razem z kontem).

## 4. Zależności

- #61 — zatwierdzona treść regulaminu i polityki prywatności (wpisy w `consent_versions`).
- #485/#487 — macierz podstaw prawnych (AI, publikacja profilu).
- #513 (#45, etap 2, w `main`) — dziennik zgód e-mail `email_consent_events`; rejestracja
  dopisuje do niego zdarzenia ze źródłem `signup`.
