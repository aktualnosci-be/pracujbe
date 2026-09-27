-- =============================================================================
-- 0810 (numer tymczasowy) — #889: otwarcie rozmowy nie może oznaczać jako przeczytanej
-- wiadomości dostarczonej PO pobraniu wątku, ale PRZED zapisem odczytu.
--
-- `mark_conversation_read` przesuwał `last_read_at` na `now()` liczone w chwili
-- ROZPOCZĘCIA własnej transakcji zapisu — po zakończonym już (w osobnej transakcji)
-- odczycie wątku. Wiadomość wysłana w tej luce trafiała do wątku wyświetlonego
-- użytkownikowi, lecz zostawała oznaczona jako przeczytana (razem z powiadomieniem),
-- mimo że renderowana strona jej nie zawierała.
--
-- `mark_conversation_read(p_conversation_id, p_up_to)` — nowy, opcjonalny drugi argument:
-- czas najnowszej wiadomości faktycznie widocznej w pobranym wątku (granica konkretnego
-- odczytu, nie „teraz"). `last_read_at` przesuwa się WYŁĄCZNIE do tej granicy i tylko
-- w przód (`greatest(...)`, monotonicznie — równoległe otwarcie z wcześniejszą granicą
-- nie cofa późniejszego stanu). Powiadomienia gasną tylko dla wiadomości z tą granicą
-- (`created_at <= p_up_to`), nie „na chwilę zapisu" — wiadomość dostarczona po granicy
-- zostaje nieprzeczytana (`get_conversation_summaries`/`getUnreadConversationsCount`
-- porównują `created_at > last_read_at`, bez zmian).
-- Bez podanej granicy (`p_up_to = null`) zachowanie jak dotąd (`now()`) — zgodność wsteczna.
--
-- Rollback: `drop function public.mark_conversation_read(uuid, timestamptz);
--            create function public.mark_conversation_read(uuid) ...` (treść z 0016).
-- =============================================================================

drop function public.mark_conversation_read(uuid);

create function public.mark_conversation_read(
  p_conversation_id uuid,
  p_up_to timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_boundary timestamptz := coalesce(p_up_to, now());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  update public.conversation_members
    set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_boundary)
    where conversation_id = p_conversation_id and profile_id = v_uid;

  update public.notifications
    set read_at = now(), updated_at = now()
    where profile_id = v_uid
      and entity_type = 'conversation'
      and entity_id = p_conversation_id
      and read_at is null
      and created_at <= v_boundary;
end $$;

revoke all on function public.mark_conversation_read(uuid, timestamptz) from public;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
