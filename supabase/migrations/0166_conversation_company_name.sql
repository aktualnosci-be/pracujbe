-- =============================================================================
-- 0166_conversation_company_name.sql
-- Etap 7 hardening (#25), otwarty punkt: „nazwa firmy w wiadomościach kandydata (od 0014)".
--
-- Od 0014 `companies` jest czytelne pod RLS tylko dla członków firmy
-- (`companies_select_member`) — publiczna polityka `companies_select_public` została zdjęta.
-- `/candidate/wiadomosci` (lista i wątek) próbowały doczytać nazwę firmy drugiej strony
-- WPROST z `companies` (`SELECT ... FROM public.companies WHERE id = ANY(...)`) pod sesją
-- kandydata — RLS zwracała zero wierszy, więc kandydat widział tylko neutralną etykietę
-- zastępczą zamiast nazwy firmy, mimo że ma prawo ją znać (jest stroną rozmowy).
--
-- Naprawa: dwie funkcje SECURITY DEFINER zwracają WYŁĄCZNIE `companies.name`, gejtowane tym
-- samym `is_conversation_member` co `get_conversation_summaries` (0021/0039) — a więc dokładnie
-- rozmowy, w których wywołujący jest bieżącym uczestnikiem. Imienia/nazwiska rekrutera nadal
-- NIE ujawniamy (decyzja 0023) — obie funkcje zwracają tylko kolumnę `name` firmy, nigdy profilu.
--
-- 1) `get_conversation_summaries()` — dodana kolumna `company_name` (lista konwersacji).
-- 2) `get_conversation_company_name(uuid)` — nazwa firmy JEDNEJ konwersacji (wątek/starsze
--    strony wiadomości), gdzie identyfikator firmy jest już znany z `conversations.company_id`
--    czytanego pod RLS, ale sama tabela `companies` nie jest.
-- =============================================================================

drop function if exists public.get_conversation_summaries();
create function public.get_conversation_summaries()
returns table (
  conversation_id uuid,
  subject text,
  job_id uuid,
  offer_id uuid,
  application_id uuid,
  company_name text,
  last_body text,
  last_at timestamptz,
  last_sender uuid,
  unread_count bigint
) language sql stable security definer set search_path = public, pg_temp as $$
  with my as (
    select cm.conversation_id, cm.last_read_at
    from public.conversation_members cm
    where cm.profile_id = auth.uid()
      and public.is_conversation_member(cm.conversation_id)  -- P1-02 (0039): tylko bieżący dostęp
  )
  select
    c.id, c.subject, c.job_id, c.offer_id, c.application_id,
    comp.name,
    lm.body, lm.created_at, lm.sender_id,
    coalesce((
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.deleted_at is null
        and m2.sender_id <> auth.uid()
        and (my.last_read_at is null or m2.created_at > my.last_read_at)
    ), 0)
  from my
  join public.conversations c on c.id = my.conversation_id and c.deleted_at is null
  left join public.companies comp on comp.id = c.company_id
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

-- --- Nazwa firmy jednej konwersacji (wątek / starsze wiadomości) -------------
create or replace function public.get_conversation_company_name(p_conversation_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select comp.name
  from public.conversations c
  join public.companies comp on comp.id = c.company_id
  where c.id = p_conversation_id
    and c.deleted_at is null
    and c.company_id is not null
    and public.is_conversation_member(p_conversation_id);
$$;
revoke all on function public.get_conversation_company_name(uuid) from public;
grant execute on function public.get_conversation_company_name(uuid) to authenticated;
