-- =============================================================================
-- Rollback 0098 — taksonomia ESCO (#93). Uruchamiać ręcznie jako migrator, w jednej
-- transakcji (psql -1 -f …), i dopiero wtedy usunąć wpis z app_migrations.history.
-- Plik celowo BEZ BEGIN/COMMIT (rls.sql ESCO93-R wykonuje go w transakcji i cofa).
--
-- Usuwa: wiersze ESCO z occupations/skills (FK candidate_skills/job_skills.skill_id
-- mają ON DELETE SET NULL — etykieta skill_label w profilu/ofercie zostaje), etykiety,
-- relacje, metadane snapshotu, funkcje i kolumny 0098. Wiersze ręczne zostają.
-- Granty occupations/skills zostają zawężone do SELECT dla klienta — 0098 tylko
-- odebrał zapis, którego polityki RLS i tak nie dopuszczały; przywracanie go jest zbędne.
-- =============================================================================

drop function if exists public.occupation_label(uuid, text);
drop function if exists public.skill_label(uuid, text);
drop function if exists public.esco_finish_snapshot(text, jsonb);
drop function if exists public.esco_upsert_relations(text, jsonb);
drop function if exists public.esco_upsert_skills(text, jsonb, text);
drop function if exists public.esco_upsert_occupations(text, jsonb, text);
drop function if exists public.esco_resolve_manual(text, jsonb, text);
drop function if exists public.esco_sync_labels(text, jsonb);
drop function if exists public.esco_begin_snapshot(jsonb, text);

drop table if exists public.occupation_skills;
drop table if exists public.occupation_labels;
drop table if exists public.skill_labels;

delete from public.occupations where source = 'esco';
delete from public.skills where source = 'esco';

alter table public.occupations
  drop column if exists esco_snapshot_id,
  drop column if exists isco_group,
  drop column if exists esco_code,
  drop column if exists esco_uri,
  drop column if exists source;
alter table public.skills
  drop column if exists esco_snapshot_id,
  drop column if exists reuse_level,
  drop column if exists skill_type,
  drop column if exists esco_uri,
  drop column if exists source;

drop table if exists public.esco_snapshots;
drop function if exists public.esco_snapshots_pin();
