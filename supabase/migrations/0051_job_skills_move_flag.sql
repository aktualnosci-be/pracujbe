-- =============================================================================
-- 0051_job_skills_move_flag.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P1-08: zmiana zakresu umiejętności
-- (mandatory ↔ optional) mogła ją usunąć lub zablokować.
--
-- Problem: unikat job_skills (job_id, skill_label) IGNORUJE flagę is_mandatory, a replace per
-- zakres kasował tylko wiersze bieżącej flagi i wstawiał z `on conflict do nothing`. Przy
-- przeniesieniu etykiety między zakresami stary wiersz (w drugiej fladze) blokował insert
-- (DO NOTHING), więc etykieta utykała w starym zakresie albo znikała po zapisie drugiego kroku.
--
-- Naprawa: przed wstawieniem usuwamy CAŁY bieżący zakres tej flagi ORAZ każdy wiersz o tej samej
-- etykiecie w DRUGIM zakresie — dzięki temu etykieta realnie przechodzi mandatory↔optional bez
-- konfliktu. Sygnatura bez zmian (kreator woła tak samo per krok 6/7). is_job_manager (recruiter+)
-- bez zmian.
-- =============================================================================

create or replace function public.set_job_skills(
  p_job_id uuid, p_mandatory boolean, p_labels text[]
) returns void language plpgsql security definer set search_path = public as $$
declare v_labels text[];
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis umiejętności wymaga roli recruiter+' using errcode = '42501';
  end if;

  -- Znormalizowana, zdeduplikowana lista etykiet tego zakresu (max 50).
  select coalesce(array_agg(label), '{}'::text[]) into v_labels
    from (
      select distinct left(btrim(s), 120) as label
      from unnest(coalesce(p_labels, '{}'::text[])) s
      where btrim(s) <> '' limit 50
    ) q;

  -- P1-08: usuń bieżący zakres tej flagi ORAZ każdy wiersz o tej samej etykiecie w drugim
  -- zakresie (unikat ignoruje flagę — bez tego przeniesienie było blokowane przez ON CONFLICT).
  delete from public.job_skills
    where job_id = p_job_id
      and (is_mandatory = coalesce(p_mandatory, false) or skill_label = any(v_labels));

  insert into public.job_skills (job_id, skill_label, is_mandatory)
    select p_job_id, label, coalesce(p_mandatory, false) from unnest(v_labels) label
  on conflict (job_id, skill_label) do nothing; -- siatka bezpieczeństwa (współbieżność)
end $$;
revoke all on function public.set_job_skills(uuid, boolean, text[]) from public;
grant execute on function public.set_job_skills(uuid, boolean, text[]) to authenticated;
