-- =============================================================================
-- 0023_audit_remediation_3.sql
-- Remediacja WERYFIKACJI (wave 11) — domknięcie ustaleń wykrytych przy adwersaryjnej
-- kontroli poprzedniej fali napraw:
--   P2 (RLS/PII) — get_conversation_summaries() zwracało nazwę drugiej strony konwersacji
--        (first_name||last_name) bezwarunkowo. Funkcja jest SECURITY DEFINER i grant dla
--        `authenticated`, więc omija RLS na profiles — kandydat wołający RPC wprost
--        (supabase.rpc('get_conversation_summaries')) uzyskiwał realne imię+nazwisko
--        rekrutera, którego model prywatności celowo NIE ujawnia (kandydat widzi tylko
--        nazwę firmy). Kolumna była NIEUŻYWANA w app-layer (messages.ts rozwiązuje drugą
--        stronę osobno POD RLS). Usuwamy kolumnę z kontraktu (minimalna, bezpieczna zmiana).
--   P3 (correctness/UX) — getMyApplications wzbogacał aplikacje mapą get_public_jobs
--        (tylko active+verified, top-N), więc aplikacje do ofert zamkniętych/wstrzymanych/
--        wygasłych albo spoza top-N miały puste tytuł/firmę. Kandydat ma prawo widzieć
--        ofertę, do której aplikował — dodajemy dedykowane RPC ograniczone do WŁASNYCH
--        aplikacji (auth.uid()), niezależne od statusu oferty.
-- =============================================================================

-- --- P2: podsumowania konwersacji BEZ nazwy drugiej strony ---------------------
-- Zmiana kontraktu RETURNS TABLE wymaga DROP + CREATE (nie CREATE OR REPLACE).
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

-- --- P3: bezpieczne dane ofert dla WŁASNYCH aplikacji kandydata ----------------
-- Zwraca tytuł/firmę/slug/miasto dla ofert, do których zalogowany kandydat aplikował,
-- NIEZALEŻNIE od statusu oferty/firmy (kandydat jest do nich autoryzowany przez fakt
-- aplikacji). Autoryzacja przez konstrukcję: wyłącznie wiersze applications = auth.uid().
-- Kolumny prywatne firmy (VAT/kontakt) NIE są zwracane.
create or replace function public.get_applied_jobs_display(p_locale text default 'pl')
returns table (
  job_id uuid,
  slug text,
  title text,
  company_name text,
  city text
) language sql stable security definer set search_path = public as $$
  select distinct on (j.id)
    j.id,
    j.slug,
    coalesce(t.title, j.title) as title,
    coalesce(c.name, '') as company_name,
    j.city
  from public.applications a
  join public.jobs j on j.id = a.job_id
  left join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = p_locale) desc, (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where a.candidate_id = auth.uid()
    and a.deleted_at is null;
$$;
revoke all on function public.get_applied_jobs_display(text) from public;
grant execute on function public.get_applied_jobs_display(text) to authenticated;
