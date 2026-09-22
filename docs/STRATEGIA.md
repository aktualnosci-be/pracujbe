# Strategia rozwoju Pracuj.be

Stan na 22 września 2026. Ten dokument porządkuje kierunek produktu i kolejność
prac. Nie zastępuje kryteriów odbioru w issues ani szczegółowych decyzji w
[`PRODUCT_DECISIONS.md`](PRODUCT_DECISIONS.md) i
[`railway/DECYZJE.md`](railway/DECYZJE.md).

## Decyzje właściciela

- Railway jest jedynym docelowym miejscem dla aplikacji, PostgreSQL, zadań
  cyklicznych i prywatnych plików. Produkcja wdraża się z `main` po zielonym CI;
  nie tworzymy stagingu.
- MVP jest bezpłatny. Nie uruchamiamy Stripe, pakietów, opłat od kandydatów ani
  sprzedaży publikacji. Porządkuje to [issue #51](https://github.com/aktualnosci-be/pracujbe/issues/51).
- Portal obsługuje sześć języków: polski, rumuński, ukraiński, francuski,
  niderlandzki i angielski (`pl`, `ro`, `uk`, `fr`, `nl`, `en`). Plan prowadzą
  [issues #29–#38](https://github.com/aktualnosci-be/pracujbe/issues/38).
- Dopasowanie pozostaje deterministyczne i wyjaśnialne. AI może tłumaczyć,
  porządkować oraz podpowiadać, ale nie wybiera samodzielnie kandydatów i nie
  dopisuje faktów do ofert ani profili.

## Cel najbliższego etapu

Najbliższy etap ma dowieść, że kandydat może bezpiecznie znaleźć aktualną ofertę,
zrozumieć jej warunki i zgłosić się bez niepotrzebnych formalności. Równolegle
pracodawca ma otrzymać prawidłową, pojedynczą aplikację i móc prowadzić proces w
ustalonym języku odbiorcy.

Nie mierzymy postępu liczbą wdrożonych integracji. Mierzymy go aktualnymi ofertami,
ukończonymi profilami lub aplikacjami, poprawnością przepływów i brakiem wycieku
danych między użytkownikami.

## Kolejność pracy

### 1. Domknąć bezpieczny fundament Railway

Najpierw kończymy bootstrap i migracje PostgreSQL ([#23](https://github.com/aktualnosci-be/pracujbe/issues/23))
oraz serwerową warstwę danych i RLS ([#25](https://github.com/aktualnosci-be/pracujbe/issues/25)).
Model ról już zakłada oddzielenie właściciela DDL od loginów runtime. Nie
zastępujemy go mechanicznym `FORCE ROW LEVEL SECURITY`: wymagane są testy
`session_user`, `current_user`, `row_security`, ownership i negatywny test dryfu.

Równolegle domykamy bezpłatny MVP ([#51](https://github.com/aktualnosci-be/pracujbe/issues/51))
i test współbieżnych odpowiedzi na propozycję wraz z jednoznaczną granicą
wygaśnięcia ([#88](https://github.com/aktualnosci-be/pracujbe/issues/88)).

### 2. Zdobyć legalną, aktualną podaż ofert

[Issue #90](https://github.com/aktualnosci-be/pracujbe/issues/90) prowadzi
rozmowy z firmami i agencjami, ustalenie wymaganych pól oraz pierwszą partię
autoryzowanych ofert. Nie kopiujemy ogłoszeń z portali i grup.

Weryfikacja numeru przedsiębiorstwa przez VIES jest obiecującym sygnałem
zaufania, lecz wymaga osobnego issue i odpornego kontraktu. Awaria, limit lub
niejednoznaczna odpowiedź usługi ma dawać stan „nie udało się sprawdzić”, nigdy
fałszywy komunikat „firma nieważna”. Odznaka potwierdza tylko wynik konkretnego
sprawdzenia; nie poświadcza uczciwości wszystkich ofert firmy.

Przed publikacją oferta powinna jawnie podawać istotne warunki, gdy mają
zastosowanie: rodzaj umowy, numer komisji parytetowej, widełki i okres stawki,
brutto/netto, zakwaterowanie, potrącenia oraz transport. Dokładny zakres wynika
z rozmów prowadzonych w #90, a nie z samego raportu researchowego.

### 3. Skrócić drogę do aplikacji i zwiększyć bezpieczeństwo

Kandydatami do osobnych, małych issues są w tej kolejności:

1. aplikowanie bez wcześniejszego zakładania pełnego konta, z bezpiecznym
   przejęciem aplikacji po weryfikacji adresu i ochroną przed duplikatami;
2. pytania screeningowe przypisane do oferty, w tym jawne pytania blokujące,
   których znaczenie widzi kandydat;
3. moderacja pojedynczej oferty oraz skatalogowane powody zgłoszeń;
4. blokowanie firmy przez kandydata;
5. rozróżnienie „do uzgodnienia”, „nie podano” i wynagrodzenia według baremy,
   wraz z kanoniczną wartością do filtrowania;
6. termin ważności certyfikatów i dokumentów;
7. bezpieczna deduplikacja kont po znormalizowanym e-mailu i telefonie.

To są hipotezy produktowe. Każda wymaga opisu zagrożeń, testów negatywnych i
kryteriów odbioru przed implementacją. Nie przenosimy kodu z obcych projektów;
repozytoria open source służą wyłącznie do poznania modeli danych i przypadków
brzegowych.

### 4. Retencja i pomiar bez śledzenia w przeglądarce

Po działającym przepływie aplikacji warto rozważyć zapisane wyszukiwania i
alerty oraz dzienne agregaty pojawień się oferty w wynikach. Agregaty serwerowe
mają zbierać minimum potrzebne do lejka i nie mogą omijać zasad zgody ani
zapisywać tekstu wyszukiwania zawierającego dane osobowe.

Strony SEO tworzymy dopiero dla aktualnych kombinacji z rzeczywistą podażą.
Nie generujemy masowo pustych stron i nie traktujemy zewnętrznych portali jako
źródła ofert bez potwierdzonego prawa do republikacji.

### 5. Wspólny słownik kompetencji i sześć języków

ESCO może zasilić kanoniczne identyfikatory zawodów i umiejętności oraz
lokalizowane etykiety. Import jest wersjonowanym snapshotem do PostgreSQL, z
proweniencją i atrybucją; aplikacja nie zależy od zewnętrznego API przy każdym
żądaniu. ESCO wspomaga dane strukturalne, ale nie zastępuje planu rewizji,
walidacji i prywatności tłumaczeń w [#29–#38](https://github.com/aktualnosci-be/pracujbe/issues/38).

VDAB Competent 2 jest drugim kandydatem dla belgijskiej terminologii. Dostęp do
danych kompetencyjnych i integracja publikacji lub pobierania wakatów to różne
procesy. Żaden wniosek ani umowa z VDAB nie jest obecnie zatwierdzona; przed
podjęciem zobowiązania właściciel wybiera konkretny przypadek użycia.

### 6. Uruchomić mierzalny pilotaż kandydatów

Dopiero po osiągnięciu progu podaży z #90 uruchamiamy
[pilot #91](https://github.com/aktualnosci-be/pracujbe/issues/91). Kanały dobieramy
osobno dla grup językowych i włączamy tylko wtedy, gdy cały docelowy przepływ ma
właściwy język. Telegram może być tanią hipotezą dla części użytkowników
ukraińskojęzycznych, ale wymaga pomiaru i zgód; nie przyjmujemy jego popularności
ani skuteczności jako faktu bez badania.

## Czego teraz nie robimy

- nie wracamy do Supabase, Vercela, stagingu ani płatnego MVP;
- nie wdrażamy rankingu kandydatów przez LLM ani autonomicznego chatbota;
- nie budujemy natywnej aplikacji, rozbudowanego parsera CV ani nieoficjalnej
  integracji WhatsApp;
- nie publikujemy negatywnych list firm ani nie przedstawiamy braku odznaki jako
  dowodu nadużycia;
- nie wysyłamy wniosków, nie akceptujemy licencji i nie zawieramy umów z
  dostawcami danych bez jawnej decyzji właściciela.

Szczegóły źródeł, poziom pewności i warunki wejścia do implementacji opisuje
[`RESEARCH-TECH.md`](RESEARCH-TECH.md).
