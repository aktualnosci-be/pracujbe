-- =============================================================================
-- 0186 (numer tymczasowy — ostateczny nada integrator) — poczta: marketing tylko na
-- potwierdzone adresy (#1038) i zmiana języka e-maili przez użytkownika (#1049).
--
-- 1. #1038 (double opt-in). Zgoda na e-maile marketingowe z rejestracji (0108) jest zapisana
--    od razu, a wysyłka kampanii wybierała odbiorców po samej zgodzie. Ktoś, kto założył
--    konto na cudzy adres, mógł więc sprowadzić na właściciela adresu wiadomości, na które
--    ten nigdy się nie zgodził. Teraz kategoria `marketing` wymaga potwierdzonego adresu
--    (`auth.users.email_verified`, Better Auth) w KAŻDYM punkcie decyzji:
--    * `email_address_verified(profile)` — jedno źródło prawdy (service_role);
--    * `email_allowed(profile, template)` — marketing = zgoda ORAZ potwierdzony adres
--      (0087; wspólne dla kolejkowania, claimu i ponownej kontroli przed wysyłką);
--    * `enqueue_email_outcome` — nowy wynik `unverified_address` (przed sprawdzeniem zgody,
--      żeby ślad odróżniał brak potwierdzenia od braku zgody);
--    * `enqueue_campaign_batch` — niepotwierdzone adresy nie są NIGDY rezerwowane (po
--      potwierdzeniu adresu, dopóki rewizja jest aktywna, trafią do kolejnej paczki);
--    * `email_delivery_suppression_reason` (0175) — `suppressed_unverified_address` dla
--      wiersza, który już czeka w kolejce; odbiorca kampanii = `skipped_consent` /
--      `unverified_address` (`sync_email_campaign_recipient`, CHECK powodów).
--    Zgoda zostaje w bazie (dowód #513 bez zmian); nie jest aktywowana ani cofana —
--    po potwierdzeniu adresu działa od tej chwili. Poczta transakcyjna i alerty
--    zapisanych wyszukiwań nie zależą od tej zmiany (konto bez potwierdzenia nie loguje się).
-- 2. #1049 (Invariant #1). Język e-maili to `profiles.preferred_locale`, ustawiany dotąd
--    tylko przy rejestracji. `set_my_email_locale(locale)` (authenticated, własny profil):
--    język z `supported_locales`, zapis tylko przy zmianie, audyt `profile.email_locale_changed`
--    (bez danych osobowych: język przed i po). E-maile już zakolejkowane zachowują język
--    z chwili kolejkowania (`email_deliveries.locale`); kolejne — nowy język.
--
-- Definicje bazują na najnowszych: email_allowed 0087, enqueue_email_outcome i kampanie 0101,
-- email_delivery_suppression_reason 0175 (z zachowaniem 0171–0176). Rollback:
-- supabase/rollback/0186_email_verified_marketing_locale.down.sql.
-- =============================================================================

-- --- 1a. Potwierdzony adres --------------------------------------------------------------------
create or replace function public.email_address_verified(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.email_verified from auth.users u where u.id = p_profile_id), false);
$$;
revoke all on function public.email_address_verified(uuid) from public, anon, authenticated;
grant execute on function public.email_address_verified(uuid) to service_role;

-- --- 1b. Zgoda odbiorcy (0087): marketing także wymaga potwierdzonego adresu -----------------------
create or replace function public.email_allowed(p_profile_id uuid, p_template text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case c.cat
              when 'applications' then np.email_applications
              when 'offers'       then np.email_offers
              when 'messages'     then np.email_messages
              when 'job_matches'  then np.email_job_matches
              when 'marketing'    then np.email_marketing
              else null
            end
       from public.notification_preferences np
      where np.profile_id = p_profile_id),
    -- Brak wiersza (lub typ bez kategorii): domyślne wartości kolumn — marketing tylko po opt-in.
    c.cat is distinct from 'marketing')
  and (c.cat is distinct from 'marketing' or public.email_address_verified(p_profile_id))
  from (select public.email_preference_category(p_template) as cat) c;
$$;
revoke all on function public.email_allowed(uuid, text) from public;
grant execute on function public.email_allowed(uuid, text) to service_role;

