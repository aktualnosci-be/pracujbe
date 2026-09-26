-- =============================================================================
-- 0194 (NUMER TYMCZASOWY — ostateczny nada integrator) — wersja polityki cookies
-- w receipcie zgody (K6 z docs/LAUNCH_CHECKLIST.md).
--
-- Problem: cookie `pracujbe_consent` niesie wersję polityki, na którą osoba się zgodziła
-- (`CONSENT_POLICY_VERSION`, domyślnie `2.0`), a serwerowy receipt `consents` zapisywał
-- tylko `consent_version_id` z `consent_versions` (is_current dokumentu `cookies`). Dopóki
-- treść prawna nie jest opublikowana w `consent_versions`, receipt nie mówił, jaką wersję
-- banera zaakceptowano — dowód zgody (RODO art. 7 ust. 1) był niepełny.
--
-- Zmiana:
--   1. `consents.policy_version text` — wersja banera z aplikacji (1–32 znaki
--      `[0-9A-Za-z._-]`, CHECK). Stare wiersze = NULL (receipty są niezmienne, bez backfillu).
--   2. `record_consent(…, p_policy_version text default null)`: wartość spoza wzorca jest
--      zapisywana jako NULL — zła wersja nie może zablokować zapisu zgody. Stara sygnatura
--      (5 argumentów) usunięta; nowa ma domyślny argument, więc wywołanie bez wersji
--      (poprzednie wdrożenie aplikacji w trakcie rolloutu) nadal działa.
--   3. Kategorie, źródła, IP/UA i `consent_version_id` — bez zmian względem 0130.
--
-- Rollback: odtworzyć `record_consent` z 0130; kolumna może zostać (NULL-owalna).
-- Dowód: supabase/tests/rls.sql sekcja CPV194 (z kontrolą ujemną).
-- =============================================================================

alter table public.consents
  add column if not exists policy_version text;
alter table public.consents
  drop constraint if exists consents_policy_version_format;
alter table public.consents
  add constraint consents_policy_version_format
  check (policy_version is null or policy_version ~ '^[0-9A-Za-z._-]{1,32}$');

drop function if exists public.record_consent(jsonb, text, text, text, text);

create or replace function public.record_consent(
  p_categories     jsonb,
  p_source         text,
  p_visitor_id     text default null,
  p_ip             text default null,
  p_user_agent     text default null,
  p_policy_version text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_src text;
  v_ip inet;
  v_policy text;
  cat text;
  cats text[] := array['necessary', 'preferences', 'analytics'];
begin
  -- Źródło z allow-listy (nieznane → baner).
  v_src := case when p_source in ('cookie_banner', 'cookie_settings', 'footer', 'onboarding')
                then p_source else 'cookie_banner' end;

  -- Aktualna wersja dokumentu zgód „cookies" (jeśli opublikowana) — element receiptu.
  select id into v_version from public.consent_versions
    where document = 'cookies' and is_current = true
    order by published_at desc nulls last, created_at desc
    limit 1;

  -- Wersja banera z aplikacji; spoza wzorca → NULL (zapis zgody nie może się nie udać).
  v_policy := case when btrim(coalesce(p_policy_version, '')) ~ '^[0-9A-Za-z._-]{1,32}$'
                   then btrim(p_policy_version) end;

  -- IP jako inet; błędny format nie może wywalić zapisu zgody.
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  foreach cat in array cats loop
    insert into public.consents
      (profile_id, visitor_id, category, granted, consent_version_id, policy_version, source,
       ip_address, user_agent)
    values (
      v_uid,
      nullif(left(coalesce(p_visitor_id, ''), 128), ''),
      cat::public.consent_category,
      case when cat = 'necessary' then true
           else coalesce((p_categories ->> cat)::boolean, false) end,
      v_version,
      v_policy,
      v_src,
      v_ip,
      nullif(left(coalesce(p_user_agent, ''), 512), '')
    );
  end loop;
end $$;
revoke all on function public.record_consent(jsonb, text, text, text, text, text) from public;
grant execute on function public.record_consent(jsonb, text, text, text, text, text) to anon, authenticated;
