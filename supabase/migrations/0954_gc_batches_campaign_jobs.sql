-- =============================================================================
-- 0954_gc_batches_campaign_jobs.sql  (numer TYMCZASOWY — ostateczny nada integrator)
--
-- #746: GC tabel technicznych (0163/0195) usuwał całą zaległość jednym `DELETE` bez indeksu
--       po kolumnie czasu — długi skan, duży WAL i blokady obok `rate_limit_hit`/`claim_webhook`.
--       Teraz: indeksy po kolumnie czasu (inbox: częściowy, tylko stany rozstrzygnięte) i partie
--       `p_limit` (domyślnie 5000, najwyżej 10 000) z `FOR UPDATE SKIP LOCKED`. Funkcja zwraca
--       liczbę usuniętych wierszy; pełna partia (= limit) oznacza zaległość, którą
--       /api/maintenance nadrabia kolejnymi partiami (każda w osobnej transakcji).
-- #722: retencja inboxu liczona od `updated_at` (zakończenie albo ostatnia próba: complete_webhook,
--       claim_webhook po wygasłej dzierżawie, release_webhook), a nie od `seen_at` (pierwsze
--       odebranie). Wydarzenie ponawiane długo nie traci deduplikacji zaraz po zakończeniu.
--       Dolna granica bez zmian: 7 dni (dłużej niż okno świeżości webhooków).
-- #720: kampania e-mail z ofertą, której nie ma publicznie (slug nie istnieje, oferta wygasła,
--       wstrzymana, usunięta, demo, firma niezweryfikowana), nie zapisze się z edytora, nie
--       aktywuje, nie zarezerwuje odbiorców i nie wyjdzie: `email_campaign_unavailable_slugs`
--       sprawdza każdy slug treści warunkami `campaign_job_source` (0102). Kontrola przy zapisie
--       rewizji (`admin_create_email_campaign_revision`), aktywacji (`admin_activate_email_campaign`),
--       w harmonogramie (`process_email_campaigns` pomija taką rewizję — rezerwacja odbiorców
--       jest jednorazowa) i tuż przed wysyłką (`email_delivery_send_check` →
--       `suppressed_campaign_job_unavailable`). `enqueue_campaign_batch` bez zmian.
--
-- Rollback: supabase/rollback/0954_gc_batches_campaign_jobs.down.sql
-- Dowód: supabase/tests/rls.sql sekcja GC746 (kontrole ujemne).
-- =============================================================================

-- --- #746: indeksy pod predykat czasu ------------------------------------------------------------
create index if not exists idx_rate_limits_updated_at on public.rate_limits (updated_at);
create index if not exists idx_processed_webhooks_terminal_updated
  on public.processed_webhooks (updated_at) where status in ('completed', 'failed');

-- --- #746: rate_limit_gc w partiach --------------------------------------------------------------
drop function if exists public.rate_limit_gc(integer);
create function public.rate_limit_gc(
  p_older_than_seconds integer default 86400,
  p_limit integer default 5000
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cutoff timestamptz := now() - make_interval(secs => greatest(coalesce(p_older_than_seconds, 86400), 86400));
  v_deleted integer;
begin
  delete from public.rate_limits r
   where r.key in (
           select x.key from public.rate_limits x
            where x.updated_at < v_cutoff
            order by x.updated_at
            limit greatest(least(coalesce(p_limit, 5000), 10000), 1)
            for update skip locked)
     -- ponowna kontrola: wiersz mógł zostać odświeżony przez rate_limit_hit przed blokadą
     and r.updated_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.rate_limit_gc(integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_gc(integer, integer) to service_role;

-- --- #746 + #722: processed_webhooks_gc w partiach, od updated_at ------------------------------
drop function if exists public.processed_webhooks_gc(integer);
create function public.processed_webhooks_gc(
  p_older_than_days integer default 30,
  p_limit integer default 5000
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 7));
  v_limit integer := greatest(least(coalesce(p_limit, 5000), 10000), 1);
  v_deleted integer;
begin
  delete from public.processed_webhooks w
   where w.id in (
           select x.id from public.processed_webhooks x
            where x.status in ('completed', 'failed')
              and x.updated_at < v_cutoff
            order by x.updated_at
            limit v_limit
            for update skip locked)
     and w.status in ('completed', 'failed')
     and w.updated_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  -- #788 (0195): zdarzenia bez wysyłki po 30 dniach nigdy się nie przypiszą — też w partiach
  -- (indeks idx_email_pending_events_received).
  delete from public.email_pending_events e
   where e.id in (
           select x.id from public.email_pending_events x
            where x.received_at < now() - interval '30 days'
            order by x.received_at
            limit v_limit
            for update skip locked);
  return v_deleted;
end $$;
revoke all on function public.processed_webhooks_gc(integer, integer) from public, anon, authenticated;
grant execute on function public.processed_webhooks_gc(integer, integer) to service_role;

-- --- #720: oferty kampanii niedostępne publicznie --------------------------------------------------
-- Treść `{ "<język>": { "jobs": [{ slug, ... }] } }` → posortowane, unikalne slugi, których
-- `campaign_job_source` (aktywna, nieusunięta, niewygasła, nie demo, firma zweryfikowana) nie zwraca.
create or replace function public.email_campaign_unavailable_slugs(p_content jsonb)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct coalesce(j ->> 'slug', '') order by coalesce(j ->> 'slug', '')), '{}'::text[])
    from jsonb_each(case when jsonb_typeof(p_content) = 'object' then p_content else '{}'::jsonb end) e(k, v)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v -> 'jobs') = 'array' then v -> 'jobs' else '[]'::jsonb end) j
   where not exists (select 1 from public.campaign_job_source(null, j ->> 'slug', e.k));
