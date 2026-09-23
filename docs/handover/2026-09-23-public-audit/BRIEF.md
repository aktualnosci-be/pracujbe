# Brief audytu publicznej części Pracuj.be (faza 1 — TYLKO ODCZYT)

Repo: /workspace/pracujbe (checkout `main` @ f11170e). NIE EDYTUJ żadnych plików w repo, nie rób commitów,
nie twórz issues/PR, nie komentuj na GitHub. Wolno pisać tylko w scratchpadzie:
/tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/audit/

Działający serwer produkcyjny (next start, tryb demo, bez bazy): http://localhost:3100  (NIE uruchamiaj
własnego buildu/serwera, NIE zatrzymuj tego serwera). Języki: /pl /nl /fr /en (tylko te cztery).

Przeglądarka: skrypty Node z `require('/workspace/pracujbe/node_modules/playwright')` i
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. axe: `/workspace/pracujbe/node_modules/@axe-core/playwright`.
Skrypty trzymaj w swoim podkatalogu scratchpadu.

Najpierw przeczytaj /workspace/pracujbe/CLAUDE.md (invariants!) i docs/design/people-passport/README.md.

Co sprawdzać (realnie w przeglądarce, nie tylko w kodzie):
- klawiatura: kolejność Tab, widoczny fokus (outline/ring nie obcięty, nie zasłonięty — WCAG 2.4.7/2.4.11), pułapki fokusu, Escape w dialogach
- nazwy dostępne i etykiety pól (label/aria), powiązanie błędów z polami (aria-describedby/aria-invalid), komunikaty błędów zrozumiałe
- kontrast tekstu i elementów UI (1.4.3 / 1.4.11)
- szerokość 320 px: brak poziomego przewijania dokumentu (scrollWidth > clientWidth), nic nie obcięte
- powiększenie 200% (np. viewport 1280x800 z deviceScaleFactor… LUB viewport 640 px szerokości jako ekwiwalent reflow; oraz page zoom przez CDP `Emulation.setPageScaleFactor` nie jest równoważny — preferuj viewport 640 + tekst 200% via `document.documentElement.style.fontSize='200%'` jako test resize text 1.4.4)
- cele dotykowe (2.5.8: min 24x24; repo przyjmuje 44–48 px dla głównych CTA na mobile)
- przełączanie języka (zachowanie ścieżki/parametrów, lang atrybut, brak brakujących tłumaczeń / kluczy wyświetlonych surowo)
- stany: ładowanie, puste wyniki, błąd/awaria (np. nieistniejący slug, zły parametr zapytania, offline)

Zapisuj TYLKO problemy, które odtworzyłeś (skrypt/kroki + wynik). Dla każdego:
- tytuł, proponowany priorytet P0/P1/P2 (P0 = blokuje zadanie/utrata danych/bezpieczeństwo; P1 = poważna bariera
  dostępności/użyteczności na kluczowej ścieżce; P2 = mniejsza bariera), kryterium WCAG jeśli dotyczy
- kroki odtworzenia (URL, viewport, język), oczekiwany vs obecny wynik
- zakres ekranów/języków
- PLIKI źródłowe, które poprawka zmieni (dokładne ścieżki) — kluczowe dla podziału pracy
- czy potrzebne zmiany w src/messages/*.json (klucze)
- szkic poprawki i propozycja testu regresyjnego (nie test powtarzający implementację)

Znane istniejące issues, nie duplikuj (możesz dopisać „potwierdzam/nie potwierdzam”): #76 (CTA offline 44px→48px),
#121 (martwy test /dashboard w seo.spec), #189 (filtr miasta po przetłumaczonej nazwie), #191 (awaria podobnych ofert
blokuje szczegół), #188 (okres stawki w filtrze), #22, #9, #61 (Pomoc/Kontakt/Polityka — treści właściciela, NIE
proponuj wymyślonych treści/danych kontaktowych), #118/PR #128 (tytuły SEO), #182/PR #183 (OG obrazy), #46 (Turnstile).
Nie proponuj dodawania języków RO/UK.

Obszary poza zakresem (inne sesje): panele candidate/employer/admin, wiadomości, e-mail, Railway/PostgreSQL, CI workflow.

Wynik: plik `<twój-obszar>.md` w katalogu audit/ + krótkie podsumowanie w odpowiedzi (lista ustaleń z priorytetem i plikami).
Budżet: bądź konkretny, max ~10 ustaleń, najpierw najpoważniejsze.
