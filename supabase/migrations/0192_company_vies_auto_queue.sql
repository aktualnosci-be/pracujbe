-- =============================================================================
-- 0192_company_vies_auto_queue.sql  (numer tymczasowy — ostateczny nada integrator)
-- Trwała kolejka automatycznego sprawdzenia VAT w VIES (#706, #879).
--
-- 0164 sprawdzało numer tylko raz, zaraz po założeniu firmy (`after()` w akcji). Chwilowa
-- niedostępność / limit VIES nie zostawiały żadnego śladu (#706), a numer dopisany później
-- w edycji firmy nie był sprawdzany wcale (#879). Teraz:
--
-- 1. `company_vies_number(vat, kbo)` — numer do sprawdzenia (VAT, a gdy brak — KBO),
--    znormalizowany jak `parseBelgianVat` (10 cyfr, suma mod 97); zapis spoza BE / zły → null.
-- 2. `company_vies_auto_queue` — jeden wiersz na firmę: numer, liczba prób, termin następnej
--    próby, dzierżawa, ostatni wynik nierozstrzygający. RLS włączone i wymuszone, bez polityk
--    i grantów dla klientów (odczyt: panel admina service-rolem).
-- 3. Trigger na `companies` (INSERT oraz UPDATE numeru VAT/KBO albo `deleted_at`) — KAŻDA
--    ścieżka zapisu (założenie firmy, edycja `/employer/firma`, DML): nowy prawidłowy numer
--    bez wyniku dla tego numeru → wiersz w kolejce (termin = teraz, próby od zera); numer
--    usunięty / nieprawidłowy / firma usunięta → wiersz znika. Ponowny zapis tego samego
--    numeru nie zeruje prób (brak obejścia backoffu).
-- 4. Trigger na `company_vies_checks` — zapis wyniku rozstrzygającego dla bieżącego numeru
--    (automatycznie albo ręcznie przez admina) zdejmuje zadanie z kolejki.
-- 5. `claim_company_vies_auto_checks(limit, company, lease)` — service_role, SKIP LOCKED,
--    dzierżawa (domyślnie 5 min), próba liczona przy pobraniu, najwyżej 10 prób.
-- 6. `finish_company_vies_auto_check(company, numer, wynik)` — service_role: `done` usuwa
--    zadanie, `unavailable` / `rate_limited` / `error` zwalnia dzierżawę i ustawia termin
--    z backoffem 5 min × 2^(próba−1), najwyżej 6 h. Tylko dla numeru z zadania (numer
--    zmieniony w trakcie = zadanie z nowym numerem zostaje nietknięte).
-- 7. `record_company_vies_check_auto` (0164) — jak dotąd nie nadpisuje wyniku dla TEGO
--    SAMEGO numeru (np. admina), ale zastępuje wynik dotyczący numeru, którego firma już nie
--    ma (inaczej firma, która zmieniła numer, nigdy nie dostałaby automatycznego wyniku).
-- 8. Backfill: firmy z prawidłowym numerem bez wyniku dla tego numeru trafiają do kolejki.
--
-- Status firmy nadal zmienia wyłącznie admin. Worker: `/api/maintenance` (co godzinę)
-- i jednorazowa próba po zapisie firmy (`src/lib/vies/auto-check.ts`).
--
-- Rollback: supabase/rollback/0192_company_vies_auto_queue.down.sql
-- =============================================================================

create or replace function public.company_vies_number(p_vat text, p_kbo text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v text := upper(coalesce(nullif(btrim(p_vat), ''), nullif(btrim(p_kbo), '')));
begin
  if v is null then return null; end if;
  v := regexp_replace(v, '[[:space:]./-]', '', 'g');
  if v ~ '^[A-Z]{2}' then
    if left(v, 2) <> 'BE' then return null; end if;
    v := substr(v, 3);
  end if;
  if v ~ '^[0-9]{9}$' then v := '0' || v; end if;
  if v !~ '^[01][0-9]{9}$' then return null; end if;
  if 97 - (left(v, 8)::bigint % 97) <> right(v, 2)::int then return null; end if;
  return v;
end $$;

revoke all on function public.company_vies_number(text, text) from public, anon, authenticated;
grant execute on function public.company_vies_number(text, text) to service_role;

create table if not exists public.company_vies_auto_queue (
  company_id      uuid primary key references public.companies(id) on delete cascade,
  vat_number      text not null,
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  last_outcome    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint company_vies_auto_queue_vat check (
    vat_number ~ '^[01][0-9]{9}$'
    and 97 - (left(vat_number, 8)::bigint % 97) = right(vat_number, 2)::int
  ),
  constraint company_vies_auto_queue_attempts check (attempts between 0 and 10),
  constraint company_vies_auto_queue_outcome check (
    last_outcome is null or last_outcome in ('unavailable', 'rate_limited', 'error')
  )
);

create index if not exists idx_company_vies_auto_queue_due
  on public.company_vies_auto_queue (next_attempt_at);

alter table public.company_vies_auto_queue enable row level security;
alter table public.company_vies_auto_queue force row level security;
revoke all on public.company_vies_auto_queue from public, anon, authenticated;

-- Maksymalna liczba prób — jedno miejsce (lustro `VIES_AUTO_MAX_ATTEMPTS` w TS).
create or replace function public.company_vies_auto_max_attempts()
returns integer language sql immutable as $$ select 10 $$;

-- 3. Kolejkowanie przy każdym zapisie numeru firmy.
create or replace function public.trg_company_vies_auto_enqueue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_number text := public.company_vies_number(new.vat_number, new.registration_number);
begin
  if new.deleted_at is not null or v_number is null
     or exists (select 1 from public.company_vies_checks c
                 where c.company_id = new.id and c.vat_number = v_number) then
    delete from public.company_vies_auto_queue where company_id = new.id;
    return null;
  end if;

  insert into public.company_vies_auto_queue as q (company_id, vat_number)
  values (new.id, v_number)
  on conflict (company_id) do update
    set vat_number = excluded.vat_number,
        attempts = 0,
        next_attempt_at = now(),
        lease_until = null,
        last_outcome = null,
        updated_at = now()
    where q.vat_number <> excluded.vat_number;
  return null;
end $$;

revoke all on function public.trg_company_vies_auto_enqueue() from public, anon, authenticated;

drop trigger if exists trg_companies_vies_auto_enqueue on public.companies;
create trigger trg_companies_vies_auto_enqueue
  after insert or update of vat_number, registration_number, deleted_at on public.companies
  for each row execute function public.trg_company_vies_auto_enqueue();

-- 4. Wynik rozstrzygający dla bieżącego numeru zdejmuje zadanie (auto i ręczne sprawdzenie).
create or replace function public.trg_company_vies_check_dequeue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.company_vies_auto_queue
   where company_id = new.company_id and vat_number = new.vat_number;
  return null;
end $$;

revoke all on function public.trg_company_vies_check_dequeue() from public, anon, authenticated;

drop trigger if exists trg_company_vies_checks_dequeue on public.company_vies_checks;
create trigger trg_company_vies_checks_dequeue
  after insert or update on public.company_vies_checks
  for each row execute function public.trg_company_vies_check_dequeue();

-- 5. Pobranie zadań do sprawdzenia.
create or replace function public.claim_company_vies_auto_checks(
  p_limit integer default 20,
  p_company_id uuid default null,
  p_lease_seconds integer default 300
)
returns table (company_id uuid, vat_number text, attempts integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600)));
begin
  return query
  with due as (
    select q.company_id
      from public.company_vies_auto_queue q
     where q.next_attempt_at <= now()
       and (q.lease_until is null or q.lease_until < now())
       and q.attempts < public.company_vies_auto_max_attempts()
       and (p_company_id is null or q.company_id = p_company_id)
     order by q.next_attempt_at, q.company_id
     limit v_limit
     for update skip locked
  )
  update public.company_vies_auto_queue q
     set attempts = q.attempts + 1,
         lease_until = now() + v_lease,
         updated_at = now()
    from due
   where q.company_id = due.company_id
  returning q.company_id, q.vat_number, q.attempts;
end $$;

revoke all on function public.claim_company_vies_auto_checks(integer, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_company_vies_auto_checks(integer, uuid, integer)
  to service_role;

-- 6. Zakończenie próby: `done` usuwa, wynik nierozstrzygający planuje ponowienie z backoffem.
create or replace function public.finish_company_vies_auto_check(
  p_company_id uuid,
  p_vat_number text,
  p_outcome text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rows integer;
begin
  if p_outcome is null or p_outcome not in ('done', 'unavailable', 'rate_limited', 'error') then
    raise exception 'VALIDATION_FAILED: OUTCOME' using errcode = '22023';
  end if;

  if p_outcome = 'done' then
    delete from public.company_vies_auto_queue
     where company_id = p_company_id and vat_number = p_vat_number;
  else
    update public.company_vies_auto_queue q
       set lease_until = null,
           last_outcome = p_outcome,
           next_attempt_at = now() + least(
             interval '6 hours',
             interval '5 minutes' * power(2, greatest(q.attempts - 1, 0))::integer),
           updated_at = now()
     where q.company_id = p_company_id and q.vat_number = p_vat_number;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.finish_company_vies_auto_check(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_company_vies_auto_check(uuid, text, text)
  to service_role;

-- 7. Zapis wyniku automatycznego (0164) — zastępuje wynik dotyczący numeru, którego firma
--    już nie ma; wynik dla tego samego numeru (np. admina) nadal nie jest nadpisywany.
create or replace function public.record_company_vies_check_auto(
  p_company_id uuid,
  p_vat_number text,
  p_result text,
  p_vies_name text default null,
  p_request_date date default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := nullif(btrim(coalesce(p_vies_name, '')), '');
  v_source text;
  v_rows integer;
begin
  if p_result is null or p_result not in ('valid', 'invalid') then
    raise exception 'VALIDATION_FAILED: RESULT_NOT_PERSISTABLE' using errcode = '22023';
  end if;
  if p_vat_number is null or p_vat_number !~ '^[01][0-9]{9}$'
     or 97 - (left(p_vat_number, 8)::bigint % 97) <> right(p_vat_number, 2)::int then
    raise exception 'VALIDATION_FAILED: VAT_FORMAT' using errcode = '22023';
  end if;
  if p_result = 'invalid' then v_name := null; end if;
  v_name := left(v_name, 300);

  select public.company_vies_number(vat_number, registration_number)
    into v_source
    from public.companies
   where id = p_company_id and deleted_at is null
   for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_source is distinct from p_vat_number then
    return false;
  end if;

  insert into public.company_vies_checks as c
    (company_id, vat_number, result, vies_name, request_date, checked_at, checked_by)
  values (p_company_id, p_vat_number, p_result, v_name, p_request_date, now(), null)
  on conflict (company_id) do update
    set vat_number = excluded.vat_number,
        result = excluded.result,
        vies_name = excluded.vies_name,
        request_date = excluded.request_date,
        checked_at = excluded.checked_at,
        checked_by = null
    where c.vat_number <> excluded.vat_number;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  values (null, 'company.vies_checked', 'company', p_company_id,
          jsonb_build_object('result', p_result, 'source', 'auto'));
  return true;
end $$;

revoke all on function public.record_company_vies_check_auto(uuid, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.record_company_vies_check_auto(uuid, text, text, text, date)
  to service_role;

-- 8. Backfill: firmy założone wcześniej (także bez numeru przy założeniu, #879).
insert into public.company_vies_auto_queue (company_id, vat_number)
select co.id, public.company_vies_number(co.vat_number, co.registration_number)
  from public.companies co
 where co.deleted_at is null
   and public.company_vies_number(co.vat_number, co.registration_number) is not null
   and not exists (
     select 1 from public.company_vies_checks c
      where c.company_id = co.id
        and c.vat_number = public.company_vies_number(co.vat_number, co.registration_number))
on conflict (company_id) do nothing;
