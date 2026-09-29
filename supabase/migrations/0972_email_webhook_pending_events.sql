-- =============================================================================
-- 0972_email_webhook_pending_events.sql  (numer TYMCZASOWY — ostateczny nada integrator)
-- #788: webhook doręczenia odebrany PRZED zapisem `provider_message_id` przez workera dostawał
--       `unknown_message`, inbox oznaczał go `completed` i zdarzenie ginęło bezpowrotnie.
--       Teraz `record_email_event` zapisuje takie zdarzenie w `email_pending_events`, a trigger
--       na `email_deliveries` przypisuje je (przez ten sam `record_email_event`) w transakcji,
--       która zapisuje identyfikator. Wyścig zamknięty advisory lockiem (klucz provider+id).
-- #790: `release_webhook` zwalnia dzierżawę inboxu po błędzie przetwarzania, żeby szybki retry
--       dostawcy nie dostał `locked`.
-- Tabela dostępna wyłącznie dla service_role (przez SECURITY DEFINER); zdarzenia > 30 dni
-- sprząta `processed_webhooks_gc`.
-- =============================================================================

create table if not exists public.email_pending_events (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  provider_message_id text not null,
  event               text not null,
  occurred_at         timestamptz not null,
  recipient           text,
  bounce_type         text,
  received_at         timestamptz not null default now(),
  constraint email_pending_events_provider_len check (char_length(provider) between 1 and 40),
  constraint email_pending_events_message_len check (char_length(provider_message_id) between 1 and 200),
  constraint email_pending_events_event check (event in ('delivered', 'delivery_delayed', 'bounced', 'complained')),
  constraint email_pending_events_recipient_len check (recipient is null or char_length(recipient) between 3 and 320)
);
create unique index if not exists uq_email_pending_events_dedup
  on public.email_pending_events (provider, provider_message_id, event, occurred_at);
create index if not exists idx_email_pending_events_received
  on public.email_pending_events (received_at);
alter table public.email_pending_events enable row level security;
alter table public.email_pending_events force row level security;
revoke all on public.email_pending_events from public, anon, authenticated;

