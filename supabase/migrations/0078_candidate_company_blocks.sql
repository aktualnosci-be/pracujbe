-- =============================================================================
-- 0078 — kandydat blokuje firmę (#97, Invariant #5, sekcja 6 CLAUDE.md).
--
-- Model: `candidate_company_blocks` (kandydat × firma). Zapis wyłącznie przez RPC
-- `set_company_block`; odczyt własnych blokad przez RPC `get_my_company_blocks` /
-- `get_job_company_block` oraz politykę SELECT „tylko swoje". Firma NIE ma żadnej
-- ścieżki odczytu tabeli — o blokadzie nie dowiaduje się wprost.
--
-- Egzekwowanie w bazie (blokada zablokowanej firmy, dla każdej ścieżki klienta):
--   * company_can_view_candidate — relacja (aplikacja/propozycja) z firmą zablokowaną
--     nie daje już wglądu w profil/PII (profiles, candidate_profiles, relacje profilu);
--   * wyszukiwanie: candidate_profiles_select_employer + candidate_profile_is_searchable
--     pomijają kandydata, gdy przeglądający jest aktywnym członkiem firmy zablokowanej
--     (także wejście po ID);
--   * matches: firma nie widzi dopasowań kandydata do swoich ofert;
--   * propozycje / nowe rozmowy / wiadomości: triggery BEFORE INSERT odrzucają zapis
--     tym samym neutralnym błędem, co brak relacji/uprawnień (bez „zablokowano");
--   * polecane oferty kandydata: get_public_jobs_by_ids pomija oferty firm, które
--     wywołujący kandydat zablokował. Publiczny URL oferty pozostaje dostępny.
-- Historia (aplikacje, rozmowy, wiadomości, historia statusów, audyt) zostaje nietknięta.
-- Kandydat nadal może sam napisać w istniejącej rozmowie i odblokować firmę.
--
-- Rollback: drop triggerów trg_*_candidate_block, przywrócenie definicji z 0033
-- (company_can_view_candidate), 0013 (candidate_profile_is_searchable, polityka
-- candidate_profiles_select_employer), 0039 (matches_select), 0074
-- (get_public_jobs_by_ids), drop funkcji i tabeli candidate_company_blocks.
-- =============================================================================

create table if not exists public.candidate_company_blocks (
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (candidate_id, company_id)
);
create index if not exists candidate_company_blocks_company_idx
  on public.candidate_company_blocks (company_id);

alter table public.candidate_company_blocks enable row level security;
alter table public.candidate_company_blocks force row level security;

revoke all on public.candidate_company_blocks from public, anon, authenticated;
grant select on public.candidate_company_blocks to authenticated;

drop policy if exists candidate_company_blocks_select_own on public.candidate_company_blocks;
create policy candidate_company_blocks_select_own on public.candidate_company_blocks
  for select to authenticated
  using (candidate_id = auth.uid());

-- --- Helpery ------------------------------------------------------------------
-- Wewnętrzny: czy kandydat zablokował firmę. Tylko dla funkcji SECURITY DEFINER
-- i triggerów (bez EXECUTE dla klienta — brak bezpośredniej wyroczni blokad).
create or replace function public.candidate_blocked_company(p_candidate uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.candidate_company_blocks b
    where b.candidate_id = p_candidate and b.company_id = p_company
  );
$$;
revoke all on function public.candidate_blocked_company(uuid, uuid) from public, anon, authenticated;

-- Dla polityk RLS: czy kandydat zablokował którąkolwiek firmę, w której wywołujący
-- jest aktywnym członkiem. Odpowiada wyłącznie w kontekście własnych firm wywołującego.
create or replace function public.candidate_blocks_viewer(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.candidate_company_blocks b
    join public.company_members cm on cm.company_id = b.company_id
    where b.candidate_id = p_candidate
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;
revoke all on function public.candidate_blocks_viewer(uuid) from public, anon;
grant execute on function public.candidate_blocks_viewer(uuid) to authenticated;

-- Dla polityki matches: blokada firmy danej oferty, tylko gdy wywołujący nią zarządza.
create or replace function public.candidate_blocked_job_company(p_candidate uuid, p_job uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_job_manager(p_job) and exists (
    select 1
    from public.jobs j
    join public.candidate_company_blocks b on b.company_id = j.company_id
    where j.id = p_job and b.candidate_id = p_candidate
  );
$$;
revoke all on function public.candidate_blocked_job_company(uuid, uuid) from public, anon;
grant execute on function public.candidate_blocked_job_company(uuid, uuid) to authenticated;

-- --- Widoczność profilu/PII -----------------------------------------------------
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.applications a
    join public.company_members cm on cm.company_id = a.company_id
    where a.candidate_id = p_profile_id
      and a.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
      and not public.candidate_blocked_company(p_profile_id, a.company_id)
  ) or exists (
    select 1
    from public.offers o
    join public.company_members cm on cm.company_id = o.company_id
    where o.candidate_id = p_profile_id
      and o.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'recruiter')
      and not public.candidate_blocked_company(p_profile_id, o.company_id)
  );
$$;

create or replace function public.candidate_profile_is_searchable(p_candidate_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.candidate_profiles cp
    where cp.id = p_candidate_profile_id
      and cp.is_searchable = true
      and cp.profile_completed = true
      and cp.deleted_at is null
      and not public.candidate_blocks_viewer(cp.profile_id)
  ) and public.current_user_has_verified_company();
$$;

drop policy if exists candidate_profiles_select_employer on public.candidate_profiles;
create policy candidate_profiles_select_employer on public.candidate_profiles
  for select to authenticated
  using (
    is_searchable = true
    and profile_completed = true
    and deleted_at is null
    and public.current_user_has_verified_company()
    and not public.candidate_blocks_viewer(profile_id)
  );

-- --- Dopasowania ------------------------------------------------------------------
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (
    candidate_id = auth.uid()
    or (public.is_job_manager(job_id)
        and not public.candidate_blocked_job_company(candidate_id, job_id))
  );

-- --- Propozycje, rozmowy, wiadomości: neutralna odmowa ---------------------------
-- Komunikat identyczny z brakiem relacji w send_offer — firma nie odróżni blokady.
create or replace function public.guard_offer_candidate_block()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  select j.company_id into v_company from public.jobs j where j.id = new.job_id;
  if v_company is not null and public.candidate_blocked_company(new.candidate_id, v_company) then
    raise exception 'PERMISSION_DENIED: brak relacji firma–kandydat dla propozycji' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_offer_candidate_block() from public, anon, authenticated;

drop trigger if exists trg_offer_candidate_block on public.offers;
create trigger trg_offer_candidate_block
  before insert on public.offers
  for each row execute function public.guard_offer_candidate_block();

-- Kandydat rozmowy firmowej = kandydat aplikacji albo propozycji.
create or replace function public.conversation_candidate(p_application_id uuid, p_offer_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select a.candidate_id from public.applications a where a.id = p_application_id),
    (select o.candidate_id from public.offers o where o.id = p_offer_id)
  );
$$;
revoke all on function public.conversation_candidate(uuid, uuid) from public, anon, authenticated;

-- Nowa rozmowa zakładana przez stronę firmową z kandydatem, który ją zablokował.
create or replace function public.guard_conversation_candidate_block()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_candidate uuid;
begin
  if new.company_id is null then return new; end if;
  v_candidate := public.conversation_candidate(new.application_id, new.offer_id);
  if v_candidate is not null
     and new.created_by is distinct from v_candidate
     and public.candidate_blocked_company(v_candidate, new.company_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_conversation_candidate_block() from public, anon, authenticated;

drop trigger if exists trg_conversation_candidate_block on public.conversations;
create trigger trg_conversation_candidate_block
  before insert on public.conversations
  for each row execute function public.guard_conversation_candidate_block();

-- Nowa wiadomość od strony firmowej w rozmowie z kandydatem, który zablokował firmę.
-- Wiadomości kandydata przechodzą (to on decyduje o kontakcie).
create or replace function public.guard_message_candidate_block()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_candidate uuid;
begin
  select c.company_id, public.conversation_candidate(c.application_id, c.offer_id)
    into v_company, v_candidate
    from public.conversations c where c.id = new.conversation_id;
  if v_company is not null and v_candidate is not null
     and new.sender_id is distinct from v_candidate
     and public.candidate_blocked_company(v_candidate, v_company) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_message_candidate_block() from public, anon, authenticated;

drop trigger if exists trg_message_candidate_block on public.messages;
create trigger trg_message_candidate_block
  before insert on public.messages
  for each row execute function public.guard_message_candidate_block();

-- --- Polecane oferty kandydata (0074 + pominięcie firm zablokowanych przez wywołującego)
create or replace function public.get_public_jobs_by_ids(
  p_ids    uuid[],
  p_locale text default 'pl'
)
returns table (id uuid, slug text, title text, company_name text, city text)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    j.city
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  -- Twardy sufit: najwyżej 100 identyfikatorów na wywołanie.
  where j.id = any(p_ids[1:100])
    and j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    -- Gość (auth.uid() null) nie ma blokad; kandydat nie dostaje ofert firm zablokowanych.
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
  order by j.id;
$$;
revoke all on function public.get_public_jobs_by_ids(uuid[], text) from public;
grant execute on function public.get_public_jobs_by_ids(uuid[], text) to anon, authenticated;

-- --- RPC kandydata ------------------------------------------------------------------
-- Zablokuj / odblokuj firmę (idempotentnie). Zwraca stan po operacji.
create or replace function public.set_company_block(p_company_id uuid, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'candidate') then
    raise exception 'PERMISSION_DENIED: blokada firm tylko dla kandydata' using errcode = '42501';
  end if;
  if p_company_id is null or p_blocked is null then
    raise exception 'VALIDATION_FAILED' using errcode = '42501';
  end if;

  if p_blocked then
    if not exists (select 1 from public.companies c where c.id = p_company_id and c.deleted_at is null) then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.candidate_company_blocks (candidate_id, company_id)
      values (v_uid, p_company_id)
      on conflict (candidate_id, company_id) do nothing;
  else
    delete from public.candidate_company_blocks
      where candidate_id = v_uid and company_id = p_company_id;
  end if;
  return p_blocked;
end $$;
revoke all on function public.set_company_block(uuid, boolean) from public, anon;
grant execute on function public.set_company_block(uuid, boolean) to authenticated;

-- Lista własnych blokad z nazwą firmy (ustawienia kandydata).
create or replace function public.get_my_company_blocks()
returns table (company_id uuid, company_name text, blocked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.company_id, c.name, b.created_at
  from public.candidate_company_blocks b
  join public.companies c on c.id = b.company_id
  where b.candidate_id = auth.uid()
  order by b.created_at desc, b.company_id;
$$;
revoke all on function public.get_my_company_blocks() from public, anon;
grant execute on function public.get_my_company_blocks() to authenticated;

-- Stan blokady firmy publicznej oferty (szczegół oferty). Tylko dla kandydata;
-- inni wywołujący i oferty niepubliczne → brak wiersza.
create or replace function public.get_job_company_block(p_job_id uuid)
returns table (company_id uuid, company_name text, blocked boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.company_id, c.name,
         public.candidate_blocked_company(auth.uid(), j.company_id)
  from public.jobs j
  join public.companies c on c.id = j.company_id
  where j.id = p_job_id
    and public.job_is_public(j.id)
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'candidate');
$$;
revoke all on function public.get_job_company_block(uuid) from public, anon;
grant execute on function public.get_job_company_block(uuid) to authenticated;
