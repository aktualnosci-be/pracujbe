# Fragment testowy ESCO v1.2.1 — NIE jest oficjalnym plikiem wydania

`esco-v1.2.1-sample/` i `esco-v1.2.1-sample.manifest.json` (snapshot
`esco-v1.2.1-sample`, `sample: true`) to jawnie oznaczony fragment do testów pipeline'u
importu (#93). Dane są prawdziwe: ESCO v1.2.1 z publicznego API ESCO
(`selectedVersion=v1.2.1`), zapisane w układzie kolumn paczki CSV. Fragment zawiera
5 zawodów, 22 umiejętności, 24 relacje i 4 języki portalu.

- Budowa: `NODE_USE_ENV_PROXY=1 node scripts/esco/build-sample-fixture.mjs`.
- Import wymaga `--allow-sample`, a zaimportowane wiersze dostają `is_demo = true`.
- Pełny import i licencja: `docs/ESCO.md`.

This service uses the ESCO classification of the European Commission.
