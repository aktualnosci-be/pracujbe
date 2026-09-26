-- =============================================================================
-- 0144_company_links_review.sql — strona WWW i logo firmy publiczne dopiero po akceptacji
-- administratora (decyzja właściciela 26.09.2026, „linki do zatwierdzenia”).
--
-- Numer tymczasowy — ostateczny nada integrator.
--
-- 0141 pozwoliło owner/admin firmy ustawić `companies.website`/`logo_url` (bezwzględny
-- https, CHECK). Te kolumny czytają publiczne odczyty (`get_public_job` → JSON-LD
-- hiringOrganization.sameAs/logo, `get_public_company` → profil `/pracodawcy/<slug>`), więc
-- nowy adres był publiczny od razu. Teraz:
--
--   1. Nowy adres od firmy trafia do `website_pending`/`logo_url_pending` (ten sam CHECK
--      `public_https_url`), a publiczne `website`/`logo_url` zmienia WYŁĄCZNIE
--      `admin_review_company_link` (is_admin, CAS po oczekującej wartości, audyt
--      `company.link_reviewed`). Publiczne funkcje czytają tylko `website`/`logo_url`, więc
--      niezatwierdzony link nigdy nie wycieka — bez ich zmiany.
--   2. Strażnik `protect_company_links` (BEFORE INSERT/UPDATE, każda ścieżka zapisu pod
--      sesją): niepusty nowy adres w `website`/`logo_url` = zgłoszenie do akceptacji
--      (wartość przechodzi do `*_pending`, publiczna zostaje); wyczyszczenie = natychmiastowe
--      usunięcie linku i zgłoszenia (usunięcie niczego nie ujawnia); uzasadnienie odrzucenia
--      i znaczniki czasu ustala baza. Backend (auth.uid() null: migracje, seed, service_role)
--      i kontekst akceptacji omijają przekierowanie.
--   3. Adresy zapisane przed tą migracją zostają publiczne (były już widoczne).
--   4. Audyt `company.links_changed` obejmuje też zmianę zgłoszeń.
--
-- Status weryfikacji firmy bez zmian (jak w 0141).
--
-- Rollback:
--   drop function if exists public.admin_review_company_link(uuid, text, text, text, text);
--   drop trigger if exists companies_protect_links on public.companies;
--   drop function if exists public.protect_company_links();
--   odtworzyć audit_company_change z 0141;
--   alter table public.companies drop constraint if exists companies_website_pending_https,
--     drop constraint if exists companies_logo_url_pending_https,
--     drop constraint if exists companies_link_rejection_len,
--     drop column website_pending, drop column logo_url_pending,
--     drop column website_pending_at, drop column logo_url_pending_at,
--     drop column website_rejection_reason, drop column logo_url_rejection_reason;
-- =============================================================================

alter table public.companies
  add column if not exists website_pending text,
  add column if not exists logo_url_pending text,
  add column if not exists website_pending_at timestamptz,
  add column if not exists logo_url_pending_at timestamptz,
  add column if not exists website_rejection_reason text,
  add column if not exists logo_url_rejection_reason text;

alter table public.companies drop constraint if exists companies_website_pending_https;
alter table public.companies add constraint companies_website_pending_https
  check (website_pending is null or public.public_https_url(website_pending) is not null);

alter table public.companies drop constraint if exists companies_logo_url_pending_https;
alter table public.companies add constraint companies_logo_url_pending_https
  check (logo_url_pending is null or public.public_https_url(logo_url_pending) is not null);

alter table public.companies drop constraint if exists companies_link_rejection_len;
alter table public.companies add constraint companies_link_rejection_len
  check ((website_rejection_reason is null or char_length(website_rejection_reason) <= 1000)
     and (logo_url_rejection_reason is null or char_length(logo_url_rejection_reason) <= 1000));

