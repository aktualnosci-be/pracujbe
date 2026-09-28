-- =============================================================================
-- Rollback 0980 (numer tymczasowy) — tryb ogłoszeniowy: widoczność profili i pytania
-- screeningowe (#1135, #1137). Uruchamiać ręcznie jako migrator, w jednej transakcji
-- (psql -1 -f …), PRZED rollbackiem 0171, i dopiero wtedy usunąć wpis z app_migrations.history.
-- Plik celowo BEZ BEGIN/COMMIT (supabase/tests/portal-legal-mode-rollback.sql wykonuje go
-- w transakcji i cofa). Przywraca treść funkcji 1:1 z 0100/0093/0154 i usuwa strażniki.
-- =============================================================================

drop trigger if exists trg_aa_recruitment_mode_searchable on public.candidate_profiles;
drop trigger if exists trg_aa_recruitment_mode on public.job_screening_questions;
drop trigger if exists trg_aa_recruitment_mode_update on public.screening_question_reviews;
drop function if exists public.enforce_recruitment_searchable();
drop function if exists public.skip_screening_question_insert();
drop function if exists public.enforce_recruitment_screening_review_update();

-- 0100 (#494)
create or replace function public.set_candidate_searchable(p_searchable boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target boolean := coalesce(p_searchable, false);
  v_completed boolean;
  v_current boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  perform public.ensure_candidate_profile();

  select profile_completed, is_searchable into v_completed, v_current
    from public.candidate_profiles where profile_id = auth.uid()
    for update;

  if v_target and not coalesce(v_completed, false) then
    raise exception 'VALIDATION_FAILED: profil musi być kompletny, aby był wyszukiwalny'
      using errcode = '42501';
  end if;

  if v_current is distinct from v_target then
    update public.candidate_profiles
      set is_searchable = v_target, searchable_changed_at = now()
      where profile_id = auth.uid();
    insert into public.candidate_visibility_events (candidate_id, searchable)
      values (auth.uid(), v_target);
  end if;
  return v_target;
end $$;
revoke all on function public.set_candidate_searchable(boolean) from public, anon;
grant execute on function public.set_candidate_searchable(boolean) to authenticated;

-- 0100 (#494)
create or replace function public.company_can_see_match_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (
    exists (
      select 1 from public.candidate_profiles cp
      where cp.profile_id = p_candidate
        and cp.is_searchable = true
        and cp.profile_completed = true
        and cp.deleted_at is null
    )
    and public.current_user_has_verified_company()
    and not public.candidate_blocks_viewer(p_candidate)
  ) or public.company_can_view_candidate(p_candidate);
$$;
revoke all on function public.company_can_see_match_candidate(uuid) from public, anon;
grant execute on function public.company_can_see_match_candidate(uuid) to authenticated;

-- 0093 (#101)
create or replace function public.set_job_screening_questions(p_job_id uuid, p_questions jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text; v_locale text; v_type text; v_opts jsonb; v_bad text;
  q jsonb; q_ord bigint; o jsonb; o_ord bigint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select status::text, default_locale into v_status, v_locale
    from public.jobs where id = p_job_id and deleted_at is null
    for update;
  if v_status is null then raise exception 'NOT_FOUND: oferta nie istnieje' using errcode = 'P0002'; end if;
  if not public.is_job_manager(p_job_id) then
    raise exception 'PERMISSION_DENIED: pytania ustala recruiter+' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT: pytania zmienia się wyłącznie w szkicu oferty' using errcode = '42501';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 10 then
    raise exception 'VALIDATION_FAILED: lista pytań (maks. 10)' using errcode = '42501';
  end if;

  delete from public.job_screening_questions where job_id = p_job_id;

  for q, q_ord in select value, ordinality from jsonb_array_elements(p_questions) with ordinality loop
    if jsonb_typeof(q) <> 'object' then
      raise exception 'VALIDATION_FAILED: pytanie' using errcode = '42501';
    end if;
    select k into v_bad from jsonb_object_keys(q) k where k not in ('type', 'required', 'prompt', 'options') limit 1;
    if v_bad is not null then
      raise exception 'VALIDATION_FAILED: nieznane pole pytania %', v_bad using errcode = '42501';
    end if;
    v_type := q->>'type';
    if v_type is null or v_type not in ('yes_no', 'single_choice', 'date', 'short_text') then
      raise exception 'VALIDATION_FAILED: typ pytania' using errcode = '42501';
    end if;
    if q ? 'required' and jsonb_typeof(q->'required') <> 'boolean' then
      raise exception 'VALIDATION_FAILED: pole required' using errcode = '42501';
    end if;

    v_opts := '[]'::jsonb;
    if v_type = 'single_choice' then
      if jsonb_typeof(q->'options') is distinct from 'array'
         or jsonb_array_length(q->'options') not between 2 and 10 then
        raise exception 'VALIDATION_FAILED: pytanie wyboru wymaga 2–10 opcji' using errcode = '42501';
      end if;
      for o, o_ord in select value, ordinality from jsonb_array_elements(q->'options') with ordinality loop
        if jsonb_typeof(o) <> 'object' or exists (select 1 from jsonb_object_keys(o) k where k <> 'label') then
          raise exception 'VALIDATION_FAILED: opcja pytania' using errcode = '42501';
        end if;
        v_opts := v_opts || jsonb_build_array(jsonb_build_object(
          'id', 'o' || o_ord, 'label', public.screening_text_map(o->'label', v_locale, 120)));
      end loop;
    elsif q ? 'options' and q->'options' <> '[]'::jsonb then
      raise exception 'VALIDATION_FAILED: opcje tylko dla pytania wyboru' using errcode = '42501';
    end if;

    insert into public.job_screening_questions (job_id, position, type, required, prompt, options)
      values (p_job_id, (q_ord - 1)::smallint, v_type, coalesce((q->>'required')::boolean, false),
              public.screening_text_map(q->'prompt', v_locale, 300), v_opts);
  end loop;
end $$;
revoke all on function public.set_job_screening_questions(uuid, jsonb) from public, anon;
grant execute on function public.set_job_screening_questions(uuid, jsonb) to authenticated;

-- 0154 (#497)
create or replace function public.get_public_job_screening_questions(p_job_id uuid)
returns table (id uuid, "position" smallint, type text, required boolean, prompt jsonb, options jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.position, q.type, q.required, q.prompt, q.options
    from public.job_screening_questions q
    where q.job_id = p_job_id and public.job_is_public(p_job_id)
      and not public.screening_content_rejected(q.job_id, q.content_fingerprint)
    order by q.position;
$$;
revoke all on function public.get_public_job_screening_questions(uuid) from public;
grant execute on function public.get_public_job_screening_questions(uuid) to anon, authenticated;

-- 0154 (#497)
create or replace function public.enforce_screening_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_position smallint; v_status text;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    select q.position, coalesce(r.status, 'pending')
      into v_position, v_status
      from public.job_screening_questions q
      left join public.screening_question_reviews r
        on r.job_id = q.job_id and r.content_fingerprint = q.content_fingerprint
     where q.job_id = new.id
       and cardinality(q.risk_categories) > 0
       and coalesce(r.status, 'pending') <> 'approved'
       -- #497 (0154): poza szkicem odrzucone = ukryte, nie blokuje wznowienia/ponownego otwarcia.
       and not (r.status = 'rejected' and old.status is distinct from 'draft')
     order by (r.status = 'rejected') desc nulls last, q.position
     limit 1;
    if v_position is not null then
      if v_status = 'rejected' then
        raise exception 'SCREENING_QUESTION_REJECTED: %', v_position using errcode = '42501';
      end if;
      raise exception 'SCREENING_REVIEW_REQUIRED: %', v_position using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_screening_review() from public, anon, authenticated;
