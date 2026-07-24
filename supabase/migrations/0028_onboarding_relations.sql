-- =============================================================================
-- 0028_onboarding_relations.sql
-- Remediacja audytu 2026-07-24 — Wave E1: koniec cichej utraty danych onboardingu.
--
-- FUN-04 (P1) — onboarding walidował umiejętności (krok 3) oraz języki i certyfikaty
--   (krok 5), ale ICH NIE ZAPISYWAŁ (komentarz „TODO(data)"). Profil pozornie kończył
--   onboarding, a kluczowe dane kwalifikacyjne przepadały → matching i wyszukiwanie
--   kandydatów były niekompletne. Dodajemy transakcyjne RPC „replace-all" dla relacji
--   kandydata (candidate_skills/languages/certificates) i wpinamy je w kroki 3/5.
--
-- Granica zaufania (spójnie z 0025): odbieramy bezpośredni DML na tych relacjach od
-- anon/authenticated — mutacje wyłącznie przez RPC (SELECT pod RLS zostaje).
-- =============================================================================

-- Pomocniczo: id profilu kandydata dla bieżącego usera (tworzy wiersz, jeśli brak).
create or replace function public.ensure_candidate_profile()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cp uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  insert into public.candidate_profiles(profile_id) values (auth.uid())
    on conflict (profile_id) do nothing;
  select id into v_cp from public.candidate_profiles where profile_id = auth.uid();
  return v_cp;
end $$;
revoke all on function public.ensure_candidate_profile() from public;
-- helper wewnętrzny — wołany tylko z innych funkcji definer; brak grantu dla klienta.

-- --- FUN-04: umiejętności (krok 3) --------------------------------------------
create or replace function public.set_candidate_skills(p_skills text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  delete from public.candidate_skills where candidate_profile_id = v_cp;
  insert into public.candidate_skills (candidate_profile_id, skill_label)
    select v_cp, label from (
      select distinct left(btrim(s), 120) as label
      from unnest(coalesce(p_skills, '{}')::text[]) s
      where btrim(s) <> ''
      limit 100
    ) q
  on conflict (candidate_profile_id, skill_label) do nothing;
end $$;
revoke all on function public.set_candidate_skills(text[]) from public;
grant execute on function public.set_candidate_skills(text[]) to authenticated;

-- --- FUN-04: języki z poziomem (krok 5) --------------------------------------
create or replace function public.set_candidate_languages(p_languages jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  delete from public.candidate_languages where candidate_profile_id = v_cp;
  insert into public.candidate_languages (candidate_profile_id, language_label, level)
    select v_cp, label, lvl from (
      select distinct on (lower(left(btrim(e->>'language'), 80)))
             left(btrim(e->>'language'), 80) as label,
             (e->>'level')::public.language_level as lvl
      from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb)) e
      where btrim(coalesce(e->>'language', '')) <> ''
      limit 30
    ) q
  on conflict (candidate_profile_id, language_label) do nothing;
end $$;
revoke all on function public.set_candidate_languages(jsonb) from public;
grant execute on function public.set_candidate_languages(jsonb) to authenticated;

-- --- FUN-04: certyfikaty (krok 5) --------------------------------------------
create or replace function public.set_candidate_certificates(p_certificates text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  delete from public.candidate_certificates where candidate_profile_id = v_cp;
  insert into public.candidate_certificates (candidate_profile_id, certificate_label)
    select v_cp, label from (
      select distinct left(btrim(s), 160) as label
      from unnest(coalesce(p_certificates, '{}')::text[]) s
      where btrim(s) <> ''
      limit 60
    ) q
  on conflict (candidate_profile_id, certificate_label) do nothing;
end $$;
revoke all on function public.set_candidate_certificates(text[]) from public;
grant execute on function public.set_candidate_certificates(text[]) to authenticated;

-- --- Granica zaufania: relacje kandydata mutowane tylko przez RPC --------------
revoke insert, update, delete on public.candidate_skills       from anon, authenticated;
revoke insert, update, delete on public.candidate_languages    from anon, authenticated;
revoke insert, update, delete on public.candidate_certificates from anon, authenticated;
