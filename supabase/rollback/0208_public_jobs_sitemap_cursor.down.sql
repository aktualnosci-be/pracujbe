-- =============================================================================
-- Rollback 0208 — kursorowe RPC sitemapy ofert (#1042). Uruchamiać ręcznie jako migrator,
-- w jednej transakcji (psql -1 -f …), i dopiero wtedy usunąć wpis z app_migrations.history.
-- Plik celowo BEZ BEGIN/COMMIT (supabase/tests/sitemap-cursor-rollback.sql wykonuje go
-- w transakcji i cofa). Usuwa tylko funkcje i indeks 0208; dane bez zmian. Po wycofaniu
-- sitemap ofert (`src/lib/sitemap-jobs.ts`) przestaje działać — wycofanie połączyć
-- z wycofaniem kodu z tego samego PR.
-- =============================================================================

drop function if exists public.get_public_jobs_sitemap_page(timestamptz, uuid, timestamptz, uuid, integer);
drop function if exists public.get_public_jobs_sitemap_shard_starts(integer);
drop index if exists public.idx_jobs_sitemap_cursor;
