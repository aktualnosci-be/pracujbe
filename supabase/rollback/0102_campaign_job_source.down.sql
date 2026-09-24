-- =============================================================================
-- Rollback 0102 — zaufany odczyt oferty do materiałów kampanii (#186, #175).
-- Uruchamiać ręcznie jako migrator, w jednej transakcji (psql -1 -f …), i dopiero wtedy
-- usunąć wpis z app_migrations.history. Plik celowo BEZ BEGIN/COMMIT
-- (supabase/tests/campaign-job-rollback.sql wykonuje go w transakcji i cofa).
--
-- Usuwa tylko funkcje 0102; tabele i dane bez zmian. Po wycofaniu eksportery
-- (scripts/export-job-post.mjs, /api/employer/jobs/[id]/banner) zwracają „oferta niedostępna”,
-- więc wycofanie należy połączyć z wycofaniem kodu z tego samego PR.
-- =============================================================================

drop function if exists public.get_managed_campaign_job(uuid, text);
drop function if exists public.get_campaign_job(text, text);
drop function if exists public.campaign_job_source(uuid, text, text);
