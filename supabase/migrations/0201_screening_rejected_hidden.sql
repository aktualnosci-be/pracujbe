-- =============================================================================
-- 0201 — pytanie screeningowe odrzucone po publikacji oferty jest ukrywane (#497).
-- NUMER TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- Decyzja właściciela z 26.09.2026: gdy admin odrzuci pytanie oferty, która NIE jest już
-- szkicem (aktywna, wstrzymana, zamknięta, wygasła — np. pytanie zapisane przed 0103 i
-- przejrzane dopiero po publikacji), pytanie jest ukrywane od razu, a oferta zostaje aktywna.
-- „Ukryte” = istnieje przegląd `rejected` dla (oferta, bieżący odcisk treści). Szkic bez
-- zmian: odrzucone pytanie nadal blokuje publikację (0103), firma je poprawia.
--
-- 1. `screening_content_fingerprint(type, prompt, options)` — jedno źródło odcisku treści
--    (trigger 0103 liczy go tą funkcją; wartość identyczna jak dotąd, więc istniejące
--    przeglądy pasują dalej). `screening_answer_hidden(job, type, prompt, options)` — czy
--    snapshot pytania/odpowiedzi ma treść odrzuconą w tej ofercie; odpowiada wyłącznie
--    członkowi firmy oferty albo adminowi (inaczej false — nie ujawnia decyzji innym).
-- 2. `get_public_job_screening_questions` pomija ukryte pytania (ApplyModal i gość).
-- 3. `record_screening_answers` (apply_to_job, zgłoszenie i potwierdzenie gościa): odpowiedź
--    na ukryte pytanie jest po cichu pomijana — bez błędu dla kandydata i bez zapisu; ukryte
--    pytanie wymagane nie jest już wymagane. Klucz spoza pytań oferty nadal = VALIDATION_FAILED.
-- 4. Polityka `application_screening_answers_select`: kandydat widzi wszystkie swoje
--    odpowiedzi, firma (recruiter+) — bez odpowiedzi na treść odrzuconą. Wiersze zostają
--    w bazie (niezmienne) do decyzji o retencji (#486).
-- 5. Strażnik `enforce_screening_review`: przy publikacji szkicu odrzucone pytanie blokuje
--    jak dotąd; przy wznowieniu/ponownym otwarciu opublikowanej oferty ukryte pytanie nie
--    blokuje (wstrzymanie nie może zablokować oferty na zawsze — pytań poza szkicem nie
--    da się zmienić). Pytanie bez decyzji nadal blokuje każdą aktywację.
-- 6. `admin_decide_screening_review`: odrzucenie pytania oferty poza szkicem = ukrycie →
--    audyt `screening_question.hidden` na przeglądzie (bez treści: oferta, pozycja, status oferty, kategorie)
--    i powiadomienie in-app `system` (`data.kind='screening_review'`, `status='hidden'`)
--    dla KAŻDEGO aktywnego recruiter+ firmy oferty (`company_recipient_ok`); tytuł renderuje
--    aplikacja w języku odbiorcy z `src/messages`. Szkic — bez zmian (zgłaszający, `rejected`).
--
-- Rollback: odtworzyć z 0103 funkcje set_screening_question_risk, enforce_screening_review,
-- admin_decide_screening_review; z 0093 get_public_job_screening_questions i politykę
-- application_screening_answers_select; z 0095 record_screening_answers; drop function
-- screening_answer_hidden(uuid, text, jsonb, jsonb), screening_content_fingerprint(text, jsonb,
-- jsonb). Migracja nie zmienia treści pytań, odpowiedzi ani przeglądów.
-- =============================================================================

-- --- 1. Odcisk treści i test ukrycia --------------------------------------------------------
create or replace function public.screening_content_fingerprint(p_type text, p_prompt jsonb, p_options jsonb)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  select md5(jsonb_build_object('type', p_type, 'prompt', p_prompt, 'options', p_options)::text);
$$;
revoke all on function public.screening_content_fingerprint(text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.set_screening_question_risk()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.risk_categories := public.screening_question_risk(new.prompt, new.options);
  new.content_fingerprint := public.screening_content_fingerprint(new.type, new.prompt, new.options);
  return new;
end $$;
revoke all on function public.set_screening_question_risk() from public, anon, authenticated;

-- Wewnętrzny test bez bramki dostępu (wołany tylko z funkcji definer tej migracji).
create or replace function public.screening_content_rejected(p_job_id uuid, p_fingerprint text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.screening_question_reviews r
                  where r.job_id = p_job_id and r.content_fingerprint = p_fingerprint
                    and r.status = 'rejected');
$$;
revoke all on function public.screening_content_rejected(uuid, text) from public, anon, authenticated;

-- Używana w polityce RLS odpowiedzi (wywołuje ją rola klienta), więc EXECUTE dla authenticated;
-- poza firmą oferty i adminem zawsze false.
create or replace function public.screening_answer_hidden(p_job_id uuid, p_type text, p_prompt jsonb, p_options jsonb)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (public.is_job_company_member(p_job_id) or public.is_admin())
     and public.screening_content_rejected(p_job_id,
           public.screening_content_fingerprint(p_type, p_prompt, p_options));
$$;
revoke all on function public.screening_answer_hidden(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.screening_answer_hidden(uuid, text, jsonb, jsonb) to authenticated;

-- --- 2. Pytania publicznej oferty bez ukrytych ------------------------------------------------
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

-- --- 3. Odpowiedzi: ukryte pytanie pomijane po cichu (0095 + #497) ----------------------------
create or replace function public.record_screening_answers(p_application_id uuid, p_job_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; v_text text; v_date date; v_bad text;
  v_bool boolean; v_ans_date date; v_ans_text text;
begin
  if jsonb_typeof(a) <> 'object' then
    raise exception 'VALIDATION_FAILED: odpowiedzi' using errcode = '42501';
  end if;
  -- Nieznany = spoza pytań oferty. Klucz ukrytego pytania nie jest błędem (formularz sprzed
  -- ukrycia albo potwierdzenie zgłoszenia gościa) — odpowiedź zostaje pominięta niżej.
  select k into v_bad from jsonb_object_keys(a) k
    where not exists (select 1 from public.job_screening_questions sq
                      where sq.job_id = p_job_id and sq.id::text = k)
    limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_FAILED: odpowiedź na nieznane pytanie' using errcode = '42501';
  end if;

  for q in select * from public.job_screening_questions sq
            where sq.job_id = p_job_id
              and not public.screening_content_rejected(sq.job_id, sq.content_fingerprint)
            order by sq.position loop
    v := a->(q.id::text);
    v_bool := null; v_ans_date := null; v_ans_text := null;
    -- Brak odpowiedzi: brak klucza, JSON null albo pusty tekst.
    if v is not null and jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then v := null; end if;
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;

    if v is not null then
      if q.type = 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'VALIDATION_FAILED: odpowiedź tak/nie' using errcode = '42501';
        end if;
        v_bool := (v #>> '{}')::boolean;
      elsif jsonb_typeof(v) <> 'string' then
        raise exception 'VALIDATION_FAILED: odpowiedź' using errcode = '42501';
      else
        v_text := btrim(v #>> '{}');
        if q.type = 'single_choice' then
          if not exists (select 1 from jsonb_array_elements(q.options) o where o->>'id' = v_text) then
            raise exception 'VALIDATION_FAILED: nieznana opcja' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        elsif q.type = 'date' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          begin
            v_date := v_text::date;
          exception when others then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end;
          if v_date not between date '1900-01-01' and date '2100-12-31' then
            raise exception 'VALIDATION_FAILED: data' using errcode = '42501';
          end if;
          v_ans_date := v_date;
        else
          if length(v_text) > 500 then
            raise exception 'VALIDATION_FAILED: odpowiedź za długa' using errcode = '42501';
          end if;
          v_ans_text := v_text;
        end if;
      end if;
    elsif q.required then
      raise exception 'SCREENING_ANSWER_REQUIRED: %', q.id using errcode = '23514';
    end if;

    -- #98: bez aplikacji (zgłoszenie gościa przed potwierdzeniem) — tylko walidacja.
    if p_application_id is not null then
      insert into public.application_screening_answers
        (application_id, question_id, position, type, required, prompt, options,
         answer_boolean, answer_date, answer_text)
      values (p_application_id, q.id, q.position, q.type, q.required, q.prompt, q.options,
              v_bool, v_ans_date, v_ans_text);
    end if;
  end loop;
end $$;
revoke all on function public.record_screening_answers(uuid, uuid, jsonb) from public, anon, authenticated;

-- --- 4. Firma nie widzi odpowiedzi na treść odrzuconą ----------------------------------------
drop policy if exists application_screening_answers_select on public.application_screening_answers;
create policy application_screening_answers_select on public.application_screening_answers
  for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and (a.candidate_id = auth.uid()
           or (public.is_job_manager(a.job_id)
               and not public.screening_answer_hidden(a.job_id, type, prompt, options)))
  ));

-- --- 5. Strażnik aktywacji: ukryte pytanie nie blokuje wznowienia --------------------------
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
       -- #497 (0201): poza szkicem odrzucone = ukryte, nie blokuje wznowienia/ponownego otwarcia.
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

-- --- 6. Decyzja admina: ukrycie pytania oferty poza szkicem --------------------------------
create or replace function public.admin_decide_screening_review(
  p_review_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.screening_question_reviews;
  v_company uuid;
  v_job_status text;
  v_position smallint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_FAILED: nieznana decyzja' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  select * into v_row from public.screening_question_reviews where id = p_review_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Inny admin zdecydował albo firma zmieniła treść pytania w międzyczasie.
  if v_row.status <> 'pending' then
    raise exception 'STALE_STATE: przegląd nie oczekuje na decyzję' using errcode = '42501';
  end if;
  select q.position into v_position
    from public.job_screening_questions q
    join public.jobs j on j.id = q.job_id and j.deleted_at is null
   where q.job_id = v_row.job_id and q.content_fingerprint = v_row.content_fingerprint
   order by q.position limit 1;
  if v_position is null then
    raise exception 'STALE_STATE: treści pytania nie ma już w ofercie' using errcode = '42501';
  end if;

  update public.screening_question_reviews
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_review_id;

  perform public.write_audit('screening_question.reviewed', 'screening_question_review', p_review_id,
    jsonb_build_object('status', v_row.status),
    jsonb_strip_nulls(jsonb_build_object(
      'status', p_decision, 'reason', v_reason, 'job_id', v_row.job_id,
      'categories', to_jsonb(v_row.risk_categories))));

  select company_id, status::text into v_company, v_job_status from public.jobs where id = v_row.job_id;

  -- #497 (0201): oferta poza szkicem — pytanie znika od razu, oferta zostaje; prośba
  -- o poprawkę trafia do wszystkich aktywnych recruiter+ firmy (tytuł w ich języku w UI).
  if p_decision = 'rejected' and v_job_status is distinct from 'draft' then
    perform public.write_audit('screening_question.hidden', 'screening_question_review', p_review_id, null,
      jsonb_build_object('job_id', v_row.job_id, 'position', v_position,
                         'job_status', v_job_status,
                         'categories', to_jsonb(v_row.risk_categories)));
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      select m.profile_id, 'system'::public.notification_type, 'screening_question_hidden',
             'job', v_row.job_id,
             jsonb_build_object('kind', 'screening_review', 'status', 'hidden', 'position', v_position)
        from public.company_members m
       where m.company_id = v_company
         and public.company_recipient_ok(v_company, m.profile_id)
       group by m.profile_id;
    return;
  end if;

  if v_row.requested_by is not null and v_company is not null
     and public.company_recipient_ok(v_company, v_row.requested_by) then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_row.requested_by, 'system'::public.notification_type, 'screening_review_decided',
              'job', v_row.job_id,
              jsonb_build_object('kind', 'screening_review', 'status', p_decision));
  end if;
end $$;
revoke all on function public.admin_decide_screening_review(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_screening_review(uuid, text, text) to authenticated;