$$;
revoke all on function public.email_campaign_unavailable_slugs(jsonb) from public, anon, authenticated;
grant execute on function public.email_campaign_unavailable_slugs(jsonb) to service_role;

-- Zapis rewizji z edytora (0155) + kontrola ofert.
create or replace function public.admin_create_email_campaign_revision(
  p_client_key uuid,
  p_slug text,
  p_content jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.email_campaigns;
  v_id uuid;
  v_revision integer;
  v_unavailable text[];
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80 then
    raise exception 'VALIDATION_FAILED: slug' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email_campaign_key:' || p_client_key::text, 0));
  select * into v_existing from public.email_campaigns where client_key = p_client_key;
  if found then
    if v_existing.slug <> p_slug then
      raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if not public.email_campaign_jobs_renderable(p_content) then
    raise exception 'VALIDATION_FAILED: kampania' using errcode = '22023';
  end if;
  -- #720: każda oferta musi być publiczna teraz (slug istnieje i spełnia warunki wysyłki).
  v_unavailable := public.email_campaign_unavailable_slugs(p_content);
  if cardinality(v_unavailable) > 0 then
    raise exception 'CAMPAIGN_JOB_UNAVAILABLE: %', array_to_string(v_unavailable, ',') using errcode = '22023';
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

-- Aktywacja (0111) + kontrola ofert (oferta mogła wygasnąć między szkicem a aktywacją).
create or replace function public.admin_activate_email_campaign(
  p_campaign_id uuid,
  p_expected_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_campaigns;
  v_superseded jsonb;
  v_unavailable text[];
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  select * into v_row from public.email_campaigns where id = p_campaign_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email_campaign:' || v_row.slug, 0));
  select * into v_row from public.email_campaigns where id = p_campaign_id for update;

  if v_row.status is distinct from p_expected_status then
    raise exception 'STALE_STATE: rewizja zmieniła status' using errcode = 'P0001';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'INVALID_TRANSITION: aktywować można tylko szkic' using errcode = 'P0001';
  end if;
  v_unavailable := public.email_campaign_unavailable_slugs(v_row.content);
  if cardinality(v_unavailable) > 0 then
    raise exception 'CAMPAIGN_JOB_UNAVAILABLE: %', array_to_string(v_unavailable, ',') using errcode = '22023';
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

-- Harmonogram (0101): rewizja z niedostępną ofertą nie rezerwuje nowych odbiorców.
create or replace function public.process_email_campaigns(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_total integer := 0; v_q integer;
begin
  for v_id in
    select c.id from public.email_campaigns c
     where c.status = 'active'
       and cardinality(public.email_campaign_unavailable_slugs(c.content)) = 0
     order by c.activated_at
  loop
    select b.queued into v_q from public.enqueue_campaign_batch(v_id, p_limit) b;
    v_total := v_total + coalesce(v_q, 0);
  end loop;
  return v_total;
end $$;
revoke all on function public.process_email_campaigns(integer) from public;
grant execute on function public.process_email_campaigns(integer) to service_role;

-- Tuż przed wysyłką (0131) + oferty listu z payloadu w języku odbiorcy.
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
  -- #720: oferta z listu przestała być publiczna po zakolejkowaniu — list nie wychodzi
  -- (martwy link albo nieaktualne warunki).
  if v_reason is null and v_row.template = 'newsletter' and v_row.campaign_id is not null
     and cardinality(public.email_campaign_unavailable_slugs(
           jsonb_build_object(v_row.locale,
             jsonb_build_object('jobs', coalesce(v_row.payload -> 'jobs', '[]'::jsonb))))) > 0 then
    v_reason := 'suppressed_campaign_job_unavailable';
  end if;
  if v_reason is not null then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = v_reason,
           locked_at = null, lock_token = null, updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  else
    update public.email_deliveries
       set locked_at = now(), updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  end if;
  return v_reason;
end $$;
revoke all on function public.email_delivery_send_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_delivery_send_check(uuid, uuid) to service_role;
