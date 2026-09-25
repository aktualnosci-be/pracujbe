> **PROJEKT — do weryfikacji prawnika, nieopublikowany.** Opracowanie zewnętrzne z 25.09.2026 (analiza, nie opinia kancelarii); nic z tego pliku nie jest w UI.

# Zmiany względem przekazanej paczki i mapa danych

**Dokumentacja wejściowa: 16 plików ZIP, 25.09.2026. Nie wykonano przeglądu repozytorium ani produkcji.**

## 1. Sposób zastosowania

Pliki w `szkice/` zastępują projekty o tych samych nazwach po zatwierdzeniu właściciela. Nie podmieniać automatycznie oryginałów w repozytorium. `retention-proposal.json` jest decyzją projektową, nie kodem migracji. Dwa dodatkowe projekty to `dsa-moderacja.md` i `role-portal-pracodawca.md`.

Oryginalne `data-map.generated.md` pozostaje bez zmian w `materialy-zrodlowe/`. Poprawki należy wprowadzić do źródła mapy (`src/lib/privacy/data-map.ts`) i właściwego rejestru procesorów (`src/lib/privacy/processors.ts`), a potem przegenerować dokument i porównać wynik z bazą. Opracowanie nie zawiera tych plików źródłowych, dlatego nie udaje gotowego patcha.

## 2. Istotne korekty merytoryczne

| Materiał / kwestia | Korekta |
|---|---|
| `00-CO-ZROBIC.md`: „technika jest gotowa” | Niepotwierdzone. Z dokumentacji wynikają brakujące zadania, nieaktualizowana aktywność, ograniczone statusy i niewykazane harmonogramy. |
| Stary ROPA vs `DATA_RETENTION.md` | Stary opis mówi o braku eksportu/usuwania; nowszy opis migracji0105 przedstawia te funkcje. Wymagana kontrola wdrożonej wersji; nie wybrać arbitralnie korzystniejszego opisu. |
| `deleted_file`, `deleted_profile`:30 dni | Projekt7dni dla porządków; żądanie osoby osobno, bez zbędnej zwłoki, cel72h fizycznie. Koniec usunięcia, nie dopiero enqueue po terminie. |
| `closed_application` | Dodać wszystkie statusy końcowe, w tym hired; closed_at zamiast modyfikowalnego updated_at. Ustalić reguły rzeczywistego ponownego otwarcia. |
| `inactive_candidate_cv` | Nie włączać, zanim last_seen_at nie oznacza rzeczywistej aktywności. Osobne joby kont730 i widoczności180. |
| `confirmed_guest_request` | Klucz konfiguracji nie tworzy joba. Dodać czyszczenie30 i rozdzielenie danych aplikacji od dowodu potwierdzenia. |
| Gość i zgody | Zamiast obligatoryjnej zgody RODO: polecenie aplikowania i informacja. Marketing i wyszukiwalność oddzielnie. |
| Tombstone≥400 | Ograniczenie techniczne, nie wymóg prawny. Docelowo30 dopiero po dowodzie kopii≤14dni i kompletnego replay. |
| Backup14copies | Liczba plików nie wyznacza maksymalnego wieku. Inwentaryzacja kopii/eksportów, absolutny termin, ochrona rejestru usunięć. |
| Kolejka storage | Po20błędach wymagana widoczna awaria i obsługa ręczna; nie „zaliczone usunięcie”. |
| Lejek niezależny od banera | Wyłączyć lub wdrożyć uprzednią zgodę. RAM, nonce, credentials:omit nie wyłączają ePrivacy. |
| Receipts GC przy następnym zapisie | Nie gwarantuje48h. Osobny harmonogram i test braku ruchu. |
| Role pracodawcy | Co do zasady odrębni administratorzy, nie automatyczne powierzenie całej bazy. Nowy ATS/ranking wymaga innej oceny. |
| CV | Nie ogłaszać automatycznego przesłania pliku pracodawcy, skoro opis przewiduje owner-only. |
| Resend | Region wysyłki nie oznacza regionu przechowywania. Zweryfikować rzeczywiście doręczone wiadomości i śledzenie, nie tylko SDK. |
| Anthropic | Obraz trafia bez wcześniejszej redakcji; ograniczenie odpowiedzi nie zapobiega ujawnieniu wejścia. Sprawdzić konkretny model i retencję, a nie ogólną obietnicę30dni. |
| AI / matching | Nie traktować braku AI jako wyłączenia profilowania/art.22 ani człowieka jako automatycznego wyłączenia wysokiego ryzyka. Aktualizacja harmonogramu2026. |
| DSA 7/14dni | Cele obsługi, nie terminy ustawowe. Sześć miesięcy kalendarzowych; wyjątkiSME najpierw dowodowe. |
| APD / kontakt | Właściwość według operatora i przetwarzania; portal zgłoszeńFR/NL/DE. Brak podstaw do wpisania fikcyjnego dyżuru. |
| Portal a pośrednictwo | Dodać analizęKRAZ i trzech regionów Belgii. Klauzula „tablica ogłoszeń” nie wyłącza regulacji. |

