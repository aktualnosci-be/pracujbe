-- =============================================================================
-- 0204_company_links_review.sql — strona WWW i logo firmy z zatwierdzaniem przez admina.
-- (Numer tymczasowy — ostateczny nada integrator.)
--
-- Stan przed: 0141 (#632) pozwalał owner/admin firmy zapisać `companies.website`/`logo_url`
-- bezpośrednim UPDATE pod RLS, a oba pola od razu trafiały do danych publicznych
-- (`get_public_job` → JobPosting `hiringOrganization.sameAs`/`logo`, 0114; `get_public_company`
-- → profil firmy i Organization JSON-LD, 0140). Link na stronie zweryfikowanej firmy nie
-- przechodził przez żadną kontrolę człowieka.
--
-- Teraz:
--   1. `website`/`logo_url` = wartości ZATWIERDZONE (jedyne czytane publicznie — RPC 0114/0140
--      bez zmian). Propozycja firmy czeka w `website_pending`/`logo_url_pending` (para = stan
--      docelowy obu pól, NULL = brak adresu) ze stanem `links_review_status`
--      (`pending` / `rejected`, NULL = brak propozycji), czasem zgłoszenia `links_pending_at`
--      (klucz CAS decyzji) i uzasadnieniem odrzucenia `links_review_reason`.
--   2. Strażnik `guard_company_links`: klient (anon/authenticated) nie zmienia żadnej z tych
--      kolumn bezpośrednio — ani przez UPDATE (RLS 0040 dopuszcza owner/admin do wiersza), ani
--      przez INSERT. Piszą wyłącznie funkcje SECURITY DEFINER poniżej (jak `guard_job_publish`).
--   3. `submit_company_links` (owner/admin firmy): propozycja identyczna z zatwierdzonym stanem
--      = wycofanie propozycji (`unchanged`); propozycja, która tylko USUWA albo zostawia adresy
--      (żaden nowy adres), wchodzi od razu (`applied`) — usunięcie linku niczego nie publikuje;
--      każdy nowy adres = propozycja do decyzji (`pending`). Idempotentne.
--   4. `admin_decide_company_links` (tylko admin): CAS po `links_pending_at` (`STALE_STATE`,
--      gdy firma w międzyczasie zmieniła propozycję), akceptacja przenosi parę do pól
--      publicznych, odrzucenie wymaga uzasadnienia (≤ 1000, jak 0084) i zostawia propozycję do
--      wglądu firmy. Powiadomienie in-app każdego aktywnego właściciela (`system`,
--      `data.kind = 'company_links'`) + audyt `company.links_reviewed`.
--   5. `audit_company_change` bez zmian (0141): przeniesienie do pól publicznych nadal daje
--      `company.links_changed` z wartościami przed/po.
--
-- Zmiana linków nadal NIE cofa weryfikacji firmy (`protect_company_verification`, 0072).
-- Dowód: `supabase/tests/rls.sql` sekcja CLR204 (kontrole ujemne).
--
-- Rollback (ręczny):
--   drop function if exists public.admin_decide_company_links(uuid, text, timestamptz, text);
--   drop function if exists public.submit_company_links(uuid, boolean, text, boolean, text);
--   drop trigger if exists trg_guard_company_links on public.companies;
--   drop function if exists public.guard_company_links();
--   alter table public.companies drop column if exists website_pending, …(kolumny z pkt 1).
-- =============================================================================

alter table public.companies
  add column if not exists website_pending text,
  add column if not exists logo_url_pending text,
  add column if not exists links_review_status text,
  add column if not exists links_pending_at timestamptz,
  add column if not exists links_review_reason text,
  add column if not exists links_reviewed_at timestamptz;

alter table public.companies drop constraint if exists companies_website_pending_https;
alter table public.companies add constraint companies_website_pending_https
  check (website_pending is null or public.public_https_url(website_pending) is not null);

alter table public.companies drop constraint if exists companies_logo_url_pending_https;
alter table public.companies add constraint companies_logo_url_pending_https
  check (logo_url_pending is null or public.public_https_url(logo_url_pending) is not null);

alter table public.companies drop constraint if exists companies_links_review_status_check;
alter table public.companies add constraint companies_links_review_status_check
  check (links_review_status is null or links_review_status in ('pending', 'rejected'));

-- Stan spójny: oczekująca propozycja ma czas zgłoszenia; odrzucona ma uzasadnienie.
alter table public.companies drop constraint if exists companies_links_review_state_check;
alter table public.companies add constraint companies_links_review_state_check
  check (
    (links_review_status is null and links_review_reason is null)
    or (links_review_status = 'pending' and links_pending_at is not null and links_review_reason is null)
    or (links_review_status = 'rejected' and links_review_reason is not null
        and char_length(links_review_reason) between 1 and 1000)
  );

-- Kolejka admina: firmy z propozycją do decyzji, najstarsze pierwsze.
create index if not exists idx_companies_links_pending
  on public.companies (links_pending_at, id)
  where links_review_status = 'pending' and deleted_at is null;

-- --- Strażnik: kolumny linków tylko przez funkcje SECURITY DEFINER ------------------------
create or replace function public.guard_company_links()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.website is not null or new.logo_url is not null
       or new.website_pending is not null or new.logo_url_pending is not null
       or new.links_review_status is not null or new.links_pending_at is not null
       or new.links_review_reason is not null or new.links_reviewed_at is not null then
      raise exception 'PERMISSION_DENIED: strona WWW i logo firmy tylko przez submit_company_links'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.website is distinct from old.website
     or new.logo_url is distinct from old.logo_url
     or new.website_pending is distinct from old.website_pending
     or new.logo_url_pending is distinct from old.logo_url_pending
     or new.links_review_status is distinct from old.links_review_status
     or new.links_pending_at is distinct from old.links_pending_at
     or new.links_review_reason is distinct from old.links_review_reason
     or new.links_reviewed_at is distinct from old.links_reviewed_at then
    raise exception 'PERMISSION_DENIED: strona WWW i logo firmy tylko przez submit_company_links'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_company_links on public.companies;
create trigger trg_guard_company_links
  before insert or update on public.companies
  for each row execute function public.guard_company_links();

-- --- Zgłoszenie propozycji przez firmę -----------------------------------------------------
-- p_set_* = false → pole bez zmian względem bieżącej propozycji (albo zatwierdzonego stanu,
-- gdy propozycji nie ma). Pusty tekst = brak adresu. Zwraca `unchanged` | `applied` | `pending`.
create or replace function public.submit_company_links(
  p_company_id uuid,
  p_set_website boolean,
  p_website text,
  p_set_logo_url boolean,
  p_logo_url text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_base_website text;
  v_base_logo text;
  v_website text;
  v_logo text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  select * into v_row from public.companies
    where id = p_company_id and deleted_at is null
    for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED: strona WWW i logo — tylko owner/admin firmy' using errcode = '42501';
  end if;

  -- Punkt wyjścia: bieżąca propozycja (oczekująca albo odrzucona — firma ją poprawia),
  -- inaczej zatwierdzony stan.
  if v_row.links_review_status is not null then
    v_base_website := v_row.website_pending;
    v_base_logo := v_row.logo_url_pending;
  else
    v_base_website := v_row.website;
    v_base_logo := v_row.logo_url;
  end if;

  v_website := case when coalesce(p_set_website, false)
                    then nullif(btrim(coalesce(p_website, '')), '') else v_base_website end;
  v_logo := case when coalesce(p_set_logo_url, false)
                 then nullif(btrim(coalesce(p_logo_url, '')), '') else v_base_logo end;

  if v_website is not null and public.public_https_url(v_website) is null then
    raise exception 'VALIDATION_FAILED: WEBSITE_INVALID' using errcode = '22023';
  end if;
  if v_logo is not null and public.public_https_url(v_logo) is null then
    raise exception 'VALIDATION_FAILED: LOGO_URL_INVALID' using errcode = '22023';
  end if;

  -- 1) Propozycja = zatwierdzony stan: wycofanie propozycji (także odrzuconej).
  if v_website is not distinct from v_row.website and v_logo is not distinct from v_row.logo_url then
    if v_row.links_review_status is not null then
      update public.companies
         set website_pending = null, logo_url_pending = null, links_review_status = null,
             links_pending_at = null, links_review_reason = null, updated_at = now()
       where id = p_company_id;
    end if;
    return 'unchanged';
  end if;

  -- 2) Tylko usunięcie/bez zmian (żaden NOWY adres) — wchodzi od razu, bez decyzji admina.
  if (v_website is null or v_website is not distinct from v_row.website)
     and (v_logo is null or v_logo is not distinct from v_row.logo_url) then
    update public.companies
       set website = v_website, logo_url = v_logo,
           website_pending = null, logo_url_pending = null, links_review_status = null,
           links_pending_at = null, links_review_reason = null, updated_at = now()
     where id = p_company_id;
    return 'applied';
  end if;

  -- 3) Nowy adres: propozycja do decyzji. Ta sama oczekująca propozycja = bez zmian (retry).
  if v_row.links_review_status = 'pending'
     and v_website is not distinct from v_row.website_pending
     and v_logo is not distinct from v_row.logo_url_pending then
    return 'pending';
  end if;

  update public.companies
     set website_pending = v_website, logo_url_pending = v_logo,
         links_review_status = 'pending', links_pending_at = date_trunc('milliseconds', clock_timestamp()),
         links_review_reason = null, updated_at = now()
   where id = p_company_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.links_submitted', 'company', p_company_id,
          jsonb_build_object('website', v_row.website, 'logo_url', v_row.logo_url),
          jsonb_build_object('website', v_website, 'logo_url', v_logo));
  return 'pending';
