-- =============================================================================
-- 0130_consent_without_marketing.sql — #570: log zgód bez kategorii `marketing`
-- (numer tymczasowy — ostateczny nada integrator).
--
-- Decyzja właściciela (25.09.2026): po usunięciu Google Analytics i Meta Pixel portal nie
-- używa trackerów marketingowych, więc kategoria cookies „Marketing” znika z banera i centrum
-- zgód, a wersja polityki cookies (`NEXT_PUBLIC_CONSENT_POLICY_VERSION`) idzie w górę.
--
-- `record_consent` (ciało z 0043) zapisywał stałą listę czterech kategorii — bez zmiany
-- każda nowa zgoda dopisywałaby wiersz „marketing: odmowa” dla kategorii, której użytkownik
-- nie widział. Teraz receipt obejmuje necessary/preferences/analytics; klucz `marketing`
-- w `p_categories` (np. ze starego klienta) jest ignorowany.
--
-- Wartość `marketing` zostaje w enumie `consent_category`: historyczne wiersze `consents`
-- są niezmiennym dowodem (RODO art. 7 ust. 1) i nie są przepisywane ani usuwane.
--
-- Rollback: odtworzyć `record_consent` z 0043 (lista z `marketing`). Migracja nie zmienia danych.
-- =============================================================================

create or replace function public.record_consent(
  p_categories  jsonb,
  p_source      text,
  p_visitor_id  text default null,
  p_ip          text default null,
  p_user_agent  text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_src text;
  v_ip inet;
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
