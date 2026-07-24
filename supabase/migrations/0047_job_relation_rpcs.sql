-- =============================================================================
-- 0047_job_relation_rpcs.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-09 (atomowość relacji kreatora oferty).
--
-- Kreator zastępował relacje oferty (wymagania/umiejętności/języki/certyfikaty) klienckim
-- DELETE, a potem INSERT — DWA osobne żądania, NIE w transakcji. Awaria drugiego zapisu
-- OPRÓŻNIAŁA relację (utrata danych). Wprowadzamy transakcyjne RPC replace-all (DELETE+INSERT
-- w JEDNYM ciele funkcji = atomowo), gejtowane recruiter+ (is_job_manager). Kreator woła te RPC.
--
-- Uwaga: bezpośredni zapis do tabel dzieci pozostaje możliwy pod RLS (recruiter+, 0033) —
-- to ścieżka używana m.in. w testach; kreator korzysta z atomowych RPC.
-- =============================================================================

-- --- Wymagania (per kind+locale) ------------------------------------------------
create or replace function public.set_job_requirements(
  p_job_id uuid, p_locale text, p_kind text, p_lines text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis wymagań wymaga roli recruiter+' using errcode = '42501';
  end if;
  if p_locale not in ('pl','nl','fr','en') then
    raise exception 'VALIDATION_FAILED: locale' using errcode = '42501';
  end if;
  delete from public.job_requirements
    where job_id = p_job_id and kind = p_kind::public.requirement_kind and locale = p_locale;
  insert into public.job_requirements (job_id, locale, kind, position, content)
    select p_job_id, p_locale, p_kind::public.requirement_kind, (ord - 1)::int, left(btrim(content), 500)
    from unnest(coalesce(p_lines, '{}'::text[])) with ordinality as u(content, ord)
    where btrim(content) <> ''
    limit 50;
end $$;
revoke all on function public.set_job_requirements(uuid, text, text, text[]) from public;
grant execute on function public.set_job_requirements(uuid, text, text, text[]) to authenticated;

-- --- Umiejętności (per zakres mandatory/optional) -------------------------------
create or replace function public.set_job_skills(
  p_job_id uuid, p_mandatory boolean, p_labels text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis umiejętności wymaga roli recruiter+' using errcode = '42501';
  end if;
  delete from public.job_skills where job_id = p_job_id and is_mandatory = coalesce(p_mandatory, false);
  insert into public.job_skills (job_id, skill_label, is_mandatory)
    select p_job_id, label, coalesce(p_mandatory, false) from (
      select distinct left(btrim(s), 120) as label
      from unnest(coalesce(p_labels, '{}'::text[])) s
      where btrim(s) <> '' limit 50
    ) q
  on conflict (job_id, skill_label) do nothing; -- etykieta w drugim zakresie pozostaje
end $$;
revoke all on function public.set_job_skills(uuid, boolean, text[]) from public;
grant execute on function public.set_job_skills(uuid, boolean, text[]) to authenticated;

-- --- Języki wymagane ------------------------------------------------------------
create or replace function public.set_job_languages(
  p_job_id uuid, p_languages jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis języków wymaga roli recruiter+' using errcode = '42501';
  end if;
  delete from public.job_languages where job_id = p_job_id;
  insert into public.job_languages (job_id, language_label, level)
    select p_job_id, label, lvl from (
      select distinct on (lower(left(btrim(e->>'language'), 80)))
             left(btrim(e->>'language'), 80) as label,
             (e->>'level')::public.language_level as lvl
      from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb)) e
      where btrim(coalesce(e->>'language', '')) <> '' limit 30
    ) q
  on conflict (job_id, language_label) do nothing;
end $$;
revoke all on function public.set_job_languages(uuid, jsonb) from public;
grant execute on function public.set_job_languages(uuid, jsonb) to authenticated;

-- --- Certyfikaty wymagane -------------------------------------------------------
create or replace function public.set_job_certificates(
  p_job_id uuid, p_labels text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: zapis certyfikatów wymaga roli recruiter+' using errcode = '42501';
  end if;
  delete from public.job_certificates where job_id = p_job_id;
  insert into public.job_certificates (job_id, certificate_label)
    select p_job_id, label from (
      select distinct left(btrim(s), 160) as label
      from unnest(coalesce(p_labels, '{}'::text[])) s
      where btrim(s) <> '' limit 60
    ) q
  on conflict (job_id, certificate_label) do nothing;
end $$;
revoke all on function public.set_job_certificates(uuid, text[]) from public;
grant execute on function public.set_job_certificates(uuid, text[]) to authenticated;