-- --- 1c. Kolejkowanie z wynikiem (0101) — wynik `unverified_address` ---------------------------
create or replace function public.enqueue_email_outcome(
  p_profile_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_campaign_id uuid default null,
  out outcome text,
  out delivery_id uuid
) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email public.citext; v_locale text;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;
  if v_email is null then outcome := 'no_email'; return; end if;

  -- #1038: marketing tylko na potwierdzony adres (przed zgodą — ślad odróżnia przyczyny).
  if public.email_preference_category(p_type) = 'marketing'
     and not public.email_address_verified(p_profile_id) then
    outcome := 'unverified_address'; return;
  end if;
  -- Opt-out: nie kolejkujemy. Worker sprawdza zgodę ponownie przy claimie.
  if not public.email_allowed(p_profile_id, p_type) then outcome := 'opted_out'; return; end if;
  -- #44: trwałe odbicie albo skarga na ten adres — nie kolejkujemy.
  if public.email_address_suppressed(v_email::text) then outcome := 'suppressed_address'; return; end if;

  v_locale := public.resolve_recipient_locale(p_profile_id);
  insert into public.email_deliveries
    (profile_id, to_email, template, locale, subject, status, entity_type, entity_id,
     idempotency_key, payload, queued_at, next_attempt_at, attempts, campaign_id)
  values
    (p_profile_id, v_email, p_type, v_locale, p_type, 'queued', p_entity_type, p_entity_id,
     p_idempotency_key, coalesce(p_payload, '{}'::jsonb), now(), now(), 0, p_campaign_id)
  on conflict (idempotency_key) where idempotency_key is not null
    do nothing
  returning id into delivery_id;

  if delivery_id is null then
    -- Ponowienie z tym samym kluczem: bez drugiego listu i bez zużycia budżetu.
    select d.id into delivery_id from public.email_deliveries d
     where d.idempotency_key = p_idempotency_key;
    outcome := 'duplicate';
    return;
  end if;

  if not public.take_email_recipient_budget(p_profile_id, p_type) then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = 'suppressed_recipient_budget',
           updated_at = now()
     where id = delivery_id;
    outcome := 'recipient_budget';
    return;
  end if;
  outcome := 'queued';
end $$;
revoke all on function public.enqueue_email_outcome(uuid, text, text, uuid, text, jsonb, uuid) from public;
grant execute on function public.enqueue_email_outcome(uuid, text, text, uuid, text, jsonb, uuid) to service_role;

-- --- 1d. Powód odbiorcy kampanii + przyczyna wygaszenia -------------------------------------------
alter table public.email_campaign_recipients drop constraint if exists email_campaign_recipients_reason;
alter table public.email_campaign_recipients add constraint email_campaign_recipients_reason check (
  reason is null or reason in ('opted_out', 'suppressed_address', 'recipient_budget', 'no_email',
                               'send_failed', 'bounced', 'complained', 'superseded', 'cancelled',
                               'unverified_address'));

create or replace function public.sync_email_campaign_recipient()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_reason text;
begin
  if new.campaign_id is null or new.status is not distinct from old.status then return null; end if;
  if new.status in ('sent') then
    v_status := 'accepted';
  elsif new.status in ('delivered', 'opened', 'clicked') then
    v_status := 'delivered';
  elsif new.status = 'complained' then
    v_status := 'delivered'; v_reason := 'complained';
  elsif new.status = 'bounced' then
    v_status := 'failed'; v_reason := 'bounced';
  elsif new.status = 'failed' then
    case new.error_message
      when 'suppressed_opt_out' then v_status := 'skipped_consent'; v_reason := 'opted_out';
      when 'suppressed_unverified_address' then v_status := 'skipped_consent'; v_reason := 'unverified_address';
      when 'suppressed_address' then v_status := 'failed'; v_reason := 'suppressed_address';
      when 'suppressed_recipient_budget' then v_status := 'failed'; v_reason := 'recipient_budget';
      when 'suppressed_campaign_inactive' then
        v_status := 'cancelled';
        v_reason := case when exists (select 1 from public.email_campaigns c
                                        where c.id = new.campaign_id and c.status = 'cancelled')
                         then 'cancelled' else 'superseded' end;
      else v_status := 'failed'; v_reason := 'send_failed';
    end case;
  else
    return null;
  end if;

  update public.email_campaign_recipients r
     set status = v_status, reason = v_reason, updated_at = now()
   where r.delivery_id = new.id
     and r.status is distinct from v_status;
  return null;
end $$;
revoke all on function public.sync_email_campaign_recipient() from public;

