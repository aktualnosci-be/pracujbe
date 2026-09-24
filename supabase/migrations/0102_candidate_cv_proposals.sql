-- =============================================================================
-- 0102 — import CV przez AI: zapis WYŁĄCZNIE zatwierdzonych propozycji (#487, #498).
--
-- Numer tymczasowy (koordynator może go zmienić przy scalaniu); runner wymaga ciągłego zakresu.
--
-- Import CV (src/lib/cv-import) nie zapisuje niczego sam: model zwraca propozycje, które
-- kandydat przegląda i zatwierdza pojedynczo. Dopiero zatwierdzone pozycje wysyła akcja
-- `applyCvProposals` do tej funkcji:
--
--   apply_candidate_cv_proposals(p_occupations text[], p_skills text[], p_languages jsonb,
--                                p_certificates text[], p_experience_years integer) → jsonb
--
-- Semantyka: DOPISANIE do profilu (nie replace-all jak w kreatorze onboardingu). Istniejące
-- pozycje zostają bez zmian — także poziom języka już wpisanego ręcznie i data ważności
-- certyfikatu; duplikaty wykrywane bez względu na wielkość liter. Doświadczenie ustawiane
-- tylko, gdy kandydat je zatwierdził (NULL = bez zmian).
--
-- Jedno wywołanie = jedna transakcja; wiersz profilu blokowany FOR UPDATE, więc równoległy
-- zapis kroku onboardingu nie gubi zmian (brak read-modify-write w aplikacji). Limity jak
-- w schematach kreatora (CANDIDATE_ITEM_LIMITS i step2/3/5Schema): za długa pozycja albo
-- przekroczenie liczby pozycji → VALIDATION_FAILED (bez cichego obcinania). Pusta lista
-- wszystkiego → VALIDATION_FAILED (brak zatwierdzenia = brak zapisu).
--
-- Autoryzacja: ensure_candidate_profile() (zalogowany + rola kandydata). Tylko własny profil
-- (brak parametru właściciela). EXECUTE tylko authenticated.
--
-- Nowych tabel nie ma: CV ani jego tekst nie są przechowywane (pamięć żądania).
--
-- Rollback: `drop function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer);`
-- Dane bez zmian.
-- =============================================================================

create function public.apply_candidate_cv_proposals(
  p_occupations text[],
  p_skills text[],
  p_languages jsonb,
  p_certificates text[],
  p_experience_years integer
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cp uuid := public.ensure_candidate_profile();
  v_occupations text[];
  v_new text[];
  v_added_occ integer := 0;
  v_added_skills integer := 0;
  v_added_lang integer := 0;
  v_added_cert integer := 0;
  v_item text;
  v_lang jsonb;
begin
  if p_languages is not null and jsonb_typeof(p_languages) <> 'array' then
    raise exception 'VALIDATION_FAILED: languages must be an array' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_occupations), 0) = 0
     and coalesce(cardinality(p_skills), 0) = 0
     and coalesce(jsonb_array_length(p_languages), 0) = 0
     and coalesce(cardinality(p_certificates), 0) = 0
     and p_experience_years is null then
    raise exception 'VALIDATION_FAILED: nothing approved' using errcode = '22023';
  end if;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 60) then
    raise exception 'VALIDATION_FAILED: experience_years' using errcode = '22023';
  end if;

  -- Długości pozycji (bez obcinania — zgodnie z CANDIDATE_ITEM_LIMITS / candidateLanguageSchema).
  foreach v_item in array coalesce(p_occupations, '{}') loop
    if v_item is null or btrim(v_item) = '' or char_length(btrim(v_item)) > 80 then
      raise exception 'VALIDATION_FAILED: occupation' using errcode = '22023';
    end if;
  end loop;
  foreach v_item in array coalesce(p_skills, '{}') loop
    if v_item is null or btrim(v_item) = '' or char_length(btrim(v_item)) > 120 then
      raise exception 'VALIDATION_FAILED: skill' using errcode = '22023';
    end if;
  end loop;
  foreach v_item in array coalesce(p_certificates, '{}') loop
    if v_item is null or btrim(v_item) = '' or char_length(btrim(v_item)) > 160 then
      raise exception 'VALIDATION_FAILED: certificate' using errcode = '22023';
    end if;
  end loop;
  for v_lang in select * from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb)) loop
    if jsonb_typeof(v_lang) <> 'object'
       or char_length(btrim(coalesce(v_lang ->> 'language', ''))) not between 2 and 40
       or coalesce(v_lang ->> 'level', '') not in ('basic', 'intermediate', 'fluent', 'native') then
      raise exception 'VALIDATION_FAILED: language' using errcode = '22023';
    end if;
  end loop;

  -- Blokada profilu: równoległy zapis kroku onboardingu czeka, zamiast nadpisać wynik.
  select occupations into v_occupations from public.candidate_profiles where id = v_cp for update;

  -- Zawody (candidate_profiles.occupations, limit 10 jak step2Schema).
  select coalesce(array_agg(o order by ord), '{}') into v_new from (
    select distinct on (lower(btrim(o))) btrim(o) as o, ord
    from unnest(coalesce(p_occupations, '{}')) with ordinality as t(o, ord)
    where not exists (select 1 from unnest(v_occupations) e where lower(btrim(e)) = lower(btrim(o)))
    order by lower(btrim(o)), ord
  ) q;
  v_added_occ := cardinality(v_new);
  if cardinality(v_occupations) + v_added_occ > 10 then
    raise exception 'VALIDATION_FAILED: occupations too many' using errcode = '22023';
  end if;
  if v_added_occ > 0 then
    update public.candidate_profiles set occupations = v_occupations || v_new where id = v_cp;
  end if;

  -- Umiejętności (limit 50 jak step3Schema).
  with incoming as (
    select distinct on (lower(btrim(s))) btrim(s) as label
    from unnest(coalesce(p_skills, '{}')) s
    order by lower(btrim(s))
  ), ins as (
    insert into public.candidate_skills (candidate_profile_id, skill_label)
    select v_cp, i.label from incoming i
    where not exists (select 1 from public.candidate_skills c
                      where c.candidate_profile_id = v_cp and lower(c.skill_label) = lower(i.label))
    on conflict (candidate_profile_id, skill_label) do nothing
    returning 1
  ) select count(*) into v_added_skills from ins;
  if (select count(*) from public.candidate_skills where candidate_profile_id = v_cp) > 50 then
    raise exception 'VALIDATION_FAILED: skills too many' using errcode = '22023';
  end if;

  -- Języki (limit 15 jak step5Schema); poziom już wpisanego języka bez zmian.
  with incoming as (
    select distinct on (lower(btrim(e ->> 'language')))
           btrim(e ->> 'language') as label, (e ->> 'level')::public.language_level as lvl
    from jsonb_array_elements(coalesce(p_languages, '[]'::jsonb)) e
    order by lower(btrim(e ->> 'language'))
  ), ins as (
    insert into public.candidate_languages (candidate_profile_id, language_label, level)
    select v_cp, i.label, i.lvl from incoming i
    where not exists (select 1 from public.candidate_languages c
                      where c.candidate_profile_id = v_cp and lower(c.language_label) = lower(i.label))
    on conflict (candidate_profile_id, language_label) do nothing
    returning 1
  ) select count(*) into v_added_lang from ins;
  if (select count(*) from public.candidate_languages where candidate_profile_id = v_cp) > 15 then
    raise exception 'VALIDATION_FAILED: languages too many' using errcode = '22023';
  end if;

  -- Certyfikaty (limit 30 jak step5Schema), bez daty ważności — kandydat dopisuje ją w kroku 5.
  with incoming as (
    select distinct on (lower(btrim(s))) btrim(s) as label
    from unnest(coalesce(p_certificates, '{}')) s
    order by lower(btrim(s))
  ), ins as (
    insert into public.candidate_certificates (candidate_profile_id, certificate_label)
    select v_cp, i.label from incoming i
    where not exists (select 1 from public.candidate_certificates c
                      where c.candidate_profile_id = v_cp and lower(c.certificate_label) = lower(i.label))
    on conflict (candidate_profile_id, certificate_label) do nothing
    returning 1
  ) select count(*) into v_added_cert from ins;
  if (select count(*) from public.candidate_certificates where candidate_profile_id = v_cp) > 30 then
    raise exception 'VALIDATION_FAILED: certificates too many' using errcode = '22023';
  end if;

  if p_experience_years is not null then
    update public.candidate_profiles set experience_years = p_experience_years where id = v_cp;
  end if;

  return jsonb_build_object(
    'occupations', v_added_occ,
    'skills', v_added_skills,
    'languages', v_added_lang,
    'certificates', v_added_cert,
    'experienceYears', p_experience_years is not null
  );
end $$;
revoke all on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) from public, anon;
grant execute on function public.apply_candidate_cv_proposals(text[], text[], jsonb, text[], integer) to authenticated;