## 3. Konkretne korekty klasyfikacji mapy

Mapę traktować jako narzędzie operacyjne, nie orzeczenie, że dana tabela nigdy nie zawiera danych osobowych. Dokument wejściowy klasyfikuje 91 tabel; granica58/33 nie zastępuje analizy kolumn, JSON i powiązań.

`job_funnel_receipts`: identyfikator zdarzenia, czas i oferta mogą umożliwiać wyróżnienie/łączenie; oznaczyć co najmniej jako dane wymagające oceny pseudonimizacji, a nie z definicji anonimowe. `job_funnel_daily`: agregat zależy od liczebności i możliwości ponownej identyfikacji; wskazać ograniczenia małych grup.

`processed_webhooks`: ID zdarzenia lub payload mogą po połączeniu z dostawcą identyfikować osobę. Tabele subskrypcji z `provider_customer_id`, reprezentantem lub przedsiębiorcą jednoosobowym nie są automatycznie nieosobowe, nawet gdy płatności są obecnie OFF. Nie utrzymywać niepotrzebnych danych produkcyjnych w „nieaktywnej” funkcji.

Tłumaczenia, ogłoszenia, pytania screeningowe, wymagania, kampanie i pola swobodne mogą zawierać nazwiska, adresy, kontakt oraz dane wrażliwe. Dodać kategorie „potencjalne dane osobowe w treści” i reguły minimalizacji zamiast niezmiennego `personal=false`.

Audyt, DSA, snapshots i JSON mogą pozostać osobowe po wyzerowaniu FK lub wymazaniu IP/UA. HMAC adresu e-mail jest co do zasady pseudonimizacją, gdy operator nadal może porównywać lub łączyć rekordy. Rejestr blokad wysyłki nie powinien być opisywany jako anonimowy.

Uwzględnić `auth.email_outbox`, bufor gościa, wszystkie kolejki aplikacyjne, storage queue, signed URLs w logach, zaproszenia, indeksy wyszukiwania, cache, backupy i eksporty tombstones. ROPA na poziomie celu nie musi mieć jednego wiersza na każdą tabelę, ale każda tabela powinna wskazywać cel, właściciela, podstawę, retencję, zadanie, odbiorców i zachowanie przy usunięciu.

## 4. Uzupełnienie rejestru procesorów

Dla Railway/Resend/Cloudflare/Supabase/Anthropic/Sentry przechowywać stan enabled, dokładną stronę umowy, usługi, role, wersję i dowód DPA, region danych/kopii/logów, dostęp wsparcia, subprocesorów, transfer, termin usunięcia i wyjątki. Rozdzielić role własnego administratora usługodawcy. OFF nie jest podstawą do tworzenia fikcyjnego podpisanego DPA; status „nieużywany — zablokowany” jest poprawny.

## 5. Publikacja językowa

Pliki publiczne mają świadomie pozostawione pola faktów i danych runtime. Usunąć front matter przed wyświetleniem. W zgodzie marketingowej ostatni akapit wdrożeniowy jest instrukcją redakcyjną, nie treścią checkboxa. W informacji kandydata nie wyświetlać całego akapitu o „nie dodajemy zgody RODO” jako obowiązkowego oświadczenia: służy on projektantowi formularza; wyświetla się prawidłowy przycisk i odrębne warunki.

Treści w4językach są projektami tego samego modelu, bez wskazania jednego języka jako odbierającego prawa konsumentowi. Ostatecznie sprawdzić linki perlocale, nazwy prawne podmiotów, rzeczywiste prawa dostępu i tożsamość odbiorcy każdej aplikacji. Zmiana tylko polskiej wersji retencji wymaga aktualizacji pozostałych wersji.
