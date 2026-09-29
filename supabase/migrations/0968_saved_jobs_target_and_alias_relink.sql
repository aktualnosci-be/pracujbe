-- =============================================================================
-- 0968_saved_jobs_target_and_alias_relink.sql — (numer tymczasowy)
--
-- Część A (#882) — zapis oferty nie daje dostępu do metadanych oferty niepublicznej.
--   `saved_jobs_insert_own` (0009) sprawdzał tylko `candidate_id = auth.uid()`, a FK pomija RLS,
--   więc kandydat znający UUID szkicu (albo oferty usuniętej) mógł go „zapisać”, a
--   `get_saved_jobs_display` (0162) oddawała wtedy tytuł, firmę i miasto.
--   1. `saved_jobs.saved_while_public` — dowód, że oferta była publiczna w chwili zapisu. Ustala
--      go WYŁĄCZNIE trigger (wartość klienta jest nadpisywana; klient nie ma UPDATE na tabeli).
--   2. BEFORE INSERT `trg_saved_jobs_guard_target`: nowy zapis tylko dla oferty publicznej
--      (warunki `get_public_job`: aktywna, nieusunięta, przed terminem, firma `verified`
--      i nieusunięta). Wiersze oferty i firmy są blokowane `FOR SHARE`, więc równoległe
--      wycofanie oferty albo zmiana statusu firmy czeka na koniec zapisu (albo zapis widzi już
--      nowy stan). Oferta niepubliczna = `NOT_FOUND` (neutralnie: jak nieistniejąca).
--      Istniejący wiersz tej samej pary (ponowienie, `ON CONFLICT DO NOTHING`) przechodzi —
--      nic nowego nie powstaje. Reguła dotyczy każdej roli; wyjątek wyłącznie dla seedu demo
--      (sesja superusera z przełącznikiem z 0171) — bez błędu, ale bez dowodu dla oferty
--      niepublicznej.
--   3. Backfill: dotychczasowe zapisy dostają `true` tylko dla ofert publicznych TERAZ —
--      nie zakładamy, że stare zapisy ofert już niepublicznych powstały legalnie.
--   4. `get_saved_jobs_display`: tytuł, firma i miasto dla oferty niepublicznej tylko przy
--      `saved_while_public`; inaczej puste pola (panel pokazuje ogólną etykietę) — zapis nadal
--      widoczny i usuwalny. Sygnatura, typ wyniku i granty jak w 0162.
--
-- Część B (#715) — powiązanie `jobs.location_id` po każdej zmianie słownika.
--   0153 dowiązywał oferty tylko przy INSERT aliasu (i tylko oferty bez miejscowości). Zmiana
--   `alias_key`, przeniesienie aliasu do innej miejscowości, usunięcie aliasu i dezaktywacja
--   (albo ponowna aktywacja) miejscowości zostawiały stare `location_id`.
--   5. `relink_jobs_for_city_keys(text[])` — oferty, których `city_key(city)` jest w zbiorze
--      dotkniętych kluczy (stare i nowe klucze aliasów, aliasy zmienionej miejscowości), albo
--      które wskazują dotkniętą miejscowość, dostają `resolve_location_id(city)` — tylko gdy
--      wynik się różni. `jobs.city` bez zmian.
--   6. Triggery statement-level z tabelami przejściowymi: `location_aliases` AFTER INSERT /
--      UPDATE / DELETE (PostgreSQL nie dopuszcza tabel przejściowych dla kilku zdarzeń w jednym
--      triggerze) oraz `locations` AFTER UPDATE (zmiana `is_active`). Usunięcie miejscowości
--      kasuje jej aliasy kaskadą (0112) → trigger DELETE aliasów.
--   7. `trg_zz_jobs_location_only_keep_version` (BEFORE UPDATE, po `trg_strict_job_version`):
--      zmiana WYŁĄCZNIE `location_id` (pochodnej słownika) nie podbija `updated_at` — tokenu
--      CAS edycji opublikowanej oferty (#325). Każda inna zmiana wiersza podbija jak dotąd.
--   8. Backfill jednorazowy (idempotentny) wszystkich ofert.
--
-- Rollback: supabase/rollback/0968_saved_jobs_target_and_alias_relink.down.sql
-- (test: supabase/tests/saved-jobs-alias-relink-rollback.sql w scripts/test-rls.sh).
-- =============================================================================

-- --- A1. Dowód publiczności w chwili zapisu ------------------------------------------------------
alter table public.saved_jobs
  add column if not exists saved_while_public boolean not null default false;
comment on column public.saved_jobs.saved_while_public is
  'Oferta była publiczna w chwili zapisu (trigger trg_saved_jobs_guard_target, 0968). Tylko wtedy get_saved_jobs_display pokazuje metadane oferty niepublicznej.';

-- --- A2. Strażnik celu zapisu ------------------------------------------------------------------
create or replace function public.saved_jobs_guard_target()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing boolean;
  v_public boolean := false;
begin
  -- Ponowienie tej samej pary: wiersz już istnieje, INSERT nic nie doda (unikat / ON CONFLICT).
  select s.saved_while_public into v_existing
    from public.saved_jobs s
   where s.candidate_id = new.candidate_id and s.job_id = new.job_id;
  if found then
    new.saved_while_public := v_existing;
    return new;
  end if;

  -- Blokada wierszy celu: równoległe wycofanie oferty/firmy czeka na koniec tej transakcji,
  -- a po jej zatwierdzeniu odczyt widzi już nowy stan (READ COMMITTED ponawia na nowej wersji).
  select (j.deleted_at is null and j.status = 'active'
          and (j.expires_at is null or j.expires_at > now())
          and c.status = 'verified' and c.deleted_at is null)
    into v_public
    from public.jobs j
    join public.companies c on c.id = j.company_id
   where j.id = new.job_id
     for share of j, c;
  v_public := coalesce(v_public, false);

  -- Każda rola (także serwer): nowy zapis wyłącznie oferty publicznej. Jedyny wyjątek = seed
  -- demo (ten sam przełącznik co 0171: sesja superusera z `pracujbe.allow_recruitment_write`);
  -- flaga i tak wynika z faktów, więc zapis seedu oferty niepublicznej nie ma dowodu.
  if not v_public
     and not (coalesce(current_setting('pracujbe.allow_recruitment_write', true), '') = 'on'
              and exists (select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper)) then
    raise exception 'NOT_FOUND: oferta niedostępna' using errcode = 'P0002';
  end if;
  new.saved_while_public := v_public;
  return new;
end $$;
revoke all on function public.saved_jobs_guard_target() from public, anon, authenticated;

drop trigger if exists trg_saved_jobs_guard_target on public.saved_jobs;
create trigger trg_saved_jobs_guard_target
  before insert on public.saved_jobs
  for each row execute function public.saved_jobs_guard_target();

-- --- A3. Backfill: tylko oferty publiczne teraz --------------------------------------------------
update public.saved_jobs s
   set saved_while_public = true
  from public.jobs j
  join public.companies c on c.id = j.company_id
 where j.id = s.job_id
   and not s.saved_while_public
   and j.deleted_at is null and j.status = 'active'
   and (j.expires_at is null or j.expires_at > now())
   and c.status = 'verified' and c.deleted_at is null;

-- --- A4. Odczyt panelu (stan 0162 + bramka metadanych) -------------------------------------------
create or replace function public.get_saved_jobs_display(p_locale text default 'pl')
returns table (
  id uuid,
  slug text,
  title text,
  company_name text,
  city text,
  job_availability text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id,
    case when v.availability = 'available' then j.slug end as slug,
    case when m.visible then coalesce(t.title, j.title) else '' end as title,
    case when m.visible then coalesce(c.name, '') else '' end as company_name,
    case when m.visible then coalesce(j.city, '') else '' end as city,
    v.availability
  from public.saved_jobs s
  join public.jobs j on j.id = s.job_id
  left join public.companies c on c.id = j.company_id
  cross join lateral (
    select case
      when j.deleted_at is null and j.status = 'active'
           and (j.expires_at is null or j.expires_at > now())
           and c.status = 'verified' and c.deleted_at is null
        then 'available'
      when j.deleted_at is not null or j.status = 'closed' or c.deleted_at is not null
        then 'closed'
      when j.status = 'expired'
           or (j.status in ('active', 'paused') and j.expires_at is not null and j.expires_at <= now())
        then 'expired'
      when j.status = 'paused'
        then 'paused'
      else 'unavailable'
    end as availability
  ) v
  -- #882: metadane oferty niepublicznej tylko przy dowodzie zapisu w czasie publikacji.
  cross join lateral (
    select (v.availability = 'available' or s.saved_while_public) as visible
  ) m
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by
      (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
      (jt.locale = j.default_locale) desc,
      (jt.locale = 'en') desc
    limit 1
  ) t on m.visible
  where s.candidate_id = auth.uid()
  order by s.created_at desc, j.id desc;
$$;
revoke all on function public.get_saved_jobs_display(text) from public, anon;
grant execute on function public.get_saved_jobs_display(text) to authenticated;

-- --- B5. Przeliczenie powiązań dotkniętych ofert -------------------------------------------------
create or replace function public.relink_jobs_for_city_keys(p_keys text[], p_location_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_keys, 1), 0) = 0 and coalesce(array_length(p_location_ids, 1), 0) = 0 then
    return 0;
  end if;
  update public.jobs j
     set location_id = r.location_id
    from (
      select j2.id, public.resolve_location_id(j2.city) as location_id
        from public.jobs j2
       where (public.city_key(j2.city) = any(coalesce(p_keys, '{}'))
              or j2.location_id = any(coalesce(p_location_ids, '{}')))
    ) r
   where j.id = r.id
     and j.location_id is distinct from r.location_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.relink_jobs_for_city_keys(text[], uuid[]) from public, anon, authenticated;
grant execute on function public.relink_jobs_for_city_keys(text[], uuid[]) to service_role;

-- --- B6. Triggery słownika ---------------------------------------------------------------------
create or replace function public.location_aliases_relink_jobs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keys text[];
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.alias_key), array_agg(distinct n.location_id)
      into v_keys, v_ids from new_aliases n;
  elsif tg_op = 'UPDATE' then
    select array_agg(distinct k), array_agg(distinct l) into v_keys, v_ids
      from (select o.alias_key as k, o.location_id as l from old_aliases o
            union all
            select n.alias_key, n.location_id from new_aliases n) x;
  else
    select array_agg(distinct o.alias_key), array_agg(distinct o.location_id)
      into v_keys, v_ids from old_aliases o;
  end if;
  perform public.relink_jobs_for_city_keys(v_keys, v_ids);
  return null;
end $$;
revoke all on function public.location_aliases_relink_jobs() from public, anon, authenticated;

drop trigger if exists trg_location_aliases_relink_jobs on public.location_aliases;
create trigger trg_location_aliases_relink_jobs
  after insert on public.location_aliases
  referencing new table as new_aliases
  for each statement execute function public.location_aliases_relink_jobs();
drop trigger if exists trg_location_aliases_relink_jobs_upd on public.location_aliases;
create trigger trg_location_aliases_relink_jobs_upd
  after update on public.location_aliases
  referencing old table as old_aliases new table as new_aliases
  for each statement execute function public.location_aliases_relink_jobs();
drop trigger if exists trg_location_aliases_relink_jobs_del on public.location_aliases;
create trigger trg_location_aliases_relink_jobs_del
  after delete on public.location_aliases
  referencing old table as old_aliases
  for each statement execute function public.location_aliases_relink_jobs();

-- Dezaktywacja / ponowna aktywacja miejscowości: przeliczenie ofert po jej aliasach.
create or replace function public.locations_relink_jobs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_keys text[];
begin
  select array_agg(distinct n.id) into v_ids
    from new_locations n join old_locations o on o.id = n.id
   where n.is_active is distinct from o.is_active;
  if v_ids is null then
    return null;
  end if;
  select array_agg(distinct a.alias_key) into v_keys
    from public.location_aliases a where a.location_id = any(v_ids);
  perform public.relink_jobs_for_city_keys(v_keys, v_ids);
  return null;
end $$;
revoke all on function public.locations_relink_jobs() from public, anon, authenticated;

drop trigger if exists trg_locations_relink_jobs on public.locations;
create trigger trg_locations_relink_jobs
  after update on public.locations
  referencing old table as old_locations new table as new_locations
  for each statement execute function public.locations_relink_jobs();

-- --- B7. Pochodna słownika nie jest nową wersją oferty ------------------------------------------
create or replace function public.jobs_location_only_keep_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.location_id is distinct from old.location_id
     and (to_jsonb(new) - 'location_id' - 'updated_at') = (to_jsonb(old) - 'location_id' - 'updated_at') then
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
revoke all on function public.jobs_location_only_keep_version() from public, anon, authenticated;

drop trigger if exists trg_zz_jobs_location_only_keep_version on public.jobs;
-- Nazwa po trg_set_updated_at i trg_strict_job_version (BEFORE wykonują się alfabetycznie).
create trigger trg_zz_jobs_location_only_keep_version
  before update on public.jobs
  for each row execute function public.jobs_location_only_keep_version();

-- --- B8. Backfill (idempotentny; updated_at bez zmian dzięki B7) ---------------------------------
update public.jobs j
   set location_id = public.resolve_location_id(j.city)
 where j.location_id is distinct from public.resolve_location_id(j.city);
