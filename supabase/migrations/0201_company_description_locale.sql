-- =============================================================================
-- 0201_company_description_locale.sql — #708: język opisu firmy na publicznym profilu.
-- (numer tymczasowy — ostateczny nada integrator)
--
-- Profil `/{locale}/pracodawcy/<slug>` ma adres w każdym języku serwisu (interfejs i karty
-- ofert są w języku strony), ale opis firmy pochodzi z jednego pola `companies.description`
-- i był pokazywany bez informacji, w jakim języku go napisano. Ta migracja:
--
--   1. `companies.description_locale` — język, w którym firma napisała opis (FK do
--      `supported_locales`, null = nieznany). Ustawia go owner/admin firmy przez
--      `set_company_description_locale` (z audytem); CHECK wymaga niepustego opisu.
--   2. Trigger `trg_reset_company_description_locale`: każda zmiana TREŚCI opisu (każda ścieżka
--      zapisu — formularz, przyszłe zatwierdzanie opisu, service_role) bez jednoczesnego
--      wskazania języka zeruje `description_locale`. Język zadeklarowany dla starego tekstu nie
--      zostaje więc przypięty do nowego (stan „nieaktualny” = nieznany, strona to mówi).
--   3. `get_public_company` zwraca dodatkowo `description_locale` (na końcu listy kolumn;
--      zmiana typu zwracanego = drop + create, granty jak w 0140).
--
--   4. Język zgłaszany RAZEM z propozycją opisu (decyzja właściciela 30.09.2026, łączy się
--      z zatwierdzaniem opisu z 0198): `companies.description_locale_pending` (FK jak wyżej,
--      null = nie wskazano) trzyma język propozycji; `submit_company_description(id, tekst,
--      język)` zapisuje go przy nowej propozycji (także przy ponowieniu tej samej propozycji
--      z innym językiem), a `admin_decide_company_description` przy akceptacji przenosi go do
--      `description_locale` razem z tekstem. Odrzucenie nie zmienia języka zatwierdzonego opisu
--      (propozycja z językiem zostaje do wglądu firmy). Tekst równy zatwierdzonemu = sama zmiana
--      języka zatwierdzonego opisu, bez przeglądu (jak `set_company_description_locale`, wynik
--      `locale_applied`). Strażnik 0198 obejmuje obie kolumny języka (zapis tylko przez RPC).
--
-- Bez tłumaczeń opisu (wymagałyby zatwierdzania — osobny etap, plan #31); strona oznacza język
-- opisu (`lang`) i informuje, gdy różni się od języka strony albo jest nieznany.
--
-- Rollback: supabase/rollback/0201_company_description_locale.down.sql (test w test-rls.sh).
-- Migracja nie zmienia istniejących danych (nowa kolumna = null).
-- =============================================================================

alter table public.companies
  add column if not exists description_locale text references public.supported_locales (code);

alter table public.companies drop constraint if exists companies_description_locale_requires_text;
alter table public.companies add constraint companies_description_locale_requires_text
  check (description_locale is null or btrim(coalesce(description, '')) <> '');

comment on column public.companies.description_locale is
  'Język opisu firmy zadeklarowany przez owner/admin (#708); null = nieznany. Zmiana treści opisu bez wskazania języka zeruje wartość (trigger).';

-- --- Trigger: nowa treść opisu = język nieznany, dopóki firma go nie wskaże --------------------
create or replace function public.reset_company_description_locale()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if btrim(coalesce(new.description, '')) = '' then
    new.description_locale := null;
  elsif tg_op = 'UPDATE'
        and new.description is distinct from old.description
        and new.description_locale is not distinct from old.description_locale then
    new.description_locale := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_reset_company_description_locale on public.companies;
create trigger trg_reset_company_description_locale
  before insert or update of description, description_locale on public.companies
  for each row execute function public.reset_company_description_locale();

-- --- RPC: owner/admin firmy wskazuje język opisu -----------------------------------------------
-- p_locale null = „nie wiem / wyczyść”. Zwraca zapisaną wartość (null albo kod języka).
create or replace function public.set_company_description_locale(p_company_id uuid, p_locale text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_locale text := nullif(btrim(coalesce(p_locale, '')), '');
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  select * into v_row from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED: język opisu — tylko owner/admin firmy' using errcode = '42501';
  end if;

  if v_locale is not null then
    if not exists (select 1 from public.supported_locales where code = v_locale) then
      raise exception 'VALIDATION_FAILED: LOCALE_INVALID' using errcode = '22023';
    end if;
    if btrim(coalesce(v_row.description, '')) = '' then
      raise exception 'VALIDATION_FAILED: DESCRIPTION_EMPTY' using errcode = '22023';
    end if;
  end if;

  if v_locale is not distinct from v_row.description_locale then
    return v_locale;
  end if;

  update public.companies
     set description_locale = v_locale, updated_at = now()
   where id = p_company_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.description_locale_changed', 'company', p_company_id,
          jsonb_build_object('description_locale', v_row.description_locale),
          jsonb_build_object('description_locale', v_locale));

  return v_locale;
end $$;

revoke all on function public.set_company_description_locale(uuid, text) from public;
grant execute on function public.set_company_description_locale(uuid, text) to authenticated, service_role;

-- --- get_public_company + description_locale (definicja z 0140, kolumna na końcu) --------------
drop function if exists public.get_public_company(text);
create function public.get_public_company(p_slug text)
returns table (
  id uuid, slug text, name text, description text, city text, region text, industry text,
  logo_url text, website text, active_jobs_count bigint, description_locale text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    c.id, c.slug, c.name, coalesce(c.description, '') as description,
    c.city, c.region, c.industry,
    public.public_https_url(c.logo_url) as logo_url,
    public.public_https_url(c.website) as website,
    (
      select count(*) from public.jobs j
      where j.company_id = c.id and j.status = 'active' and j.deleted_at is null
        and (j.expires_at is null or j.expires_at > now())
    ) as active_jobs_count,
    case when btrim(coalesce(c.description, '')) <> '' then c.description_locale end as description_locale
  from public.companies c
  where c.slug = p_slug
    and c.status = 'verified'
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function public.get_public_company(text) from public;
grant execute on function public.get_public_company(text) to anon, authenticated, service_role;

-- =============================================================================
-- 4. Język propozycji opisu (definicje funkcji z 0198 + język).
-- =============================================================================
alter table public.companies
  add column if not exists description_locale_pending text references public.supported_locales (code);

-- Język propozycji istnieje tylko razem z propozycją (pending/rejected).
alter table public.companies drop constraint if exists companies_description_locale_pending_requires_proposal;
alter table public.companies add constraint companies_description_locale_pending_requires_proposal
  check (description_locale_pending is null or description_pending is not null);

comment on column public.companies.description_locale_pending is
  'Język propozycji opisu (0201); przy akceptacji przenoszony do description_locale, odrzucenie go nie zmienia.';

-- Strażnik z 0198 + kolumny języka (bezpośredni zapis klienta odrzucony; RPC są definerami).
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
       or new.description_reviewed_at is not null
       or new.description_locale is not null or new.description_locale_pending is not null then
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
     or new.description_reviewed_at is distinct from old.description_reviewed_at
     or new.description_locale is distinct from old.description_locale
     or new.description_locale_pending is distinct from old.description_locale_pending then
    raise exception 'PERMISSION_DENIED: opis firmy tylko przez submit_company_description'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Zgłoszenie propozycji z językiem. Zwraca `unchanged` | `locale_applied` | `applied` | `pending`.
drop function if exists public.submit_company_description(uuid, text);
create function public.submit_company_description(
  p_company_id uuid,
  p_description text,
  p_description_locale text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_new text := nullif(btrim(coalesce(p_description, '')), '');
  v_locale text := nullif(btrim(coalesce(p_description_locale, '')), '');
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
  if v_locale is not null and not exists (select 1 from public.supported_locales where code = v_locale) then
    raise exception 'VALIDATION_FAILED: LOCALE_INVALID' using errcode = '22023';
  end if;

  v_approved := nullif(btrim(coalesce(v_row.description, '')), '');

  -- 1) Tekst = zatwierdzony opis: wycofanie propozycji (także odrzuconej); zmiana samego języka
  --    zatwierdzonego opisu wchodzi od razu (bez przeglądu, z audytem — jak set_company_description_locale).
  if v_new is not distinct from v_approved then
    if v_row.description_review_status is not null then
      update public.companies
         set description_pending = null, description_review_status = null,
             description_pending_at = null, description_review_reason = null,
             description_locale_pending = null, updated_at = now()
       where id = p_company_id;
    end if;
    if v_new is not null and v_locale is distinct from v_row.description_locale then
      perform public.set_company_description_locale(p_company_id, v_locale);
      return 'locale_applied';
    end if;
    return 'unchanged';
  end if;

  -- 2) Usunięcie opisu — nic nowego nie publikuje, wchodzi od razu (trigger zeruje język).
  if v_new is null then
    update public.companies
       set description = null,
           description_pending = null, description_review_status = null,
           description_pending_at = null, description_review_reason = null,
           description_locale_pending = null, updated_at = now()
     where id = p_company_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.description_removed', 'company', p_company_id,
            jsonb_build_object('had_description', true), jsonb_build_object('had_description', false));
    return 'applied';
  end if;

  -- 3) Nowy tekst: propozycja do decyzji. Ta sama oczekująca propozycja = bez zmian (retry);
  --    inny język przy tym samym tekście tylko poprawia język propozycji (czas zgłoszenia bez zmian).
  if v_row.description_review_status = 'pending' and v_new = v_row.description_pending then
    if v_locale is distinct from v_row.description_locale_pending then
      update public.companies
         set description_locale_pending = v_locale, updated_at = now()
       where id = p_company_id;
    end if;
    return 'pending';
  end if;

  update public.companies
     set description_pending = v_new, description_review_status = 'pending',
         description_pending_at = date_trunc('milliseconds', clock_timestamp()),
         description_review_reason = null, description_locale_pending = v_locale, updated_at = now()
   where id = p_company_id;

  -- Audyt bez treści opisu (długość i język).
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.description_submitted', 'company', p_company_id,
          jsonb_build_object('length', coalesce(char_length(v_approved), 0)),
          jsonb_build_object('length', char_length(v_new), 'description_locale', v_locale));
  return 'pending';
end $$;

revoke all on function public.submit_company_description(uuid, text, text) from public, anon;
grant execute on function public.submit_company_description(uuid, text, text) to authenticated;

-- Decyzja admina (0198) + język: akceptacja przenosi język propozycji, odrzucenie go nie rusza.
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
           description_locale_pending = null,
           description_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
    -- Osobny zapis języka: trigger `trg_reset_company_description_locale` zeruje język przy
    -- zmianie treści, więc język propozycji wpisujemy po tekście (sama zmiana języka nie jest
    -- zmianą treści). Propozycja bez języka = język nieznany.
    if v_row.description_locale_pending is not null then
      update public.companies
         set description_locale = v_row.description_locale_pending
       where id = p_company_id;
    end if;
  else
    update public.companies
       set description_review_status = 'rejected', description_review_reason = v_reason,
           description_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.description_reviewed', 'company', p_company_id,
          jsonb_build_object('length', char_length(v_row.description_pending)),
          jsonb_strip_nulls(jsonb_build_object('decision', p_decision, 'reason', v_reason,
            'description_locale', case when p_decision = 'approved' then v_row.description_locale_pending end)));

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
