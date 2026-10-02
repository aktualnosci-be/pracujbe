-- =============================================================================
-- Rollback 0209_age_policy_cas_owner_confirmation.sql (#1102, #639) — ręczny, NIE jest migracją.
-- Usuwa `owner_confirm_candidate_min_age` i nową sygnaturę `admin_set_candidate_min_age`
-- (CAS, bez `p_confirmed`); przywraca definicję z 0126 (status zatwierdzenia z parametru).
-- Dane `age_policy` bez zmian. Test: supabase/tests/age-policy-cas-rollback.sql.
-- =============================================================================

drop function if exists public.owner_confirm_candidate_min_age(integer, timestamptz, text);
drop function if exists public.admin_set_candidate_min_age(integer, text, timestamptz);

create or replace function public.admin_set_candidate_min_age(
  p_min_age   integer,
  p_confirmed boolean,
  p_reason    text
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before public.age_policy;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hidden integer := 0;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_min_age is null or p_min_age not in (16, 18) or p_confirmed is null
     or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  select * into v_before from public.age_policy where id for update;
  update public.age_policy
     set candidate_min_age = p_min_age, confirmed = p_confirmed, reason = v_reason,
         updated_at = now(), updated_by = auth.uid()
   where id;
  if not found then
    insert into public.age_policy (id, candidate_min_age, confirmed, reason, updated_by)
    values (true, p_min_age, p_confirmed, v_reason, auth.uid());
  end if;

  -- Wyższy próg: profile z niższą deklaracją znikają z wyszukiwania od razu (0100).
  with hidden as (
    update public.candidate_profiles cp
       set is_searchable = false, searchable_changed_at = now()
     where cp.is_searchable
       and not (public.candidate_meets_age_policy(cp.profile_id) and public.candidate_is_adult(cp.profile_id))
    returning cp.profile_id
  ), events as (
    insert into public.candidate_visibility_events (candidate_id, searchable)
    select profile_id, false from hidden
    returning 1
  )
  select count(*) into v_hidden from events;

  perform public.write_audit('age_policy.updated', 'age_policy', null,
    jsonb_build_object('candidate_min_age', v_before.candidate_min_age, 'confirmed', v_before.confirmed),
    jsonb_build_object('candidate_min_age', p_min_age, 'confirmed', p_confirmed,
                       'reason', v_reason, 'hidden_profiles', v_hidden));
  return v_hidden;
end $$;
revoke all on function public.admin_set_candidate_min_age(integer, boolean, text) from public, anon;
grant execute on function public.admin_set_candidate_min_age(integer, boolean, text) to authenticated;
