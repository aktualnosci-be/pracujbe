-- =============================================================================
-- 0740_TEMP_company_awaiting_reply_scope.sql (numer tymczasowy — nada integrator)
--
-- Naprawa #700: PR #698 policzył kafelek „rozmowy oczekujące na odpowiedź"
-- (`CONVERSATIONS_AWAITING_REPLY_SQL` w `src/lib/data/employer.ts`) zapytaniem SELECT
-- czytanym pod RLS bieżącego użytkownika. Polityka `conversations_select_member`
-- (0009/0039) ogranicza SELECT do rozmów, których jest uczestnikiem
-- (`is_conversation_member`) — więc rekruter widział tylko rozmowy PRZYPISANE JEMU,
-- nie wszystkie rozmowy AKTYWNEJ firmy. Zespół, w którym rozmowy są rozdzielone między
-- rekruterów, dostawał zaniżony licznik (rozmowy kolegów były niewidoczne).
--
-- Naprawa: `get_company_awaiting_reply_count(p_company_id)` — SECURITY DEFINER, ta sama
-- logika co poprzednie zapytanie (ostatnia nieusunięta wiadomość rozmowy wysłana przez
-- kogoś spoza firmy, także byłego członka), ale liczona dla WSZYSTKICH rozmów firmy,
-- niezależnie od tego, kto jest ich uczestnikiem. Dostęp gejtowany `can_manage_jobs`
-- (recruiter+ = owner/admin/recruiter, aktywne członkostwo — ten sam próg co
-- `canRecruit()` w TS) — inna firma albo zwykły `member` dostaje 0, nie cudzy licznik.
--
-- Rollback: `drop function public.get_company_awaiting_reply_count(uuid);` i przywrócenie
-- `CONVERSATIONS_AWAITING_REPLY_SQL` w `src/lib/data/employer.ts` (poprzedni PR). Dane bez zmian.
-- =============================================================================

create function public.get_company_awaiting_reply_count(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.conversations c
  join lateral (
    select m.sender_id
    from public.messages m
    where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc, m.id desc
    limit 1
  ) last on true
  where public.can_manage_jobs(p_company_id)
    and c.company_id = p_company_id
    and c.deleted_at is null
    and last.sender_id is not null
    and not exists (
      select 1 from public.company_members cm
       where cm.company_id = p_company_id and cm.profile_id = last.sender_id
    );
$$;

revoke all on function public.get_company_awaiting_reply_count(uuid) from public;
grant execute on function public.get_company_awaiting_reply_count(uuid) to authenticated;
