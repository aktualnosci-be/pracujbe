/**
 * GC tabel technicznych w `/api/maintenance` (#746, migracja 0224): `rate_limit_gc`
 * i `processed_webhooks_gc` usuwają najwyżej `TECHNICAL_GC_BATCH_LIMIT` wierszy na wywołanie
 * (najstarsze pierwsze, SKIP LOCKED). Pełna partia = zaległość → kolejna partia w osobnej
 * transakcji, najwyżej `TECHNICAL_GC_MAX_BATCHES` na przebieg; reszta w następnym przebiegu.
 */
export const TECHNICAL_GC_BATCH_LIMIT = 5000;
export const TECHNICAL_GC_MAX_BATCHES = 10;
