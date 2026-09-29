-- =============================================================================
-- 0979 — tryb ogłoszeniowy: szablony odpowiedzi firmy (#1211; epik #1128).
-- Numer TYMCZASOWY — ostateczny nada integrator. Zależy od 0170 (szablony) i 0171
-- (`recruitment_enabled()`, `assert_recruitment_enabled()`, `recruitment_write_allowed()`).
--
-- Decyzja produktowa: portal ogłoszeniowy. Szablony odpowiedzi służą wyłącznie kompozytorowi
-- wiadomości z kandydatem, wyłączonemu w trybie ogłoszeniowym (#1134, 0174). Warstwa aplikacji
-- (#1211) ukrywa trasę i nawigację i zwraca `RECRUITMENT_DISABLED` z akcji; ta migracja dokłada
-- blokadę w bazie:
-- 1. `save_company_message_template` i `delete_company_message_template` = cienkie nakładki
--    ze strażnikiem trybu PRZED jakimkolwiek odczytem/zapisem; dotychczasowa treść z 0170
--    przeniesiona bez zmian do `*_impl` (bez EXECUTE dla klientów). Sygnatury i granty
--    publicznych funkcji bez zmian.
-- 2. BEFORE INSERT na `company_message_templates` i `company_message_template_variants`
--    odrzuca NOWE wiersze w trybie ogłoszeniowym dla każdej roli (także service_role); wyjątek
--    seedu/testów jak w 0171 (`recruitment_write_allowed()`). UPDATE/DELETE bez strażnika
--    tabeli — kaskady usunięcia firmy i konta (`created_by → null`) działają jak dotąd.
-- Istniejące szablony zostają (brak danych produkcyjnych, jak #1150); odczyt pod RLS bez zmian.
--
-- Rollback: supabase/rollback/0979_classifieds_message_templates_off.down.sql.
-- =============================================================================

-- --- 1. Nakładki RPC ze strażnikiem trybu -------------------------------------------------------
alter function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz)
  rename to save_company_message_template_impl;
revoke all on function public.save_company_message_template_impl(uuid, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

create function public.save_company_message_template(
  p_company_id uuid,
  p_template_id uuid,
  p_name text,
  p_variants jsonb,
  p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 0979 (#1211): tryb ogłoszeniowy — szablony odpowiedzi należą do wyłączonych wiadomości.
  perform public.assert_recruitment_enabled();
  return public.save_company_message_template_impl(
    p_company_id, p_template_id, p_name, p_variants, p_expected_updated_at);
end $$;
revoke all on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_company_message_template(uuid, uuid, text, jsonb, timestamptz) to authenticated;

alter function public.delete_company_message_template(uuid, uuid)
  rename to delete_company_message_template_impl;
revoke all on function public.delete_company_message_template_impl(uuid, uuid)
  from public, anon, authenticated;

create function public.delete_company_message_template(
  p_company_id uuid,
  p_template_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 0979 (#1211): jak zapis — narzędzie wyłączone w trybie ogłoszeniowym.
  perform public.assert_recruitment_enabled();
  perform public.delete_company_message_template_impl(p_company_id, p_template_id);
end $$;
revoke all on function public.delete_company_message_template(uuid, uuid) from public, anon;
grant execute on function public.delete_company_message_template(uuid, uuid) to authenticated;

-- --- 2. Tabele: brak nowych szablonów w trybie ogłoszeniowym --------------------------------------
create or replace function public.enforce_recruitment_message_template()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- `recruitment_write_allowed()` = tryb RECRUITMENT albo wyjątek seedu (superuser, 0171).
  if public.recruitment_write_allowed() then return new; end if;
  raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
end $$;
revoke all on function public.enforce_recruitment_message_template() from public, anon, authenticated;

-- `trg_aa_*`: BEFORE-triggery tabeli idą alfabetycznie — strażnik trybu pierwszy (jak 0171/0174).
drop trigger if exists trg_aa_recruitment_mode on public.company_message_templates;
create trigger trg_aa_recruitment_mode before insert on public.company_message_templates
  for each row execute function public.enforce_recruitment_message_template();
drop trigger if exists trg_aa_recruitment_mode on public.company_message_template_variants;
create trigger trg_aa_recruitment_mode before insert on public.company_message_template_variants
  for each row execute function public.enforce_recruitment_message_template();
