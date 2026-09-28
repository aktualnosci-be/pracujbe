-- =============================================================================
-- 0173 — tryb ogłoszeniowy: bez wyszukiwalnej
-- bazy profili i bez pytań screeningowych (#1135, #1137; epik #1128).
--
-- Decyzja produktowa: portal ogłoszeniowy. Buduje na 0171 (`recruitment_enabled()`,
-- `recruitment_write_allowed()`, polityki RESTRICTIVE na `candidate_profiles` i relacjach
-- kandydata, `candidate_profile_is_searchable` = false, strażnik INSERT na
-- `application_screening_answers`, który blokuje `record_screening_answers`). Tu tylko to,
-- czego 0171 nie robi:
--
-- #1135 — widoczność profilu dla firm (#494):
--   1. `set_candidate_searchable(true)` → `RECRUITMENT_DISABLED` (także gdy profil już jest
--      oznaczony jako wyszukiwalny); `false` działa dalej. Treść z 0100 + warunek trybu.
--   2. Strażnik `trg_aa_recruitment_mode_searchable` (BEFORE INSERT OR UPDATE OF is_searchable
--      na `candidate_profiles`, pierwszy alfabetycznie): `is_searchable = true` nową ścieżką
--      (INSERT albo zmiana false → true) odrzucone każdą rolą, także service_role; wyjątek
--      seedu superusera jak w 0171 (`recruitment_write_allowed()`).
--   3. `company_can_see_match_candidate` (0100) + warunek trybu (polityka `matches_select`;
--      0171 zamyka `matches` także polityką RESTRICTIVE — tu druga linia).
--   Bez jednorazowego zerowania `is_searchable` (brak danych produkcyjnych, #1150): odczyt
--   firm zamyka 0171, a nowe włączenia blokuje ta migracja.
--
-- #1137 — pytania screeningowe (#101, #497):
--   4. `set_job_screening_questions` (0093) + warunek trybu: niepusta lista → `RECRUITMENT_DISABLED`;
--      pusta lista działa (usuwa pytania szkicu).
--   5. Strażnik `trg_aa_recruitment_mode` (BEFORE INSERT na `job_screening_questions`): w trybie
--      ogłoszeniowym wiersz jest POMIJANY (RETURN NULL), nie błąd — `duplicate_job_as_draft`
--      (0148) kopiuje ofertę bez pytań zamiast się wywracać; każda inna ścieżka też nie wstawi
--      pytania. Wyjątek seedu superusera jak w 0171.
--   6. `get_public_job_screening_questions` (0154) + warunek trybu: pusty wynik.
--   7. `enforce_screening_review` (0154) + warunek trybu: w trybie ogłoszeniowym nie blokuje
--      aktywacji oferty (pytania sprzed trybu są niewidoczne i nie zbierają odpowiedzi).
--   8. Strażnik BEFORE UPDATE na `screening_question_reviews`: zmiana statusu przeglądu
--      (`admin_decide_screening_review`) → `RECRUITMENT_DISABLED` w trybie ogłoszeniowym.
--   Pytania i przeglądy zapisane przed trybem zostają (bez kasowania, decyzja właściciela).
--
-- Rollback: supabase/rollback/0173_classifieds_searchable_screening.down.sql (przed rollbackiem
-- 0171; test w supabase/tests/portal-legal-mode-rollback.sql).
-- =============================================================================

-- --- 1. set_candidate_searchable (0100 + tryb) ------------------------------------------------
create or replace function public.set_candidate_searchable(p_searchable boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target boolean := coalesce(p_searchable, false);
  v_completed boolean;
  v_current boolean;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  -- 0173 (#1135): portal ogłoszeniowy — firmy nie przeglądają profili; wyłączenie działa zawsze.
  if v_target and not public.recruitment_enabled() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
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

-- --- 2. Strażnik is_searchable ----------------------------------------------------------------
create or replace function public.enforce_recruitment_searchable()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_searchable
     and (tg_op = 'INSERT' or not coalesce(old.is_searchable, false))
     and not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_searchable() from public, anon, authenticated;
-- `trg_aa_*`: przed `trg_candidate_profiles_age_policy` i `trg_guard_candidate_completeness`
-- (kolejność alfabetyczna) — w trybie ogłoszeniowym kod błędu to zawsze RECRUITMENT_DISABLED.
drop trigger if exists trg_aa_recruitment_mode_searchable on public.candidate_profiles;
create trigger trg_aa_recruitment_mode_searchable
  before insert or update of is_searchable on public.candidate_profiles
  for each row execute function public.enforce_recruitment_searchable();

-- --- 3. company_can_see_match_candidate (0100 + tryb) -----------------------------------------
create or replace function public.company_can_see_match_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.recruitment_enabled() and ((
    exists (
      select 1 from public.candidate_profiles cp
      where cp.profile_id = p_candidate
        and cp.is_searchable = true
        and cp.profile_completed = true
        and cp.deleted_at is null
    )
    and public.current_user_has_verified_company()
    and not public.candidate_blocks_viewer(p_candidate)
  ) or public.company_can_view_candidate(p_candidate));
$$;
revoke all on function public.company_can_see_match_candidate(uuid) from public, anon;
grant execute on function public.company_can_see_match_candidate(uuid) to authenticated;

-- --- 4. set_job_screening_questions (0093 + tryb) ---------------------------------------------
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
  -- 0173 (#1137): portal ogłoszeniowy — bez pytań screeningowych; pusta lista czyści szkic.
  if jsonb_array_length(p_questions) > 0 and not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
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

-- --- 5. Strażnik tabeli pytań: wiersz pomijany w trybie ogłoszeniowym --------------------------
create or replace function public.skip_screening_question_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.recruitment_write_allowed() then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.skip_screening_question_insert() from public, anon, authenticated;
drop trigger if exists trg_aa_recruitment_mode on public.job_screening_questions;
create trigger trg_aa_recruitment_mode
  before insert on public.job_screening_questions
  for each row execute function public.skip_screening_question_insert();

-- --- 6. Pytania publicznej oferty (0154 + tryb) ------------------------------------------------
create or replace function public.get_public_job_screening_questions(p_job_id uuid)
returns table (id uuid, "position" smallint, type text, required boolean, prompt jsonb, options jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.position, q.type, q.required, q.prompt, q.options
    from public.job_screening_questions q
    where public.recruitment_enabled()
      and q.job_id = p_job_id and public.job_is_public(p_job_id)
      and not public.screening_content_rejected(q.job_id, q.content_fingerprint)
    order by q.position;
$$;
revoke all on function public.get_public_job_screening_questions(uuid) from public;
grant execute on function public.get_public_job_screening_questions(uuid) to anon, authenticated;

-- --- 7. Strażnik aktywacji (0154 + tryb) -------------------------------------------------------
create or replace function public.enforce_screening_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_position smallint; v_status text;
begin
  -- 0173 (#1137): w trybie ogłoszeniowym pytania są niewidoczne — nie blokują publikacji.
  if not public.recruitment_enabled() then
    return new;
  end if;
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

-- --- 8. Decyzja przeglądu pytań tylko w trybie rekrutacyjnym -----------------------------------
create or replace function public.enforce_recruitment_screening_review_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and not public.recruitment_write_allowed() then
    raise exception 'RECRUITMENT_DISABLED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_recruitment_screening_review_update() from public, anon, authenticated;
drop trigger if exists trg_aa_recruitment_mode_update on public.screening_question_reviews;
create trigger trg_aa_recruitment_mode_update
  before update on public.screening_question_reviews
  for each row execute function public.enforce_recruitment_screening_review_update();
