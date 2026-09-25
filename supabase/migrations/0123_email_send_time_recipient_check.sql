-- =============================================================================
-- 0123_email_send_time_recipient_check.sql — #503: uprawnienie odbiorcy firmowego
-- sprawdzane także w chwili wysyłki (numer nadany przez integratora).
--
-- E-maile z danymi kandydata do członków firmy (newApplication, offerAccepted,
-- offerDeclined, newMessage do strony firmowej) kolejkujemy tylko dla aktywnych
-- recruiter+ (`company_recipient_ok`, 0070). Między kolejkowaniem a wysyłką rola może
-- zostać odebrana, członkostwo dezaktywowane albo konto zamknięte. Dotąd worker
-- wysyłał taki wiersz mimo to.
--
-- 1. `email_recipient_authorized(template, entity_type, entity_id, profile)` —
--    prywatny helper: dla szablonów firmowych ustala firmę z obiektu wiersza
--    (aplikacja → oferta, propozycja → oferta, wiadomość → rozmowa) i wymaga
--    `company_recipient_ok`. Brak obiektu albo firmy = brak uprawnienia (fail-closed).
--    Kandydat jako odbiorca `newMessage` (nie członek firmy rozmowy) — bez zmian.
--    Pozostałe szablony → true (ich odbiorców wyznacza RPC, nie rola w firmie).
-- 2. `claim_email_batch` (ciało z 0101) — wiersz bez uprawnienia zostaje w kolejce jako
--    ślad (`failed`, `suppressed_at`, `error_message = 'suppressed_recipient_unauthorized'`)
--    i nie trafia do workera. Kolejność powodów: adres → zgoda → uprawnienie → kampania.
--
-- Rollback: odtworzyć `claim_email_batch` z 0101 (+ grant z 0107) i
--           `drop function public.email_recipient_authorized(text, text, uuid, uuid)`.
-- Migracja nie zmienia danych.
-- =============================================================================

create or replace function public.email_recipient_authorized(
  p_template text,
  p_entity_type text,
  p_entity_id uuid,
  p_profile_id uuid
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if p_template in ('newApplication') then
    if p_entity_type is distinct from 'application' then return false; end if;
    select j.company_id into v_company
      from public.applications a join public.jobs j on j.id = a.job_id
     where a.id = p_entity_id;
    return v_company is not null and public.company_recipient_ok(v_company, p_profile_id);
  elsif p_template in ('offerAccepted', 'offerDeclined') then
    if p_entity_type is distinct from 'offer' then return false; end if;
    select j.company_id into v_company
      from public.offers o join public.jobs j on j.id = o.job_id
     where o.id = p_entity_id;
    return v_company is not null and public.company_recipient_ok(v_company, p_profile_id);
  elsif p_template = 'newMessage' then
    if p_entity_type is distinct from 'message' then return false; end if;
    select c.company_id into v_company
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where m.id = p_entity_id;
    if not found then return false; end if;
    -- Strona firmowa rozmowy (jak w send_message: każdy członek firmy, także nieaktywny).
    if v_company is not null and exists (
         select 1 from public.company_members cm
          where cm.company_id = v_company and cm.profile_id = p_profile_id) then
      return public.company_recipient_ok(v_company, p_profile_id);
    end if;
    return true;
  end if;
  return true;
end $$;
revoke all on function public.email_recipient_authorized(text, text, uuid, uuid) from public;

create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id,
           public.email_allowed(e.profile_id, e.template) as allowed,
           public.email_address_suppressed(e.to_email::text) as blocked,
           public.email_recipient_authorized(e.template, e.entity_type, e.entity_id, e.profile_id)
             as authorized,
           (e.campaign_id is not null and not exists (
              select 1 from public.email_campaigns c
               where c.id = e.campaign_id and c.status in ('active', 'completed'))) as stale
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    -- Odbiorca wypisał się, adres dostał blokadę, odbiorca firmowy stracił uprawnienie
    -- albo rewizja kampanii nie jest już aktywna: wiersz zostaje (ślad), ale nie wychodzi.
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(),
           error_message = case
             when p.blocked then 'suppressed_address'
             when p.allowed is not true then 'suppressed_opt_out'
             when p.authorized is not true then 'suppressed_recipient_unauthorized'
             else 'suppressed_campaign_inactive' end,
           locked_at = null, updated_at = now()
      from picked p
     where d.id = p.id and (p.allowed is not true or p.blocked or p.authorized is not true or p.stale)
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), updated_at = now()
    from picked p
   where d.id = p.id and p.allowed is true and not p.blocked and p.authorized is true and not p.stale
  returning d.*;
end $$;

-- `create or replace` zachowuje uprawnienia; potwierdzamy stan z 0107.
revoke all on function public.claim_email_batch(integer, integer) from public;
grant execute on function public.claim_email_batch(integer, integer) to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.email_recipient_authorized(text, text, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.email_recipient_authorized(text, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'claim_email_batch/email_recipient_authorized: niezgodne uprawnienia EXECUTE.';
  end if;
end $$;
