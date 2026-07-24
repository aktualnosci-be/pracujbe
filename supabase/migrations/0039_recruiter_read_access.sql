-- =============================================================================
-- 0039_recruiter_read_access.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-01/P1-02: ODCZYT danych rekrutacyjnych
-- i udział w rozmowach ograniczone do roli recruiter+ (owner/admin/recruiter).
--
-- P1-01: 0033 zamknął ZAPIS ofert i dostęp do PII do recruiter+, ale polityki ODCZYTU
--   applications/offers/matches (oraz historii) i helpery can_access_* nadal używały
--   „dowolnego aktywnego członka" (is_job_company_member/is_company_member). Zwykły `member`
--   mógł czytać telefon/wiadomość/dostępność/historię kandydatów. Domykamy przez is_job_manager
--   (recruiter+). Bezpośredni DML tych tabel jest i tak odebrany klientom (0025) — kluczowy jest
--   SELECT (klient czyta pod RLS).
--
-- P1-02: get_conversation_summaries (0023) czytało wprost z conversation_members po auth.uid(),
--   z pominięciem is_conversation_member — więc BYŁY członek (is_active=false) nadal dostawał
--   podgląd ostatnich wiadomości. Gejtujemy RPC przez is_conversation_member, a samą regułę
--   dostępu do rozmowy firmowej podnosimy do recruiter+ (zwykły member nie prowadzi rekrutacji).
-- =============================================================================

-- --- P1-01: helpery dostępu do aplikacji/propozycji → recruiter+ ----------------
create or replace function public.can_access_application(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.applications a
    where a.id = p_application_id
      and (a.candidate_id = auth.uid() or public.is_job_manager(a.job_id))
  );
$$;

create or replace function public.can_access_offer(p_offer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.offers o
    where o.id = p_offer_id
      and (o.candidate_id = auth.uid() or public.is_job_manager(o.job_id))
  );
$$;

-- --- P1-01: polityki ODCZYTU/UPDATE → recruiter+ (DML i tak RPC-only, 0025) ------
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id));

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id))
  with check (candidate_id = auth.uid() or public.is_job_manager(job_id));

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id));

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id));

drop policy if exists offers_update on public.offers;
create policy offers_update on public.offers
  for update to authenticated
  using (candidate_id = auth.uid() or public.is_job_manager(job_id))
  with check (candidate_id = auth.uid() or public.is_job_manager(job_id));

drop policy if exists offers_insert_company on public.offers;
create policy offers_insert_company on public.offers
  for insert to authenticated
  with check (public.is_job_manager(job_id));

drop policy if exists offers_delete_company on public.offers;
create policy offers_delete_company on public.offers
  for delete to authenticated
  using (public.is_job_manager(job_id));

-- --- P1-01/P1-02: rozmowy firmowe wymagają recruiter+; były członek traci dostęp -
-- Reguła: uczestnik ma dostęp, gdy jest w conversation_members ORAZ
--   * rozmowa nie jest firmowa (company_id null), LUB
--   * jest recruiter+ tej firmy (can_manage_jobs), LUB
--   * w ogóle NIE jest członkiem tej firmy (strona kandydata).
-- Blokujemy: nieaktywnego członka ORAZ aktywnego zwykłego `member` po stronie firmy.
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.profile_id = auth.uid()
      and (
        c.company_id is null
        or public.can_manage_jobs(c.company_id)
        or not exists (
          select 1 from public.company_members cm
          where cm.company_id = c.company_id and cm.profile_id = auth.uid()
        )
      )
  );
$$;

-- --- P1-02: podsumowania rozmów gejtowane bieżącym dostępem (nie historycznym) ---
drop function if exists public.get_conversation_summaries();
create function public.get_conversation_summaries()
returns table (
  conversation_id uuid,
  subject text,
  job_id uuid,
  offer_id uuid,
  application_id uuid,
  last_body text,
  last_at timestamptz,
  last_sender uuid,
  unread_count bigint
) language sql stable security definer set search_path = public as $$
  with my as (
    select cm.conversation_id, cm.last_read_at
    from public.conversation_members cm
    where cm.profile_id = auth.uid()
      and public.is_conversation_member(cm.conversation_id)  -- P1-02: tylko bieżący dostęp
  )
  select
    c.id, c.subject, c.job_id, c.offer_id, c.application_id,
    lm.body, lm.created_at, lm.sender_id,
    coalesce((
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.deleted_at is null
        and m2.sender_id <> auth.uid()
        and (my.last_read_at is null or m2.created_at > my.last_read_at)
    ), 0)
  from my
  join public.conversations c on c.id = my.conversation_id and c.deleted_at is null
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  order by c.last_message_at desc nulls last;
$$;
revoke all on function public.get_conversation_summaries() from public;
grant execute on function public.get_conversation_summaries() to authenticated;
