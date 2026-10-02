-- =============================================================================
-- 0210_p2_concurrency_fixes.sql — trzy poprawki współbieżności i spójności (P2).
--
-- NUMER TYMCZASOWY (0210) — ostateczny nadaje integrator. Zależy od 0086/0121/0133/0178
-- (zaproszenia), 0101/0186 (kampanie) i 0145/0146/0190 (kolejka tłumaczeń).
--
-- 1. #906 — `enqueue_campaign_batch`: równoległe paczki tej samej kampanii są serializowane
--    blokadą wiersza kampanii (`FOR NO KEY UPDATE` zamiast `FOR SHARE`). Druga paczka czeka
--    na zatwierdzenie pierwszej, a jej zapytanie o odbiorców (nowa instrukcja = nowy snapshot
--    w READ COMMITTED) widzi już rezerwacje pierwszej. Kampania przechodzi w `completed`
--    tylko wtedy, gdy zapytanie nie znalazło ŻADNEGO kandydata do rezerwacji — konflikt
--    rezerwacji (inna ścieżka zapisu) nie kończy już kampanii przedwcześnie.
--    `FOR NO KEY UPDATE` nie blokuje kluczy obcych (`FOR KEY SHARE`) z `email_deliveries`
--    i `email_campaign_recipients`. Treść funkcji = 0186 poza blokadą i warunkiem końca.
--
-- 2. #802 — `sync_job_translation_source`: stan firmy czytany z blokadą `FOR SHARE` wiersza
--    firmy. Zmiana statusu firmy trzyma blokadę wiersza do zatwierdzenia, więc odroczona
--    synchronizacja wznowionej (albo opublikowanej) oferty czeka na koniec zawieszenia firmy
--    i widzi już `suspended` — źródło zostaje nieaktywne, zadania nie wracają do kolejki.
--    W odwrotnej kolejności zawieszenie czeka na zatwierdzenie oferty, a jego synchronizacja
--    widzi już ofertę aktywną i ją ukrywa. Wiersz oferty jest czytany bez blokady (strona
--    firmowa nie blokuje ofert — bez tego zakleszczenie z transakcją oferty). Treść = 0190
--    poza klauzulą `for share of c`. Ponowna synchronizacja aktywnych źródeł ofert naprawia
--    źródła reaktywowane wcześniej przez ten wyścig.
--
-- 3. #793 — `invite_company_member`: odświeżenie zaproszenia dla adresu bez konta zmienia
--    token rejestracyjny WYŁĄCZNIE po udanym zakolejkowaniu e-maila z nowym tokenem. Gdy
--    limit 3 e-maili na adres w 24 h (0133) odmawia, zostaje dotychczasowy token — link
--    z ostatnio wysłanego e-maila nadal działa (preview/consume). Rola, ważność i język
--    są odświeżane jak dotąd. Wynik funkcji się nie zmienia (bez ujawniania, czy adres ma
--    konto i czy limit zadziałał). Adres z kontem: bez zmian (token wymieniany, jak w 0121).
--    Treść = 0178 poza miejscem wymiany tokenu.
--
-- Rollback: supabase/rollback/0210_p2_concurrency_fixes.down.sql (definicje z 0186, 0190
-- i 0178). Testy: supabase/tests/rls.sql sekcja P2C994 (dblink, kontrole ujemne),
-- supabase/tests/p2-concurrency-rollback.sql.
-- =============================================================================