-- --- Strażnik: publiczny link zmienia tylko akceptacja admina --------------------------
create or replace function public.protect_company_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('pracujbe.company_link_review', true), '') = new.id::text then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.website_pending := coalesce(new.website_pending, new.website);
    new.logo_url_pending := coalesce(new.logo_url_pending, new.logo_url);
    new.website := null;
    new.logo_url := null;
    new.website_rejection_reason := null;
    new.logo_url_rejection_reason := null;
    new.website_pending_at := case when new.website_pending is not null then now() end;
    new.logo_url_pending_at := case when new.logo_url_pending is not null then now() end;
    return new;
  end if;

  if new.website_rejection_reason is distinct from old.website_rejection_reason
     or new.logo_url_rejection_reason is distinct from old.logo_url_rejection_reason then
    raise exception 'PERMISSION_DENIED: decyzję o linkach firmy podejmuje administrator'
      using errcode = '42501';
  end if;

  -- Strona WWW
  if new.website is distinct from old.website then
    if new.website is null then
      new.website_pending := null;          -- usunięcie linku: od razu, bez akceptacji
    else
      new.website_pending := new.website;   -- nowy adres: do akceptacji
      new.website := old.website;
    end if;
  end if;
  if new.website_pending is not distinct from new.website then
    new.website_pending := null;
  end if;
  if new.website_pending is distinct from old.website_pending then
    new.website_pending_at := case when new.website_pending is not null then now() end;
    new.website_rejection_reason := null;
  else
    new.website_pending_at := old.website_pending_at;
  end if;

  -- Logo
  if new.logo_url is distinct from old.logo_url then
    if new.logo_url is null then
      new.logo_url_pending := null;
    else
      new.logo_url_pending := new.logo_url;
      new.logo_url := old.logo_url;
    end if;
  end if;
  if new.logo_url_pending is not distinct from new.logo_url then
    new.logo_url_pending := null;
  end if;
  if new.logo_url_pending is distinct from old.logo_url_pending then
    new.logo_url_pending_at := case when new.logo_url_pending is not null then now() end;
    new.logo_url_rejection_reason := null;
  else
    new.logo_url_pending_at := old.logo_url_pending_at;
  end if;

  return new;
end $$;

drop trigger if exists companies_protect_links on public.companies;
create trigger companies_protect_links
  before insert or update on public.companies
  for each row execute function public.protect_company_links();

revoke all on function public.protect_company_links() from public, anon, authenticated;

-- --- Audyt: zmiana linków publicznych i zgłoszeń ---------------------------------------
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
  elsif tg_op = 'UPDATE'
    and (new.website is distinct from old.website or new.logo_url is distinct from old.logo_url
         or new.website_pending is distinct from old.website_pending
         or new.logo_url_pending is distinct from old.logo_url_pending) then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.links_changed', 'company', new.id,
            jsonb_build_object('website', old.website, 'logo_url', old.logo_url,
                               'website_pending', old.website_pending,
                               'logo_url_pending', old.logo_url_pending),
            jsonb_build_object('website', new.website, 'logo_url', new.logo_url,
                               'website_pending', new.website_pending,
                               'logo_url_pending', new.logo_url_pending));
  end if;
  return new;
end $$;

-- --- Decyzja admina: zatwierdzenie/odrzucenie oczekującego linku -----------------------
-- CAS: `p_expected_value` = oczekujący adres widziany przez admina; inny (firma zmieniła
-- zgłoszenie w międzyczasie) albo brak zgłoszenia → STALE_STATE. Zatwierdzenie przenosi adres
-- do publicznej kolumny, odrzucenie usuwa zgłoszenie i zapisuje uzasadnienie (widoczne dla
-- firmy w `/employer/firma`).
create or replace function public.admin_review_company_link(
  p_company_id uuid,
  p_field text,
  p_decision text,
  p_expected_value text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company public.companies%rowtype;
  v_pending text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'PERMISSION_DENIED: tylko administrator' using errcode = '42501';
  end if;
  if p_company_id is null or p_expected_value is null
     or p_field is null or p_field not in ('website', 'logo_url')
     or p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  select * into v_company from public.companies
   where id = p_company_id and deleted_at is null
   for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_pending := case p_field when 'website' then v_company.website_pending
                            else v_company.logo_url_pending end;
  if v_pending is null or v_pending is distinct from p_expected_value then
    raise exception 'STALE_STATE' using errcode = '40001';
  end if;

  perform set_config('pracujbe.company_link_review', p_company_id::text, true);
  if p_field = 'website' then
    update public.companies set
      website = case when p_decision = 'approve' then v_pending else website end,
      website_pending = null,
      website_pending_at = null,
      website_rejection_reason = case when p_decision = 'reject' then v_reason end
    where id = p_company_id;
  else
    update public.companies set
      logo_url = case when p_decision = 'approve' then v_pending else logo_url end,
      logo_url_pending = null,
      logo_url_pending_at = null,
      logo_url_rejection_reason = case when p_decision = 'reject' then v_reason end
    where id = p_company_id;
  end if;
  perform set_config('pracujbe.company_link_review', '', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.link_reviewed', 'company', p_company_id,
          jsonb_build_object('field', p_field, 'value', v_pending),
          jsonb_strip_nulls(jsonb_build_object('field', p_field, 'decision', p_decision,
                                               'reason', v_reason)));

  return jsonb_build_object('company_id', p_company_id, 'field', p_field, 'decision', p_decision);
end $$;

revoke all on function public.admin_review_company_link(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_review_company_link(uuid, text, text, text, text) to authenticated;
