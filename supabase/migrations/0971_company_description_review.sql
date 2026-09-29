-- =============================================================================
-- 0971_company_description_review.sql — opis firmy z zatwierdzaniem przez admina (#868).
-- NUMER TYMCZASOWY (ostateczny nada integrator).
--
-- Stan przed: `companies.description` był czytany publicznie (profil firmy `get_public_company`,
-- Organization JSON-LD, `company_description` szczegółu oferty), a pracodawca nie miał żadnej
-- ścieżki jego edycji. Bezpośredni UPDATE przez owner/admin (RLS 0040) dawałby publikację
-- tekstu bez kontroli człowieka.
--
-- Wzorzec jak strona WWW/logo (0156):
--   1. `description` = wartość ZATWIERDZONA (jedyna czytana publicznie — RPC bez zmian).
--      Propozycja firmy czeka w `description_pending` ze stanem `description_review_status`
--      (`pending` / `rejected`, NULL = brak propozycji), czasem zgłoszenia
--      `description_pending_at` (klucz CAS decyzji) i uzasadnieniem odrzucenia
--      `description_review_reason`. Limit długości: 1500 znaków (CHECK).
--   2. Strażnik `guard_company_description`: klient (anon/authenticated) nie zmienia żadnej
--      z tych kolumn bezpośrednio (UPDATE ani INSERT). Piszą wyłącznie funkcje SECURITY DEFINER.
--   3. `submit_company_description` (owner/admin): propozycja równa zatwierdzonemu opisowi =
--      wycofanie propozycji (`unchanged`); usunięcie opisu wchodzi od razu (`applied`) —
--      niczego nowego nie publikuje; nowy tekst = propozycja do decyzji (`pending`). Idempotentne.
--   4. `admin_decide_company_description` (tylko admin): CAS po `description_pending_at`
--      (`STALE_STATE`), akceptacja przenosi tekst do `description`, odrzucenie wymaga
--      uzasadnienia (≤ 1000) i zostawia propozycję do wglądu firmy. Powiadomienie in-app
--      właścicieli (`system`, `data.kind = 'company_description'`) + audyt.
--
-- Zmiana opisu NIE cofa weryfikacji firmy. Dowód: `supabase/tests/rls.sql` sekcja CDR971.
-- Rollback: `supabase/rollback/0971_company_description_review.down.sql`.
-- =============================================================================

alter table public.companies
  add column if not exists description_pending text,
  add column if not exists description_review_status text,
  add column if not exists description_pending_at timestamptz,
  add column if not exists description_review_reason text,
  add column if not exists description_reviewed_at timestamptz;

alter table public.companies drop constraint if exists companies_description_pending_len;
alter table public.companies add constraint companies_description_pending_len
  check (description_pending is null or char_length(description_pending) between 1 and 1500);

alter table public.companies drop constraint if exists companies_description_review_status_check;
alter table public.companies add constraint companies_description_review_status_check
  check (description_review_status is null or description_review_status in ('pending', 'rejected'));

-- Stan spójny: propozycja ma tekst i czas zgłoszenia; odrzucona ma uzasadnienie.
alter table public.companies drop constraint if exists companies_description_review_state_check;
alter table public.companies add constraint companies_description_review_state_check
  check (
    (description_review_status is null and description_pending is null
       and description_pending_at is null and description_review_reason is null)
    or (description_review_status = 'pending' and description_pending is not null
        and description_pending_at is not null and description_review_reason is null)
    or (description_review_status = 'rejected' and description_pending is not null
        and description_pending_at is not null and description_review_reason is not null
        and char_length(description_review_reason) between 1 and 1000)
  );

-- Kolejka admina: firmy z propozycją opisu do decyzji, najstarsze pierwsze.
create index if not exists idx_companies_description_pending
  on public.companies (description_pending_at, id)
  where description_review_status = 'pending' and deleted_at is null;

-- --- Strażnik: opis i stan przeglądu tylko przez funkcje SECURITY DEFINER ---------------------
create or replace function public.guard_company_description()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.description is not null
       or new.description_pending is not null or new.description_review_status is not null
       or new.description_pending_at is not null or new.description_review_reason is not null
       or new.description_reviewed_at is not null then
      raise exception 'PERMISSION_DENIED: opis firmy tylko przez submit_company_description'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.description is distinct from old.description
     or new.description_pending is distinct from old.description_pending
     or new.description_review_status is distinct from old.description_review_status
     or new.description_pending_at is distinct from old.description_pending_at
     or new.description_review_reason is distinct from old.description_review_reason
     or new.description_reviewed_at is distinct from old.description_reviewed_at then
    raise exception 'PERMISSION_DENIED: opis firmy tylko przez submit_company_description'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_company_description on public.companies;
create trigger trg_guard_company_description
  before insert or update on public.companies
  for each row execute function public.guard_company_description();

-- --- Zgłoszenie propozycji przez firmę -----------------------------------------------------
-- Pusty tekst = usunięcie opisu. Zwraca `unchanged` | `applied` | `pending`.
create or replace function public.submit_company_description(
  p_company_id uuid,
  p_description text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_new text := nullif(btrim(coalesce(p_description, '')), '');
  v_approved text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  select * into v_row from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED: opis firmy — tylko owner/admin firmy' using errcode = '42501';
  end if;

  if v_new is not null and char_length(v_new) > 1500 then
    raise exception 'VALIDATION_FAILED: DESCRIPTION_TOO_LONG' using errcode = '22023';
  end if;

  v_approved := nullif(btrim(coalesce(v_row.description, '')), '');

  -- 1) Propozycja = zatwierdzony opis: wycofanie propozycji (także odrzuconej).
  if v_new is not distinct from v_approved then
    if v_row.description_review_status is not null then
      update public.companies
         set description_pending = null, description_review_status = null,
             description_pending_at = null, description_review_reason = null, updated_at = now()
       where id = p_company_id;
    end if;
    return 'unchanged';
  end if;

  -- 2) Usunięcie opisu — nic nowego nie publikuje, wchodzi od razu.
  if v_new is null then
    update public.companies
       set description = null,
           description_pending = null, description_review_status = null,
           description_pending_at = null, description_review_reason = null, updated_at = now()
     where id = p_company_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.description_removed', 'company', p_company_id,
            jsonb_build_object('had_description', true), jsonb_build_object('had_description', false));
    return 'applied';
  end if;

  -- 3) Nowy tekst: propozycja do decyzji. Ta sama oczekująca propozycja = bez zmian (retry).
  if v_row.description_review_status = 'pending' and v_new = v_row.description_pending then
    return 'pending';
  end if;

  update public.companies
     set description_pending = v_new, description_review_status = 'pending',
         description_pending_at = date_trunc('milliseconds', clock_timestamp()),
         description_review_reason = null, updated_at = now()
   where id = p_company_id;

  -- Audyt bez treści opisu (tylko długość).
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.description_submitted', 'company', p_company_id,
          jsonb_build_object('length', coalesce(char_length(v_approved), 0)),
          jsonb_build_object('length', char_length(v_new)));
  return 'pending';