-- --- 1. Paczka kampanii (#906) --------------------------------------------------------------------
create or replace function public.enqueue_campaign_batch(p_campaign_id uuid, p_limit integer default 500)
returns table (reserved integer, queued integer, skipped integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.email_campaigns;
  v_pid uuid;
  v_ok uuid;
  v_res record;
  v_locale text;
  v_seen integer := 0;
  v_reserved integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  -- #906: jedna paczka danej kampanii naraz. Druga czeka tu na zatwierdzenie pierwszej, po
  -- czym widzi świeży status kampanii i (w zapytaniu niżej) jej rezerwacje.
  select * into v_c from public.email_campaigns where id = p_campaign_id for no key update;
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
    v_seen := v_seen + 1;
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

  -- #906: koniec kampanii tylko, gdy nie było już NIKOGO do rezerwacji. Paczka, której
  -- wszystkie próby trafiły na konflikt (`v_reserved = 0`, `v_seen > 0`), nie kończy
  -- kampanii — dalsi odbiorcy dostaną kolejną paczkę.
  if v_seen = 0 then
    -- Wszyscy odbiorcy z chwili wysyłki zarezerwowani: kampania zakończona (nowe zgody
    -- nie dostaną starej edycji). Zakolejkowane listy nadal wychodzą.
    update public.email_campaigns set status = 'completed', closed_at = now()
     where id = v_c.id and status = 'active';
  end if;
  return query select v_reserved, v_queued, v_skipped;
end $$;
revoke all on function public.enqueue_campaign_batch(uuid, integer) from public;
grant execute on function public.enqueue_campaign_batch(uuid, integer) to service_role;

-- --- 2. Synchronizacja źródła tłumaczeń oferty (#802) ----------------------------------------------
create or replace function public.sync_job_translation_source(p_job_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job record;
  v_src record;
  v_res jsonb;
begin
  if p_job_id is null then return 'purged'; end if;

  -- #802: blokada wiersza FIRMY (nie oferty) — trwająca zmiana statusu firmy kończy się,
  -- zanim oferta zdecyduje o aktywacji źródła; po oczekiwaniu wiersz firmy jest świeży.
  select j.status::text as status, j.deleted_at, j.expires_at, j.is_demo,
         c.status::text as company_status, c.deleted_at as company_deleted_at,
         c.name as company_name
    into v_job
    from public.jobs j join public.companies c on c.id = j.company_id
   where j.id = p_job_id
   for share of c;

  if not found or v_job.deleted_at is not null then
    perform public.deactivate_translation_source('job', p_job_id, true);
    return 'purged';
  end if;

  if v_job.status <> 'active'
     or (v_job.expires_at is not null and v_job.expires_at <= now())
     or v_job.company_status <> 'verified' or v_job.company_deleted_at is not null
     or v_job.is_demo then
    perform public.deactivate_translation_source('job', p_job_id, false);
    return 'hidden';
  end if;

  select * into v_src from public.job_translation_source_fields(p_job_id);
  begin
    -- #740: nazwa firmy z bazy (nigdy od klienta) = nazwa chroniona rewizji.
    v_res := public.record_translation_source('job', p_job_id, v_src.source_locale, v_src.fields,
                                              public.translation_pipeline_version(), 0,
                                              array[v_job.company_name]);
  exception when sqlstate '22023' then
    -- Treść poza limitami rdzenia: publikacja idzie dalej, stare przekłady nie udają aktualnych.
    perform public.deactivate_translation_source('job', p_job_id, false);
    return 'skipped';
  end;
  return v_res->>'status';
end $$;
revoke all on function public.sync_job_translation_source(uuid) from public;
grant execute on function public.sync_job_translation_source(uuid) to service_role;

-- Naprawa skutków wyścigu: aktywne źródło oferty niepublicznej (np. firma zawieszona) zostaje
-- ukryte, oferta publiczna bez zmian treści = no-op.
select count(public.sync_job_translation_source(s.entity_id))
  from public.translation_sources s
 where s.entity_type = 'job' and s.is_active;

-- --- 3. Zaproszenie: token tylko z wysłanym e-mailem (#793) ---------------------------------------
create or replace function public.invite_company_member(
  p_company_id uuid, p_email text, p_role text,
  p_locale text, p_signup_token_hash text, p_signup_nonce text
) returns table (invitation_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role public.company_member_role;
  v_company_name text;
  v_existing uuid;
  v_id uuid;
  v_created boolean;
  v_invitee uuid;
  v_has_account boolean;
  v_sent boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'recruiter', 'member') then
    raise exception 'VALIDATION_FAILED: rola' using errcode = '22023';
  end if;
  v_role := p_role::public.company_member_role;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED: e-mail' using errcode = '22023';
  end if;
  if not public.is_supported_locale(p_locale) then
    raise exception 'VALIDATION_FAILED: język zaproszenia' using errcode = '22023';
  end if;
  if p_signup_token_hash is null or p_signup_token_hash !~ '^[0-9a-f]{64}$'
     or p_signup_nonce is null or p_signup_nonce !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'VALIDATION_FAILED: token' using errcode = '22023';
  end if;
  if not public.can_manage_company_role(p_company_id, v_role) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  select c.name into v_company_name from public.companies c
    where c.id = p_company_id and c.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.company_members cm
    join auth.users u on u.id = cm.profile_id
    where cm.company_id = p_company_id and cm.is_active and lower(u.email::text) = v_email
  ) then
    raise exception 'MEMBER_ALREADY_EXISTS' using errcode = '23505';
  end if;

  -- Wygasłe oczekujące zaproszenie nie blokuje nowego.
  update public.company_invitations
    set status = 'revoked', responded_at = now()
    where company_id = p_company_id and email = v_email::public.citext
      and status = 'pending' and expires_at <= now();

  v_has_account := exists (select 1 from auth.users u where lower(u.email::text) = v_email);

  select i.id into v_existing from public.company_invitations i
    where i.company_id = p_company_id and i.email = v_email::public.citext
      and i.status = 'pending'
    for update;
  if v_existing is not null then
    -- Odświeżenie: rola, ważność, język. Token (#793): dla adresu z kontem od razu nowy
    -- (jak w 0121); dla adresu bez konta dopiero po udanym zakolejkowaniu e-maila niżej.
    update public.company_invitations
      set role = v_role, expires_at = now() + interval '14 days', invited_by = v_uid,
          locale = p_locale,
          signup_token_hash = case when v_has_account then p_signup_token_hash else signup_token_hash end,
          signup_token_used_at = case when v_has_account then null else signup_token_used_at end
      where id = v_existing;
    perform public.write_audit('company.member_invitation_updated', 'company', p_company_id,
      null, jsonb_build_object('invitation_id', v_existing, 'role', v_role, 'locale', p_locale));
    v_id := v_existing;
    v_created := false;
  else
    -- #893: liczymy tylko zaproszenia jeszcze WAŻNE (jak panel, get_company_invitations) —
    -- dawno wygasłe, nieodwiedzone rekordy nie zajmują limitu na zawsze.
    if (select count(*) from public.company_invitations i
          where i.company_id = p_company_id and i.status = 'pending'
            and i.expires_at > now()) >= 50 then
      raise exception 'INVITATION_LIMIT_REACHED' using errcode = '54000';
    end if;

    insert into public.company_invitations
      (company_id, email, role, invited_by, locale, signup_token_hash)
      values (p_company_id, v_email::public.citext, v_role, v_uid, p_locale, p_signup_token_hash)
      returning id into v_id;
    perform public.write_audit('company.member_invited', 'company', p_company_id,
      null, jsonb_build_object('invitation_id', v_id, 'role', v_role, 'locale', p_locale));
    v_created := true;
  end if;

  if v_created then
    -- Istniejące aktywne konto pracodawcy: powiadomienie + e-mail w języku ODBIORCY (0086).
    select p.id into v_invitee
      from auth.users u join public.profiles p on p.id = u.id
      where lower(u.email::text) = v_email
        and p.role = 'employer' and p.is_active and p.deleted_at is null
      limit 1;
    if v_invitee is not null then
      insert into public.notifications (profile_id, type, title, entity_type, entity_id)
        values (v_invitee, 'system', 'company_invitation', 'company_invitation', v_id);
      perform public.enqueue_email(v_invitee, 'teamInvitation', 'company_invitation', v_id,
        'team-invitation:' || v_id::text,
        jsonb_build_object('panel', 'employer',
                           'companyName', v_company_name,
                           'inviterName', coalesce(public.profile_full_name(v_uid), '')));
    end if;
  end if;

  -- Adres bez konta: link rejestracji pracodawcy w jawnie wybranym języku zaproszenia.
  -- Konto kandydata/nieaktywne: bez e-maila (jak w 0086). Wynik funkcji jest taki sam
  -- w każdym przypadku (także gdy limit e-maili odmówił).
  if not v_has_account then
    v_sent := public.enqueue_team_invitation_signup_email(v_id, v_email::public.citext, p_locale,
      'teamInvitationSignup', p_signup_token_hash,
      jsonb_build_object('nonce', p_signup_nonce,
                         'companyName', v_company_name,
                         'inviterName', coalesce(public.profile_full_name(v_uid), '')));
    -- #793: nowy token tylko razem z e-mailem, który go niesie. Odmowa limitu = zostaje
    -- token z ostatnio wysłanego e-maila (jego link nadal działa).
    if v_sent and not v_created then
      update public.company_invitations
        set signup_token_hash = p_signup_token_hash, signup_token_used_at = null
        where id = v_id;
    end if;
  end if;

  return query select v_id, v_created;
end $$;
revoke all on function public.invite_company_member(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.invite_company_member(uuid, text, text, text, text, text) to authenticated;