create or replace function public.record_email_event(
  p_provider text,
  p_provider_message_id text,
  p_event text,
  p_occurred_at timestamptz,
  p_recipient text default null,
  p_bounce_type text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_deliveries;
  v_found boolean;
  v_at timestamptz := least(coalesce(p_occurred_at, now()), now());
  v_bounce text;
  v_hard boolean;
  v_target public.email_status;
  v_status public.email_status;
  v_delivered timestamptz;
  v_bounced timestamptz;
  v_bounce_type text;
  v_complained timestamptz;
  v_delayed timestamptz;
  v_event_at timestamptz;
  v_changed boolean := false;
  v_email text;
  v_supp uuid;
begin
  if p_provider is null or char_length(p_provider) not between 1 and 40 then
    raise exception 'VALIDATION_FAILED: provider' using errcode = '22023';
  end if;
  if p_provider_message_id is null or char_length(p_provider_message_id) not between 1 and 200 then
    raise exception 'VALIDATION_FAILED: provider_message_id' using errcode = '22023';
  end if;
  if p_event is null or p_event not in ('delivered', 'delivery_delayed', 'bounced', 'complained') then
    raise exception 'VALIDATION_FAILED: event' using errcode = '22023';
  end if;

  v_bounce := case when p_event = 'bounced' then
    case lower(coalesce(p_bounce_type, ''))
      when 'permanent' then 'permanent'
      when 'transient' then 'transient'
      else 'undetermined'
    end end;
  v_hard := v_bounce = 'permanent';
  v_target := case
    when p_event = 'delivered' then 'delivered'::public.email_status
    when p_event = 'complained' then 'complained'::public.email_status
    when v_hard then 'bounced'::public.email_status
  end;

  -- #788: ta sama blokada co w triggerze przypisania — zdarzenie odebrane tuż przed zapisem
  -- identyfikatora wysyłki nie może zniknąć między odczytem a zapisem workera.
  perform pg_advisory_xact_lock(hashtextextended('email_event:' || p_provider || ':' || p_provider_message_id, 0));

  select * into v_row from public.email_deliveries
   where provider_message_id = p_provider_message_id and provider = p_provider
   for update;
  v_found := found;

  if v_found then
    v_status := v_row.status;
    if v_target is not null
       and public.email_delivery_status_rank(v_target) > public.email_delivery_status_rank(v_row.status) then
      v_status := v_target;
    end if;
    v_delivered := case when p_event = 'delivered' then coalesce(v_row.delivered_at, v_at) else v_row.delivered_at end;
    v_bounced := case when p_event = 'bounced' then coalesce(v_row.bounced_at, v_at) else v_row.bounced_at end;
    -- Trwałe odbicie wygrywa z wcześniejszym przejściowym; przejściowe nie nadpisuje trwałego.
    v_bounce_type := case
      when v_bounce is null then v_row.bounce_type
      when v_row.bounce_type = 'permanent' then 'permanent'
      else v_bounce end;
    v_complained := case when p_event = 'complained' then coalesce(v_row.complained_at, v_at) else v_row.complained_at end;
    v_delayed := case when p_event = 'delivery_delayed' then greatest(coalesce(v_row.delayed_at, v_at), v_at) else v_row.delayed_at end;
    v_event_at := greatest(coalesce(v_row.provider_event_at, v_at), v_at);

    if v_status is distinct from v_row.status
       or v_delivered is distinct from v_row.delivered_at
       or v_bounced is distinct from v_row.bounced_at
       or v_bounce_type is distinct from v_row.bounce_type
       or v_complained is distinct from v_row.complained_at
       or v_delayed is distinct from v_row.delayed_at
       or v_event_at is distinct from v_row.provider_event_at then
      update public.email_deliveries
         set status = v_status, delivered_at = v_delivered, bounced_at = v_bounced,
             bounce_type = v_bounce_type, complained_at = v_complained, delayed_at = v_delayed,
             provider_event_at = v_event_at, updated_at = now()
       where id = v_row.id;
      v_changed := true;
    end if;
    v_email := v_row.to_email::text;
  else
    v_email := nullif(btrim(coalesce(p_recipient, '')), '');
    if v_email is not null and char_length(v_email) not between 3 and 320 then v_email := null; end if;
    -- #788: wysyłka nie ma jeszcze identyfikatora dostawcy (webhook wyprzedził zapis workera).
    -- Zdarzenie zostaje trwale i jest przypisane triggerem, gdy identyfikator się pojawi.
    insert into public.email_pending_events
      (provider, provider_message_id, event, occurred_at, recipient, bounce_type)
    values (p_provider, p_provider_message_id, p_event, v_at,
            case when v_email is not null and char_length(v_email) <= 320 then v_email end,
            case when p_event = 'bounced' then v_bounce end)
    on conflict do nothing;
  end if;

  if (v_hard or p_event = 'complained') and v_email is not null then
    insert into public.email_suppressions (email, reason, provider, provider_message_id, delivery_id)
    values (v_email::citext,
            case when p_event = 'complained' then 'complaint' else 'hard_bounce' end,
            p_provider, p_provider_message_id, case when v_found then v_row.id end)
    on conflict (email) where lifted_at is null do nothing
    returning id into v_supp;
    if v_supp is not null then
      v_changed := true;
      -- Bez adresu w dzienniku: identyfikator blokady wystarcza do podglądu w panelu.
      perform public.write_audit('email.suppressed', 'email_suppression', v_supp, null,
        jsonb_build_object('status', case when p_event = 'complained' then 'complaint' else 'hard_bounce' end));
    end if;
  end if;

  if v_changed then return 'applied'; end if;
  return case when v_found then 'unchanged' else 'unknown_message' end;
end $$;
revoke all on function public.record_email_event(text, text, text, timestamptz, text, text) from public;
grant execute on function public.record_email_event(text, text, text, timestamptz, text, text) to service_role;


-- --- przypisanie zaległych zdarzeń po zapisie identyfikatora wysyłki ---------------------
create or replace function public.apply_pending_email_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev record;
begin
  if new.provider_message_id is null or new.provider is null then return new; end if;
  if tg_op = 'UPDATE' and old.provider_message_id is not distinct from new.provider_message_id
     and old.provider is not distinct from new.provider then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email_event:' || new.provider || ':' || new.provider_message_id, 0));
  for v_ev in
    select id, event, occurred_at, recipient, bounce_type from public.email_pending_events
     where provider = new.provider and provider_message_id = new.provider_message_id
     order by occurred_at, received_at
  loop
    perform public.record_email_event(new.provider, new.provider_message_id, v_ev.event,
                                      v_ev.occurred_at, v_ev.recipient, v_ev.bounce_type);
    delete from public.email_pending_events where id = v_ev.id;
  end loop;
  return new;
end $$;
revoke all on function public.apply_pending_email_events() from public;

drop trigger if exists trg_email_deliveries_apply_pending on public.email_deliveries;
create trigger trg_email_deliveries_apply_pending
  after insert or update of provider_message_id, provider on public.email_deliveries
  for each row when (new.provider_message_id is not null)
  execute function public.apply_pending_email_events();

-- --- #790: zwolnienie dzierżawy po błędzie przetwarzania -----------------------------------
create or replace function public.release_webhook(p_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update public.processed_webhooks
     set locked_until = null, updated_at = now()
   where id = p_id and status = 'processing';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.release_webhook(text) from public;
grant execute on function public.release_webhook(text) to service_role;

create or replace function public.processed_webhooks_gc(p_older_than_days integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.processed_webhooks
    where status in ('completed', 'failed')
      and seen_at < now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 7));
  get diagnostics v_deleted = row_count;
  -- #788: zdarzenia bez wysyłki po 30 dniach nigdy się nie przypiszą.
  delete from public.email_pending_events where received_at < now() - interval '30 days';
  return v_deleted;
end $$;
revoke all on function public.processed_webhooks_gc(integer) from public, anon, authenticated;
grant execute on function public.processed_webhooks_gc(integer) to service_role;
