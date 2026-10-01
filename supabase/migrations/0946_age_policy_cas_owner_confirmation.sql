-- =============================================================================
-- 0946_age_policy_cas_owner_confirmation.sql — #1102 (ADM-04) i #639: próg wieku kandydatów.
-- (numer tymczasowy — ostateczny nada integrator)
--
-- 1. Atomowa kontrola wersji (CAS, #1102). `admin_set_candidate_min_age` przyjmuje
--    `p_expected_updated_at` — znacznik `age_policy.updated_at` widziany przez administratora
--    w formularzu — i porównuje go z bieżącym po `FOR UPDATE`. Inny znacznik (drugi
--    administrator zapisał próg w międzyczasie, właściciel zatwierdził próg) = `STALE_STATE`
--    bez żadnej zmiany. Wcześniej akcja porównywała znacznik osobnym odczytem przed RPC
--    (okno wyścigu), a wartość daty z drivera nie była tekstem, więc porównanie zawsze
--    przechodziło.
--
-- 2. Status „zatwierdzone przez właściciela” nie pochodzi z formularza (#639). Parametr
--    `p_confirmed` znika: każda zmiana progu przez administratora zapisuje `confirmed = false`
--    (wartość robocza). Zatwierdzić bieżący próg może wyłącznie właściciel osobną drogą
--    operatorską — `owner_confirm_candidate_min_age` (EXECUTE tylko service_role, skrypt
--    `scripts/db/confirm-age-policy.mjs` z loginem migratora): CAS po znaczniku i progu,
--    notatka wymagana, audyt `age_policy.owner_confirmed` (wykonujący zmianę i zatwierdzający
--    są w dzienniku osobnymi wpisami). Zatwierdzenie podbija `updated_at`, więc formularz
--    otwarty przed nim jest nieaktualny.
--
-- Stan istniejący bez zmian (próg 16 zatwierdzony decyzją właściciela 25.09.2026, #576).
-- Rollback: supabase/rollback/0946_age_policy_cas_owner_confirmation.down.sql
-- (test: supabase/tests/age-policy-cas-rollback.sql w scripts/test-rls.sh).
-- =============================================================================

drop function if exists public.admin_set_candidate_min_age(integer, boolean, text);

create or replace function public.admin_set_candidate_min_age(
  p_min_age             integer,
  p_reason              text,
  p_expected_updated_at timestamptz
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before public.age_policy;
  v_found  boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hidden integer := 0;
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_min_age is null or p_min_age not in (16, 18)
     or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  select * into v_before from public.age_policy where id for update;
  v_found := found;
  -- CAS (#1102): znacznik widziany przez administratora = bieżący (brak wiersza = brak znacznika).
  if (v_found and v_before.updated_at is distinct from p_expected_updated_at)
     or (not v_found and p_expected_updated_at is not null) then
    raise exception 'STALE_STATE' using errcode = 'P0001';
  end if;

  -- #639: zmiana administratora = wartość robocza; zatwierdza tylko właściciel (osobna funkcja).
  if v_found then
    update public.age_policy
       set candidate_min_age = p_min_age, confirmed = false, reason = v_reason,
           updated_at = clock_timestamp(), updated_by = auth.uid()
     where id;
  else
    insert into public.age_policy (id, candidate_min_age, confirmed, reason, updated_by)
    values (true, p_min_age, false, v_reason, auth.uid());
  end if;

  -- Wyższy próg: profile z niższą deklaracją znikają z wyszukiwania od razu (jak w 0126).
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
    jsonb_build_object('candidate_min_age', p_min_age, 'confirmed', false,
                       'reason', v_reason, 'hidden_profiles', v_hidden));
  return v_hidden;
end $$;
revoke all on function public.admin_set_candidate_min_age(integer, text, timestamptz) from public, anon;
grant execute on function public.admin_set_candidate_min_age(integer, text, timestamptz) to authenticated;

-- Zatwierdzenie bieżącego progu przez właściciela (#639) — tylko droga operatorska.
create or replace function public.owner_confirm_candidate_min_age(
  p_expected_min_age    integer,
  p_expected_updated_at timestamptz,
  p_note                text
) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before public.age_policy;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_at     timestamptz := clock_timestamp();
begin
  if p_expected_min_age is null or p_expected_min_age not in (16, 18) or p_expected_updated_at is null
     or v_note is null or char_length(v_note) > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;
  select * into v_before from public.age_policy where id for update;
  if not found or v_before.updated_at is distinct from p_expected_updated_at
     or v_before.candidate_min_age is distinct from p_expected_min_age::smallint then
    raise exception 'STALE_STATE' using errcode = 'P0001';
  end if;
  if v_before.confirmed then
    return v_before.updated_at;  -- już zatwierdzone: bez zmiany i bez drugiego wpisu
  end if;

  update public.age_policy set confirmed = true, updated_at = v_at where id;
  perform public.write_audit('age_policy.owner_confirmed', 'age_policy', null,
    jsonb_build_object('candidate_min_age', v_before.candidate_min_age, 'confirmed', false,
                       'changed_by', v_before.updated_by),
    jsonb_build_object('candidate_min_age', v_before.candidate_min_age, 'confirmed', true,
                       'note', v_note, 'confirmed_via', 'owner_operator'));
  return v_at;
end $$;
revoke all on function public.owner_confirm_candidate_min_age(integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.owner_confirm_candidate_min_age(integer, timestamptz, text) to service_role;
