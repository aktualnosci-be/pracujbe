-- Rollback 0972 (numer tymczasowy): przywraca record_email_event (0098) i processed_webhooks_gc (0163).
-- Zaległe zdarzenia bez wysyłki są tracone (jak przed migracją).
drop trigger if exists trg_email_deliveries_apply_pending on public.email_deliveries;
drop function if exists public.apply_pending_email_events();
drop function if exists public.release_webhook(text);

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

create or replace function public.processed_webhooks_gc(p_older_than_days integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.processed_webhooks
    where status in ('completed', 'failed')
      and seen_at < now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 7));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.processed_webhooks_gc(integer) from public, anon, authenticated;
grant execute on function public.processed_webhooks_gc(integer) to service_role;

drop table if exists public.email_pending_events;
