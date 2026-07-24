-- =============================================================================
-- 0043_consent_receipt.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-24 (warstwa techniczna zgód).
--
-- Problem: klient mógł wstawiać wiersze wprost do `consents` (polityka anon INSERT), omijając
-- rate-limit Server Action → floodowanie/spoofowanie logu zgód. Zapis nie niósł też realnego
-- „receiptu" (visitor_id / wersja dokumentu / IP / UA były w schemacie, ale nieużywane).
--
-- Naprawa (RPC-only, jak reszta granicy zaufania):
--  - odbieramy bezpośredni DML na consents od anon/authenticated (zostaje SELECT własnych);
--  - `record_consent` (SECURITY DEFINER) zapisuje NIEZMIENNY receipt: profile_id (auth.uid()
--    lub null dla anon), visitor_id, per-kategoria granted, AKTUALNA wersja dokumentu 'cookies',
--    źródło z allow-listy, IP (inet) i user-agent — komplet wymagany do rozliczalności (RODO 7).
--
-- UWAGA: wiążącą TREŚĆ prawną (regulamin/polityka) dostarcza właściciel — strony pozostają
-- placeholderem + noindex do czasu zatwierdzenia. To jest wyłącznie warstwa techniczna.
-- =============================================================================

-- Koniec bezpośredniego zapisu klienta (flood/spoof) — RPC definer pisze dalej.
revoke insert, update, delete on public.consents from anon, authenticated;
drop policy if exists consents_insert on public.consents;

create or replace function public.record_consent(
  p_categories  jsonb,
  p_source      text,
  p_visitor_id  text default null,
  p_ip          text default null,
  p_user_agent  text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_src text;
  v_ip inet;
  cat text;
  cats text[] := array['necessary', 'preferences', 'analytics', 'marketing'];
begin
  -- Źródło z allow-listy (nieznane → baner).
  v_src := case when p_source in ('cookie_banner', 'cookie_settings', 'footer', 'onboarding')
                then p_source else 'cookie_banner' end;

  -- Aktualna wersja dokumentu zgód „cookies" (jeśli opublikowana) — element receiptu.
  select id into v_version from public.consent_versions
    where document = 'cookies' and is_current = true
    order by published_at desc nulls last, created_at desc
    limit 1;

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
revoke all on function public.record_consent(jsonb, text, text, text, text) from public;
grant execute on function public.record_consent(jsonb, text, text, text, text) to anon, authenticated;
