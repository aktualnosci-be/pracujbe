-- =============================================================================
-- 0084_admin_company_review.sql
-- Decyzja admina o firmie z uzasadnieniem i powiadomieniem właściciela (#310).
--
-- 1. `companies.status_reason` — uzasadnienie ostatniego odrzucenia/zawieszenia (≤ 1000
--    znaków). Widoczne dla członków firmy (panel `/employer/firma`) i admina; anon nie czyta
--    tabeli companies (0014). Pracodawca nie może go zmienić (strażnik z pkt 3).
-- 2. `admin_set_company_status(p_company_id, p_status, p_expected_status, p_reason)`:
--    * macierz przejść, FOR UPDATE, STALE_STATE i NOT_FOUND bez zmian (0081);
--    * → rejected / suspended wymaga niepustego uzasadnienia (VALIDATION_FAILED:
--      REASON_REQUIRED; > 1000 znaków → VALIDATION_FAILED: REASON_TOO_LONG);
--    * → verified czyści uzasadnienie;
--    * po zmianie: powiadomienie in-app i e-mail (companyVerified / companyRejected /
--      companySuspended) do KAŻDEGO aktywnego właściciela firmy (company_members.role =
--      'owner', `company_recipient_ok`). Język e-maila = język właściciela
--      (`enqueue_email` → `resolve_recipient_locale`, Invariant #1). Klucz idempotencji
--      = wpis audytu tej decyzji + odbiorca (ponowienie tej samej transakcji nie dubluje).
-- 3. `protect_company_verification` (0072) — nie-admin nie zmienia `status_reason`.
-- 4. `audit_company_change` (0017) — `company.status_changed` zapisuje w after_data także
--    uzasadnienie (`reason`) dla rejected/suspended; aktor = admin (auth.uid()).
--
-- Stara sygnatura (uuid, text, text) usunięta — nowa z wartościami domyślnymi obsługuje te
-- same wywołania; odrzucenie/zawieszenie bez uzasadnienia jest odtąd odrzucane.
--
-- Rollback: drop function admin_set_company_status(uuid, text, text, text); odtworzyć
-- wersję z 0081, `protect_company_verification` z 0072, `audit_company_change` z 0017;
-- `alter table companies drop column status_reason`.
-- =============================================================================

alter table public.companies add column if not exists status_reason text;
alter table public.companies drop constraint if exists companies_status_reason_len;
alter table public.companies add constraint companies_status_reason_len
  check (status_reason is null or char_length(status_reason) <= 1000);

-- --- 3. Strażnik: status/weryfikacja/uzasadnienie tylko przez admina ------------------
create or replace function public.protect_company_verification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    -- Jedyne przejście statusu dostępne pracodawcy: ponowne zgłoszenie odrzuconej firmy (RPC).
    if coalesce(current_setting('pracujbe.company_reverify', true), '') = old.id::text
       and old.status = 'rejected' and new.status = 'pending'
       and new.verified_at is not distinct from old.verified_at
       and new.verified_by is not distinct from old.verified_by
       and new.status_reason is not distinct from old.status_reason then
      return new;
    end if;

    if new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by
       or new.status_reason is distinct from old.status_reason then
      raise exception 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina'
        using errcode = '42501';
    end if;

    -- Zweryfikowane dane tożsamości firmy zmienione → ponowna weryfikacja przez admina.
    if old.status = 'verified'
       and (new.name is distinct from old.name or new.vat_number is distinct from old.vat_number) then
      new.status := 'pending';
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;
  return new;
end $$;

-- --- 4. Audyt: uzasadnienie w wpisie zmiany statusu ----------------------------------
create or replace function public.audit_company_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
    values (auth.uid(), 'company.created', 'company', new.id,
            jsonb_build_object('status', new.status, 'name', new.name));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.status_changed', 'company', new.id,
            jsonb_build_object('status', old.status),
            jsonb_strip_nulls(jsonb_build_object(
              'status', new.status,
              'reason', case when new.status in ('rejected', 'suspended') then new.status_reason end)));
  end if;
  return new;
end $$;

-- --- 2. RPC admina z uzasadnieniem i powiadomieniem właściciela ----------------------
drop function if exists public.admin_set_company_status(uuid, text, text);

create or replace function public.admin_set_company_status(
  p_company_id uuid,
  p_status text,
  p_expected_status text default null,
  p_reason text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_to public.company_status;
  v_expected public.company_status;
  v_from public.company_status;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_audit uuid;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  begin
    v_to := p_status::public.company_status;
    v_expected := p_expected_status::public.company_status;
  exception when invalid_text_representation then
    raise exception 'VALIDATION_FAILED: nieznany status firmy' using errcode = '22023';
  end;

  select status, name into v_from, v_name
    from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_expected is not null and v_expected is distinct from v_from then
    raise exception 'STALE_STATE: status firmy zmienił się (% zamiast %)', v_from, v_expected;
  end if;

  if not (
    (v_from in ('unverified', 'pending') and v_to in ('verified', 'rejected'))
    or (v_from = 'verified' and v_to = 'suspended')
    or (v_from in ('rejected', 'suspended') and v_to = 'verified')
  ) then
    raise exception 'INVALID_TRANSITION: % -> %', v_from, v_to using errcode = '22023';
  end if;

  -- Po macierzy przejść: niedozwolone przejście zgłasza INVALID_TRANSITION, nie brak powodu.
  if v_to in ('rejected', 'suspended') and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  update public.companies
    set status = v_to,
        status_reason = case when v_to = 'verified' then null else v_reason end,
        verified_at = case when v_to = 'verified' then now() else verified_at end,
        verified_by = case when v_to = 'verified' then auth.uid() else verified_by end,
        updated_at = now()
    where id = p_company_id;

  -- Wpis audytu tej decyzji (trigger audit_company_change w tej transakcji). Dopasowanie po
  -- przejściu i aktorze, nie tylko po czasie: w jednej transakcji now() jest stałe, więc samo
  -- `order by created_at` wybrałoby dowolny wcześniejszy wpis (i klucz e-maila innej decyzji).
  select a.id into v_audit
    from public.audit_logs a
    where a.entity_type = 'company' and a.entity_id = p_company_id
      and a.action = 'company.status_changed'
      and a.actor_id = auth.uid()
      and a.before_data->>'status' = v_from::text
      and a.after_data->>'status' = v_to::text
      and a.created_at = now()
    order by a.id desc
    limit 1;
  if v_audit is null then
    raise exception 'INTERNAL: brak wpisu audytu decyzji' using errcode = 'P0001';
  end if;

  for v_owner in
    select cm.profile_id
      from public.company_members cm
      where cm.company_id = p_company_id
        and cm.role = 'owner'
        and public.company_recipient_ok(p_company_id, cm.profile_id)
  loop
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_owner,
              case when v_to = 'verified' then 'company_verified'::public.notification_type
                   else 'system'::public.notification_type end,
              'company_status_changed', 'company', p_company_id,
              jsonb_build_object('kind', 'company_status', 'status', v_to::text));

    perform public.enqueue_email(v_owner,
                                 case v_to when 'verified' then 'companyVerified'
                                           when 'rejected' then 'companyRejected'
                                           else 'companySuspended' end,
                                 'company', p_company_id,
                                 'companystatus-' || v_audit::text || '-' || v_owner::text,
                                 jsonb_strip_nulls(jsonb_build_object(
                                   'companyName', v_name,
                                   'reason', case when v_to = 'verified' then null else v_reason end)));
  end loop;
end $$;
revoke all on function public.admin_set_company_status(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_company_status(uuid, text, text, text) to authenticated;