end $$;

revoke all on function public.submit_company_description(uuid, text) from public, anon;
grant execute on function public.submit_company_description(uuid, text) to authenticated;

-- --- Decyzja admina ------------------------------------------------------------------------
create or replace function public.admin_decide_company_description(
  p_company_id uuid,
  p_decision text,
  p_expected_pending_at timestamptz,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_FAILED: DECISION_INVALID' using errcode = '22023';
  end if;

  select * into v_row from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_row.description_review_status is distinct from 'pending'
     or p_expected_pending_at is null
     or v_row.description_pending_at is distinct from p_expected_pending_at then
    raise exception 'STALE_STATE: propozycja opisu firmy zmieniła się albo już rozstrzygnięta'
      using errcode = 'P0001';
  end if;

  if p_decision = 'rejected' and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    update public.companies
       set description = v_row.description_pending,
           description_pending = null, description_review_status = null,
           description_pending_at = null, description_review_reason = null,
           description_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
  else
    update public.companies
       set description_review_status = 'rejected', description_review_reason = v_reason,
           description_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.description_reviewed', 'company', p_company_id,
          jsonb_build_object('length', char_length(v_row.description_pending)),
          jsonb_strip_nulls(jsonb_build_object('decision', p_decision, 'reason', v_reason)));

  for v_owner in
    select cm.profile_id
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.role = 'owner'
       and public.company_recipient_ok(p_company_id, cm.profile_id)
  loop
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
    values (v_owner, 'system'::public.notification_type, 'company_description_reviewed',
            'company', p_company_id,
            jsonb_build_object('kind', 'company_description', 'status', p_decision));
  end loop;
end $$;

revoke all on function public.admin_decide_company_description(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_decide_company_description(uuid, text, timestamptz, text) to authenticated;