-- Definicja z 0175 (0174: newMessage, #1145: szablony procesu) + niepotwierdzony adres (marketing).
create or replace function public.email_delivery_suppression_reason(
  p_profile_id uuid,
  p_template text,
  p_to_email text,
  p_campaign_id uuid,
  p_entity_type text,
  p_entity_id uuid
) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_template = 'newMessage' and not public.recruitment_enabled()
      then 'suppressed_recruitment_disabled'
    when not public.recruitment_enabled() and public.email_recruitment_template(p_template)
      then 'suppressed_feature_disabled'
    when public.email_address_suppressed(p_to_email) then 'suppressed_address'
    -- #1038: marketing nie wychodzi na adres, którego właściciel nie potwierdził.
    when public.email_preference_category(p_template) = 'marketing'
         and not public.email_address_verified(p_profile_id) then 'suppressed_unverified_address'
    when public.email_allowed(p_profile_id, p_template) is not true then 'suppressed_opt_out'
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

-- --- 1e. Paczka kampanii (0101): tylko potwierdzone adresy ----------------------------------------
create or replace function public.enqueue_campaign_batch(p_campaign_id uuid, p_limit integer default 500)
returns table (reserved integer, queued integer, skipped integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.email_campaigns;
  v_pid uuid;
  v_ok uuid;
  v_res record;
  v_locale text;
  v_reserved integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  select * into v_c from public.email_campaigns where id = p_campaign_id for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_c.status <> 'active' then
    return query select 0, 0, 0;
    return;
  end if;

  for v_pid in
    select np.profile_id
      from public.notification_preferences np
     where np.email_marketing
       -- #1038: bez potwierdzonego adresu nikt nie jest rezerwowany (potwierdzi → następna paczka).
       and public.email_address_verified(np.profile_id)
       and not exists (select 1 from public.email_campaign_recipients r
                        where r.campaign_id = v_c.id and r.profile_id = np.profile_id)
       and not exists (select 1 from public.email_campaign_recipients r
                         join public.email_campaigns c on c.id = r.campaign_id
                        where r.profile_id = np.profile_id and c.slug = v_c.slug
                          and c.revision < v_c.revision
                          and r.status in ('queued', 'accepted', 'delivered'))
     order by np.profile_id
     limit greatest(least(coalesce(p_limit, 500), 5000), 0)
  loop
    v_ok := null;
    insert into public.email_campaign_recipients (campaign_id, profile_id, status)
    values (v_c.id, v_pid, 'reserved')
    on conflict (campaign_id, profile_id) do nothing
    returning profile_id into v_ok;
    if v_ok is null then continue; end if;  -- inny harmonogram zarezerwował pierwszy
    v_reserved := v_reserved + 1;

    v_locale := public.resolve_recipient_locale(v_pid);
    select * into v_res from public.enqueue_email_outcome(
      v_pid, v_c.template, 'email_campaign', v_c.id,
      'campaign:' || v_c.id || ':' || v_pid,
      jsonb_build_object('campaignId', v_c.id, 'jobs', v_c.content -> v_locale -> 'jobs'),
      v_c.id);

    if v_res.outcome in ('queued', 'duplicate') then
      update public.email_campaign_recipients
         set status = 'queued', delivery_id = v_res.delivery_id, updated_at = now()
       where campaign_id = v_c.id and profile_id = v_pid and status = 'reserved';
      v_queued := v_queued + 1;
    else
      update public.email_campaign_recipients
         set status = case when v_res.outcome in ('opted_out', 'unverified_address')
                           then 'skipped_consent' else 'failed' end,
             reason = v_res.outcome, delivery_id = v_res.delivery_id, updated_at = now()
       where campaign_id = v_c.id and profile_id = v_pid and status = 'reserved';
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  if v_reserved = 0 then
    -- Wszyscy odbiorcy z chwili wysyłki zarezerwowani: kampania zakończona (nowe zgody
    -- nie dostaną starej edycji). Zakolejkowane listy nadal wychodzą.
    update public.email_campaigns set status = 'completed', closed_at = now()
     where id = v_c.id and status = 'active';
  end if;
  return query select v_reserved, v_queued, v_skipped;
end $$;
revoke all on function public.enqueue_campaign_batch(uuid, integer) from public;
grant execute on function public.enqueue_campaign_batch(uuid, integer) to service_role;

-- --- 2. Język e-maili i powiadomień (#1049) -----------------------------------------------------
create or replace function public.set_my_email_locale(p_locale text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_row_found boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_locale is null or not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: locale' using errcode = '22023';
  end if;

  select p.preferred_locale, true into v_old, v_row_found
    from public.profiles p
   where p.id = v_uid and p.is_active and p.deleted_at is null
   for update;
  if v_row_found is not true then
    raise exception 'PERMISSION_DENIED: profil niedostępny' using errcode = '42501';
  end if;

  if v_old is distinct from p_locale then
    update public.profiles set preferred_locale = p_locale, updated_at = now() where id = v_uid;
    perform public.write_audit('profile.email_locale_changed', 'profile', v_uid,
      jsonb_build_object('preferred_locale', v_old),
      jsonb_build_object('preferred_locale', p_locale));
  end if;
  return p_locale;
end $$;
revoke all on function public.set_my_email_locale(text) from public, anon;
grant execute on function public.set_my_email_locale(text) to authenticated;
