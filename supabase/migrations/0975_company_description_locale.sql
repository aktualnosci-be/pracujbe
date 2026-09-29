-- =============================================================================
-- 0975_company_description_locale.sql — #708: język opisu firmy na publicznym profilu.
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
-- Bez tłumaczeń opisu (wymagałyby zatwierdzania — osobny etap, plan #31); strona oznacza język
-- opisu (`lang`) i informuje, gdy różni się od języka strony albo jest nieznany.
--
-- Rollback: supabase/rollback/0975_company_description_locale.down.sql (test w test-rls.sh).
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
