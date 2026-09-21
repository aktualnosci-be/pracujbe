# AI i wielojęzyczny Pracuj.be

Decyzja właściciela: portal po polsku, rumuńsku, ukraińsku, francusku, niderlandzku i angielsku. Oferty i profile automatycznie tłumaczone na pozostałe języki, również po każdej zmianie.

## Etapy

- [ ] #29 — pełny portal w sześciu językach
- [ ] #30 — benchmark dostawców i glosariusz
- [ ] #31 — rewizje źródeł i kolejka
- [ ] #32 — adapter i kontrola jakości
- [ ] #33 — tłumaczenia ofert po edycji
- [ ] #34 — prywatne tłumaczenia profili
- [ ] #35 — podgląd, korekty, wyszukiwanie i SEO
- [ ] #36 — prywatność, koszty i odbiór
- [ ] #37 — dalszy asystent AI

## Zależności

#29 i #30 można przygotowywać podczas migracji. #31 po fundamencie PostgreSQL (#23–#25); #32 po #30 i #31. #33/#34 po #32; #35 po #29/#33/#34. #36 jest bramką przed wysłaniem danych osobowych i pełnym uruchomieniem. #37 po odbiorze podstaw. Produkcja tylko main, bez staging.

## Definicja ukończenia

Każdy z sześciu języków może być źródłem. Pięć pozostałych wersji odnosi się do aktualnej rewizji; stary worker nie nadpisuje nowej treści. Kwoty, brutto/netto, kwalifikacje i poziomy języka nie zmieniają znaczenia. Korekty ręczne są chronione. Profile mają taką samą prywatność w każdym języku. Udokumentowane jakość, koszty, retencja, testy współbieżności, CI i odbiór produkcji. Sam JSON lub pozytywna ocena modelu nie potwierdzają jakości.

## Research

Pełny dokument w PR #21: [AI_MULTILINGUAL_PLAN.md](https://github.com/aktualnosci-be/pracujbe/blob/infra/railway/docs/AI_MULTILINGUAL_PLAN.md). Porównanie bazuje na oficjalnych dokumentacjach [DeepL](https://developers.deepl.com/docs/getting-started/supported-languages), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) i [Google Translation](https://docs.cloud.google.com/translate/docs/translate-text). Nie przeprowadzono jeszcze płatnego benchmarku ani nie wybrano dostawcy produkcyjnego.

