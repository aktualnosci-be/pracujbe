-- =============================================================================
-- 0109_admin_email_campaigns.sql — #45 (otwarte): panel admina kampanii e-mail.
--
-- Numer TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- 0101 dało kampanie (email_campaigns + email_campaign_recipients) i RPC
-- activate_email_campaign / cancel_email_campaign wyłącznie dla service_role, bez
-- sprawdzenia roli, porównania stanu i śladu w dzienniku. Panel `/admin/kampanie` zmienia
-- stan rewizji pod SESJĄ admina (auth.uid()), więc potrzebuje osobnych wejść:
--
-- 1. admin_activate_email_campaign(id, expected_status) — is_admin(); advisory lock sluga
--    + FOR UPDATE; status ≠ expected → STALE_STATE (inny admin albo harmonogram zmienił
--    rewizję w międzyczasie); aktywować można tylko szkic (INVALID_TRANSITION). Skutek =
--    istniejące activate_email_campaign (pozostałe rewizje sluga, także nowsze szkice → superseded, ich niewysłane
--    listy wygaszone; starsza rewizja nie wraca — STALE_STATE). Audyt
--    `email_campaign.activated` z listą zastąpionych rewizji.
-- 2. admin_cancel_email_campaign(id, expected_status) — jw.; zatrzymać można szkic,
--    aktywną albo zakończoną rewizję. Skutek = istniejące cancel_email_campaign
--    (niezadzierżawione listy wygaszone, odbiorcy → cancelled). Zatrzymanie jest
--    nieodwracalne (wznowienie = nowa rewizja). Audyt `email_campaign.cancelled`
--    z liczbą wygaszonych listów.
--
-- Oba RPC nie wysyłają niczego same (wysyłkę robi harmonogram i worker). Warunek
-- skonfigurowanego nadawcy marketingu (EMAIL_FROM + EMAIL_SENDER_*) to zmienne środowiska
-- aplikacji — sprawdza go Server Action przed aktywacją i /api/maintenance przed
-- kolejkowaniem; baza ich nie zna.
--
-- W dzienniku: bez treści kampanii i bez danych odbiorców (slug, rewizja, statusy, liczby).
--
-- Rollback: drop function public.admin_activate_email_campaign(uuid, text);
--           drop function public.admin_cancel_email_campaign(uuid, text);
--           (bez zmian danych; wpisy audit_logs zostają)
-- =============================================================================

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

create or replace function public.admin_cancel_email_campaign(
  p_campaign_id uuid,
  p_expected_status text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_campaigns;
  v_pending integer;
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
  if v_row.status not in ('draft', 'active', 'completed') then
    raise exception 'INVALID_TRANSITION: rewizja jest już zamknięta' using errcode = 'P0001';
  end if;

  -- Te same listy, które wygasi cancel_email_campaign (zakolejkowane, niezadzierżawione).
  select count(*)::int into v_pending
    from public.email_deliveries d
   where d.campaign_id = p_campaign_id
     and d.status = 'queued'
     and (d.locked_at is null or d.locked_at < now() - interval '300 seconds');

  perform public.cancel_email_campaign(p_campaign_id);

  perform public.write_audit('email_campaign.cancelled', 'email_campaign', p_campaign_id,
    jsonb_build_object('status', v_row.status, 'slug', v_row.slug, 'revision', v_row.revision),
    jsonb_build_object('status', 'cancelled', 'slug', v_row.slug, 'revision', v_row.revision,
                       'suppressed_deliveries', v_pending));
end $$;
revoke all on function public.admin_cancel_email_campaign(uuid, text) from public;
grant execute on function public.admin_cancel_email_campaign(uuid, text) to authenticated;
