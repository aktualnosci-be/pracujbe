-- =============================================================================
-- 0123 — zapisane wyszukiwania: dokończenie #100.
--
-- 1. rename_saved_search(id, name) — zmiana nazwy WŁASNEGO wyszukiwania (RPC-only,
--    authenticated). Te same reguły nazwy co save_saved_search (1–80 znaków po przycięciu)
--    i dodatkowo bez znaków sterujących. Cudze/nieistniejące → NOT_FOUND (jak
--    set_saved_search_alerts / delete_saved_search). Ta sama nazwa = no-op.
--
-- 2. saved_search_alert_unsubscribe(profile, id) — wyłączenie JEDNEGO alertu z linku
--    w e-mailu jobMatch (token HMAC weryfikuje serwer, `src/lib/email/saved-search-alert-token.ts`).
--    Tylko service_role. Profil z tokenu musi być właścicielem wyszukiwania; inaczej
--    nic się nie zmienia, a wynik jest ten sam (nie zdradza istnienia wyszukiwania).
--    Idempotentne. Filtry, historia alertów i sama pozycja zostają — kandydat włączy
--    alert ponownie w panelu (set_saved_search_alerts przesuwa wtedy watermark).
--
-- 3. email_delivery_suppression_reason(...) — jedno źródło odpowiedzi „czy ten wiersz
--    kolejki wolno jeszcze wysłać”: blokada adresu (0098), zgoda kategorii (0087
--    email_allowed, dla jobMatch = job_matches), uprawnienie odbiorcy firmowego (0122,
--    `email_recipient_authorized` → suppressed_recipient_unauthorized), NOWE: alert jobMatch
--    wyłączony albo wyszukiwanie usunięte, nieaktywna rewizja kampanii (0101).
--    claim_email_batch (definicja z 0122) korzysta z niej bez zmiany zachowania dla
--    pozostałych przyczyn — w tym kontroli odbiorcy z 0122, której nie wolno zgubić.
--
-- 4. email_delivery_send_check(delivery) — ponowna kontrola TUŻ PRZED wysyłką (#466,
--    punkt 8: okno między claimem a `send`). Worker woła ją po renderze, przed budżetem
--    i wywołaniem dostawcy. Niedozwolony wiersz jest wygaszany (status failed +
--    suppressed_at + error_message = przyczyna), tak jak przy claimie. Tylko service_role.
--
-- Rollback: drop function rename_saved_search(uuid, text),
--   saved_search_alert_unsubscribe(uuid, uuid), email_delivery_send_check(uuid);
--   claim_email_batch z 0122 (+ grant z 0107); drop function
--   email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid).
-- =============================================================================

-- --- 1. Zmiana nazwy ---------------------------------------------------------------
create or replace function public.rename_saved_search(p_saved_search_id uuid, p_name text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'VALIDATION_FAILED: nazwa wymagana (1–80 znaków)' using errcode = '22023';
  end if;

  update public.saved_searches s
     set name = v_name
   where s.id = p_saved_search_id and s.profile_id = v_uid and s.name is distinct from v_name
  returning s.id into v_id;
  if v_id is null and not exists (
    select 1 from public.saved_searches s where s.id = p_saved_search_id and s.profile_id = v_uid
  ) then
    raise exception 'NOT_FOUND: wyszukiwanie nie istnieje' using errcode = 'P0002';
  end if;
  return v_name;
end $$;
revoke all on function public.rename_saved_search(uuid, text) from public, anon;
grant execute on function public.rename_saved_search(uuid, text) to authenticated;

-- --- 2. Wyłączenie jednego alertu z linku w e-mailu ------------------------------------
create or replace function public.saved_search_alert_unsubscribe(
  p_profile_id uuid,
  p_saved_search_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_profile_id is null or p_saved_search_id is null then
    raise exception 'VALIDATION_FAILED: brak danych alertu' using errcode = '22023';
  end if;
  update public.saved_searches s
     set alerts_enabled = false
   where s.id = p_saved_search_id and s.profile_id = p_profile_id and s.alerts_enabled;
end $$;
revoke all on function public.saved_search_alert_unsubscribe(uuid, uuid) from public, anon, authenticated;
grant execute on function public.saved_search_alert_unsubscribe(uuid, uuid) to service_role;

-- --- 3. Przyczyna wygaszenia wiersza kolejki ---------------------------------------------
-- null = wiersz wolno wysłać. Kolejność przyczyn jak w claim_email_batch z 0122:
-- adres → zgoda → uprawnienie odbiorcy firmowego → alert → kampania.
create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.email_address_suppressed(p_to_email) then 'suppressed_address'
    when public.email_allowed(p_profile_id, p_template) is not true then 'suppressed_opt_out'
    -- 0122 (#503): odbiorca firmowy musi nadal być aktywnym recruiter+ w chwili claimu/wysyłki.
    when public.email_recipient_authorized(p_template, p_entity_type, p_entity_id, p_profile_id)
           is not true then 'suppressed_recipient_unauthorized'
    when p_template = 'jobMatch' and p_entity_type = 'saved_search' and not exists (
           select 1 from public.saved_searches s
            where s.id = p_entity_id
              and s.profile_id is not distinct from p_profile_id
              and s.alerts_enabled) then 'suppressed_alert_disabled'
    when p_campaign_id is not null and not exists (
           select 1 from public.email_campaigns c
            where c.id = p_campaign_id and c.status in ('active', 'completed'))
      then 'suppressed_campaign_inactive'
    else null
  end;
$$;
revoke all on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.email_delivery_suppression_reason(uuid, text, text, uuid, text, uuid)
  to service_role;

-- claim_email_batch (0122) — ta sama dzierżawa i SKIP LOCKED; przyczyny z jednej funkcji.
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id,
           public.email_delivery_suppression_reason(
             e.profile_id, e.template, e.to_email::text, e.campaign_id,
             e.entity_type, e.entity_id) as reason
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    -- Odbiorca wypisał się (kategoria albo ten alert), adres dostał blokadę, odbiorca
    -- firmowy stracił uprawnienie (0122) albo rewizja kampanii nie jest już aktywna:
    -- wiersz zostaje (ślad), ale nie wychodzi.
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(), error_message = p.reason,
           locked_at = null, updated_at = now()
      from picked p
     where d.id = p.id and p.reason is not null
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), updated_at = now()
    from picked p
   where d.id = p.id and p.reason is null
  returning d.*;
end $$;
revoke all on function public.claim_email_batch(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer, integer) to service_role;

-- --- 4. Kontrola tuż przed wysyłką -------------------------------------------------------
-- Zwraca null (wysyłaj) albo przyczynę; niedozwolony wiersz w stanie queued jest wygaszany.
-- Wiersz nieistniejący albo już nie w kolejce → 'not_queued' (worker nic nie wysyła).
create or replace function public.email_delivery_send_check(p_delivery_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_deliveries%rowtype;
  v_reason text;
begin
  select * into v_row from public.email_deliveries d where d.id = p_delivery_id for update;
  if v_row.id is null or v_row.status <> 'queued' then return 'not_queued'; end if;

  v_reason := public.email_delivery_suppression_reason(
    v_row.profile_id, v_row.template, v_row.to_email::text, v_row.campaign_id,
    v_row.entity_type, v_row.entity_id);
  if v_reason is not null then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = v_reason,
           locked_at = null, updated_at = now()
     where id = v_row.id;
  end if;
  return v_reason;
end $$;
revoke all on function public.email_delivery_send_check(uuid) from public, anon, authenticated;
grant execute on function public.email_delivery_send_check(uuid) to service_role;