end $$;

revoke all on function public.submit_company_links(uuid, boolean, text, boolean, text) from public, anon;
grant execute on function public.submit_company_links(uuid, boolean, text, boolean, text) to authenticated;

-- --- Decyzja admina ------------------------------------------------------------------------
create or replace function public.admin_decide_company_links(
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

  if v_row.links_review_status is distinct from 'pending'
     or p_expected_pending_at is null
     or v_row.links_pending_at is distinct from p_expected_pending_at then
    raise exception 'STALE_STATE: propozycja linków firmy zmieniła się albo już rozstrzygnięta'
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
       set website = v_row.website_pending, logo_url = v_row.logo_url_pending,
           website_pending = null, logo_url_pending = null, links_review_status = null,
           links_pending_at = null, links_review_reason = null,
           links_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
  else
    update public.companies
       set links_review_status = 'rejected', links_review_reason = v_reason,
           links_reviewed_at = now(), updated_at = now()
     where id = p_company_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'company.links_reviewed', 'company', p_company_id,
          jsonb_build_object('website', v_row.website_pending, 'logo_url', v_row.logo_url_pending),
          jsonb_strip_nulls(jsonb_build_object('decision', p_decision, 'reason', v_reason)));

  for v_owner in
    select cm.profile_id
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.role = 'owner'
       and public.company_recipient_ok(p_company_id, cm.profile_id)
  loop
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
    values (v_owner, 'system'::public.notification_type, 'company_links_reviewed',
            'company', p_company_id,
            jsonb_build_object('kind', 'company_links', 'status', p_decision));
  end loop;
end $$;

revoke all on function public.admin_decide_company_links(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_decide_company_links(uuid, text, timestamptz, text) to authenticated;
