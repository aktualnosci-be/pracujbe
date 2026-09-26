-- =============================================================================
-- 0141_company_links_edit.sql — panel pracodawcy: edycja strony WWW i logo firmy.
--
-- `companies.website`/`logo_url` istniały od 0002, ale nie miały walidacji formatu ani
-- ścieżki edycji w panelu (CLAUDE.md, „Otwarte: edycja strony i logo firmy w panelu
-- pracodawcy"). Teraz:
--
--   1. CHECK na obu kolumnach — ta sama reguła co `public_https_url` (0114): bezwzględny
--      https, bez danych logowania/spacji/cudzysłowów, najwyżej 2048 znaków, albo NULL.
--      Niezależne od ścieżki zapisu (RPC/Server Action/przyszła funkcja) — jak SEC-04 (0026).
--   2. `audit_company_change()` — nowa gałąź: zmiana website/logo_url (bez zmiany statusu,
--      która ma już własny wpis) → `company.links_changed` z wartościami przed/po.
--
-- Zapis idzie przez ISTNIEJĄCĄ ścieżkę edycji firmy (`updateCompany`/`companies_update_member`,
-- 0040: tylko owner/admin firmy, RLS). W przeciwieństwie do nazwy/VAT zmiana website/logo_url
-- NIE cofa weryfikacji — `protect_company_verification` (0072) reaguje wyłącznie na `name`/
-- `vat_number`, tu bez zmian (dowód: `rls.sql` sekcja CL141).
--
-- Rollback:
--   alter table public.companies drop constraint if exists companies_website_https;
--   alter table public.companies drop constraint if exists companies_logo_url_https;
--   odtworzyć `audit_company_change` z 0084 (bez gałęzi company.links_changed).
-- =============================================================================

alter table public.companies drop constraint if exists companies_website_https;
alter table public.companies add constraint companies_website_https
  check (website is null or public.public_https_url(website) is not null);

alter table public.companies drop constraint if exists companies_logo_url_https;
alter table public.companies add constraint companies_logo_url_https
  check (logo_url is null or public.public_https_url(logo_url) is not null);

-- --- Audyt: zmiana strony WWW/logo (bez wpływu na status) ----------------------------
create or replace function public.audit_company_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
    values (auth.uid(), 'company.created', 'company', new.id,
            jsonb_build_object('status', new.status, 'name', new.name));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.status_changed', 'company', new.id,
            jsonb_build_object('status', old.status),
            jsonb_strip_nulls(jsonb_build_object(
              'status', new.status,
              'reason', case when new.status in ('rejected', 'suspended') then new.status_reason end)));
  elsif tg_op = 'UPDATE'
    and (new.website is distinct from old.website or new.logo_url is distinct from old.logo_url) then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.links_changed', 'company', new.id,
            jsonb_build_object('website', old.website, 'logo_url', old.logo_url),
            jsonb_build_object('website', new.website, 'logo_url', new.logo_url));
  end if;
  return new;
end $$;
