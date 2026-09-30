-- Rollback 0991 (numer tymczasowy): indeksy FK/usuwania konta (#1245) i reguła znaków
-- sterujących w nazwach (#1244). Oczyszczonych nazw nie przywracamy (dane bez CR/LF są
-- poprawne także dla starej wersji). save_saved_search wraca do definicji z 0092.
drop index if exists public.idx_notifications_entity;
drop index if exists public.idx_email_deliveries_entity;
drop index if exists public.idx_saved_search_alerts_profile;
drop index if exists public.idx_jobs_created_by;
drop index if exists public.idx_offers_sender;
drop index if exists public.idx_application_status_history_changed_by;
drop index if exists public.idx_offer_status_history_changed_by;
drop index if exists public.idx_conversations_created_by;
drop index if exists public.idx_contact_messages_sender;
drop index if exists auth.email_outbox_user_idx;

alter table public.saved_searches drop constraint if exists saved_searches_name_no_control;
alter table public.companies drop constraint if exists companies_name_no_control;

create or replace function public.save_saved_search(
  p_name text,
  p_locale text,
  p_filters jsonb,
  p_query text default '',
  p_frequency text default 'daily'
) returns table (saved_search_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_filters jsonb;
  v_hash text;
  v_name text := btrim(coalesce(p_name, ''));
  v_query text := coalesce(p_query, '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'candidate' and p.deleted_at is null
  ) then
    raise exception 'PERMISSION_DENIED: tylko kandydat zapisuje wyszukiwania' using errcode = '42501';
  end if;
  if not coalesce(public.is_supported_locale(p_locale), false) then
    raise exception 'VALIDATION_FAILED: nieobsługiwany język' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'VALIDATION_FAILED: nazwa wymagana (1–80 znaków)' using errcode = '22023';
  end if;
  if char_length(v_query) > 2000 or (v_query <> '' and left(v_query, 1) <> '?') then
    raise exception 'VALIDATION_FAILED: nieprawidłowy adres wyszukiwania' using errcode = '22023';
  end if;
  if coalesce(p_frequency, 'daily') not in ('daily', 'weekly') then
    raise exception 'VALIDATION_FAILED: nieprawidłowa częstotliwość' using errcode = '22023';
  end if;

  v_filters := public.saved_search_canonical_filters(p_filters, p_locale);
  v_hash := md5(v_filters::text);

  -- Blokada profilu serializuje równoległe zapisy tego samego kandydata (limit + unikat).
  perform 1 from public.profiles where id = v_uid for update;

  select s.id into v_id from public.saved_searches s
    where s.profile_id = v_uid and s.filters_hash = v_hash;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  if (select count(*) from public.saved_searches s where s.profile_id = v_uid) >= 20 then
    raise exception 'SAVED_SEARCH_LIMIT_REACHED: najwyżej 20 zapisanych wyszukiwań' using errcode = '42501';
  end if;

  insert into public.saved_searches
    (profile_id, name, locale, filters, filters_hash, query, frequency,
     last_checked_at, next_run_at)
  values
    (v_uid, v_name, p_locale, v_filters, v_hash, v_query, coalesce(p_frequency, 'daily'),
     now(), now() + case coalesce(p_frequency, 'daily')
                      when 'weekly' then interval '7 days' else interval '1 day' end)
  returning id into v_id;

  return query select v_id, true;
end $$;
revoke all on function public.save_saved_search(text, text, jsonb, text, text) from public, anon;
grant execute on function public.save_saved_search(text, text, jsonb, text, text) to authenticated;
