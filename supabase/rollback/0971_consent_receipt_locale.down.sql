-- =============================================================================
-- Rollback 0971_consent_receipt_locale.sql (#672) — ręczny, NIE jest migracją.
-- Przywraca `record_consent` z 0142 (6 argumentów, bez `p_locale`).
-- Test: supabase/tests/consent-receipt-locale-rollback.sql.
-- =============================================================================

drop function if exists public.record_consent(jsonb, text, text, text, text, text, text);

create or replace function public.record_consent(
  p_categories  jsonb,
  p_source      text,
  p_visitor_id  text default null,
  p_ip          text default null,
  p_user_agent  text default null,
  p_version     text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_version_wanted text;
  v_src text;
  v_ip inet;
  cat text;
  cats text[] := array['necessary', 'preferences', 'analytics'];
begin
  -- Źródło z allow-listy (nieznane → baner).
  v_src := case when p_source in ('cookie_banner', 'cookie_settings', 'footer', 'onboarding')
                then p_source else 'cookie_banner' end;

  -- Wersja z klienta (obcięta, pusta = brak) — przyjmujemy TYLKO, jeśli realnie istnieje
  -- jako OPUBLIKOWANY wiersz dokumentu 'cookies' (published_at ustawione i nie w przyszłości:
  -- szkic albo wersja zaplanowana na później nie mogła być pokazana użytkownikowi);
  -- inaczej cichy fallback do bieżącej (jak w 0043/0130).
  v_version_wanted := nullif(btrim(coalesce(left(p_version, 64), '')), '');
  if v_version_wanted is not null then
    select id into v_version from public.consent_versions
      where document = 'cookies' and version = v_version_wanted
        and published_at is not null and published_at <= now()
      order by is_current desc, published_at desc nulls last, created_at desc
      limit 1;
  end if;

  -- Brak/nieznana wersja klienta → aktualna wersja dokumentu zgód „cookies" (element receiptu).
  if v_version is null then
    select id into v_version from public.consent_versions
      where document = 'cookies' and is_current = true
      order by published_at desc nulls last, created_at desc
      limit 1;
  end if;

  -- IP jako inet; błędny format nie może wywalić zapisu zgody.
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  foreach cat in array cats loop
    insert into public.consents
      (profile_id, visitor_id, category, granted, consent_version_id, source, ip_address, user_agent)
    values (
      v_uid,
      nullif(left(coalesce(p_visitor_id, ''), 128), ''),
      cat::public.consent_category,
      case when cat = 'necessary' then true
           else coalesce((p_categories ->> cat)::boolean, false) end,
      v_version,
      v_src,
      v_ip,
      nullif(left(coalesce(p_user_agent, ''), 512), '')
    );
  end loop;
end $$;
revoke all on function public.record_consent(jsonb, text, text, text, text, text) from public;
grant execute on function public.record_consent(jsonb, text, text, text, text, text) to anon, authenticated;
