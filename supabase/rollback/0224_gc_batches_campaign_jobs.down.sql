-- Rollback 0224 (numer tymczasowy): przywraca GC z 0163/0195 (jeden DELETE od seen_at),
-- edytor/aktywację/harmonogram kampanii z 0155/0111/0101 i send_check z 0131; usuwa
-- email_campaign_unavailable_slugs i indeksy czasu.
drop function if exists public.rate_limit_gc(integer, integer);
drop function if exists public.processed_webhooks_gc(integer, integer);
drop index if exists public.idx_rate_limits_updated_at;
drop index if exists public.idx_processed_webhooks_terminal_updated;

create or replace function public.rate_limit_gc(p_older_than_seconds integer default 86400)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.rate_limits
    where updated_at < now() - make_interval(secs => greatest(coalesce(p_older_than_seconds, 86400), 86400));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.rate_limit_gc(integer) from public, anon, authenticated;
grant execute on function public.rate_limit_gc(integer) to service_role;

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

create or replace function public.admin_create_email_campaign_revision(
  p_client_key uuid,
  p_slug text,
  p_content jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.email_campaigns;
  v_id uuid;
  v_revision integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80 then
    raise exception 'VALIDATION_FAILED: slug' using errcode = '22023';
  end if;

  -- Dwa równoległe wywołania z tym samym kluczem: drugie czeka i zwraca rewizję pierwszego.
  perform pg_advisory_xact_lock(hashtextextended('email_campaign_key:' || p_client_key::text, 0));
  select * into v_existing from public.email_campaigns where client_key = p_client_key;
  if found then
    if v_existing.slug <> p_slug then
      raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- Treść, którą worker wyrenderuje w każdym języku (komplet języków sprawdza 0101).
  if not public.email_campaign_jobs_renderable(p_content) then
    raise exception 'VALIDATION_FAILED: kampania' using errcode = '22023';
  end if;

  v_id := public.create_email_campaign_revision(p_slug, p_content);
  update public.email_campaigns set client_key = p_client_key where id = v_id
  returning revision into v_revision;

  perform public.write_audit('email_campaign.revision_created', 'email_campaign', v_id, null,
    jsonb_build_object('status', 'draft', 'slug', p_slug, 'revision', v_revision));
  return v_id;
end $$;
revoke all on function public.admin_create_email_campaign_revision(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_create_email_campaign_revision(uuid, text, jsonb) to authenticated;

create or replace function public.admin_activate_email_campaign(
  p_campaign_id uuid,
  p_expected_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_campaigns;
  v_superseded jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  select * into v_row from public.email_campaigns where id = p_campaign_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Ta sama blokada co activate_email_campaign / create_email_campaign_revision.
  perform pg_advisory_xact_lock(hashtextextended('email_campaign:' || v_row.slug, 0));
  select * into v_row from public.email_campaigns where id = p_campaign_id for update;

  if v_row.status is distinct from p_expected_status then
    raise exception 'STALE_STATE: rewizja zmieniła status' using errcode = 'P0001';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'INVALID_TRANSITION: aktywować można tylko szkic' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'revision', c.revision) order by c.revision), '[]'::jsonb)
    into v_superseded
    from public.email_campaigns c
   where c.slug = v_row.slug and c.id <> v_row.id and c.status in ('draft', 'active', 'completed');

  perform public.activate_email_campaign(p_campaign_id);

  perform public.write_audit('email_campaign.activated', 'email_campaign', p_campaign_id,
    jsonb_build_object('status', v_row.status, 'slug', v_row.slug, 'revision', v_row.revision),
    jsonb_build_object('status', 'active', 'slug', v_row.slug, 'revision', v_row.revision,
                       'superseded', v_superseded));
end $$;
revoke all on function public.admin_activate_email_campaign(uuid, text) from public;
grant execute on function public.admin_activate_email_campaign(uuid, text) to authenticated;

create or replace function public.process_email_campaigns(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_total integer := 0; v_q integer;
begin
  for v_id in select id from public.email_campaigns where status = 'active' order by activated_at loop
    select b.queued into v_q from public.enqueue_campaign_batch(v_id, p_limit) b;
    v_total := v_total + coalesce(v_q, 0);
  end loop;
  return v_total;
end $$;
revoke all on function public.process_email_campaigns(integer) from public;
grant execute on function public.process_email_campaigns(integer) to service_role;

create or replace function public.email_delivery_send_check(p_delivery_id uuid, p_lock_token uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_deliveries%rowtype;
  v_reason text;
begin
  select * into v_row from public.email_deliveries d where d.id = p_delivery_id for update;
  if v_row.id is null or v_row.status <> 'queued' then return 'not_queued'; end if;
  if v_row.lock_token is distinct from p_lock_token then return 'lease_lost'; end if;

  v_reason := public.email_delivery_suppression_reason(
    v_row.profile_id, v_row.template, v_row.to_email::text, v_row.campaign_id,
    v_row.entity_type, v_row.entity_id);
  if v_reason is not null then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = v_reason,
           locked_at = null, lock_token = null, updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  else
    -- #621: odnowienie dzierżawy TUŻ PRZED wywołaniem dostawcy — pełne, świeże okno
    -- (`locked_at = now()`) na czas żądania HTTP, niezależnie od tego, ile z pierwotnej
    -- dzierżawy claimu już upłynęło. Token bez zmian (ten sam właściciel).
    update public.email_deliveries
       set locked_at = now(), updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  end if;
  return v_reason;
end $$;
revoke all on function public.email_delivery_send_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_delivery_send_check(uuid, uuid) to service_role;

drop function if exists public.email_campaign_unavailable_slugs(jsonb);
