-- =============================================================================
-- 0225_consent_receipt_locale.sql (#672) — numer tymczasowy, ostateczny nada integrator.
--
-- Problem: `record_consent` (0142) dobierał wiersz `consent_versions` wyłącznie po
-- document='cookies' i `version`. Tabela dopuszcza osobne wiersze tej samej wersji dla
-- każdego języka (`unique (document, version, locale)`), więc receipt zgody złożonej na
-- banerze po polsku mógł wskazać np. wiersz `nl` (wybór po dacie publikacji), a przy
-- równych datach — zależnie od planu zapytania.
--
-- Naprawa: nowy, OPCJONALNY parametr `p_locale` (język banera; wartość spoza
-- `supported_locales` = brak). Wybór wiersza jest deterministyczny, z jawnym fallbackiem:
--   1. wiersz w języku banera (`locale = p_locale`),
--   2. wiersz wspólny dla wszystkich języków (`locale is null`),
--   3. wiersz angielski (`en` — język domyślny serwisu),
--   4. pozostałe języki alfabetycznie po kodzie (brak tłumaczenia tej wersji),
--   remis: published_at desc, created_at desc, id.
-- Ta sama kolejność obowiązuje dla wersji z klienta (`p_version`, tylko opublikowane —
-- jak w 0142) i dla fallbacku do bieżącej wersji (`is_current`). Bez `p_locale` (stary
-- klient) kolejność zaczyna się od kroku 2 — wynik jest deterministyczny.
--
-- Zgodność: JEDYNY wołający to `recordConsent` (src/lib/actions/consent.ts), aktualizowany
-- w tym samym PR. Sygnatura 6-argumentowa z 0142 jest usuwana (bez dwóch przeciążeń);
-- wywołania 6-argumentowe działają dalej dzięki wartości domyślnej `p_locale`.
-- Rollback: supabase/rollback/0225_consent_receipt_locale.down.sql.
-- =============================================================================

drop function if exists public.record_consent(jsonb, text, text, text, text, text);

create or replace function public.record_consent(
  p_categories  jsonb,
  p_source      text,
  p_visitor_id  text default null,
  p_ip          text default null,
  p_user_agent  text default null,
  p_version     text default null,
  p_locale      text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_version_wanted text;
  v_locale text;
  v_src text;
  v_ip inet;
  cat text;
  cats text[] := array['necessary', 'preferences', 'analytics'];
begin
  -- Źródło z allow-listy (nieznane → baner).
  v_src := case when p_source in ('cookie_banner', 'cookie_settings', 'footer', 'onboarding')
                then p_source else 'cookie_banner' end;

  -- Język banera ze słownika języków serwisu (bez kopii listy w SQL); inna wartość = brak.
  v_locale := case when coalesce(public.is_supported_locale(p_locale), false) then p_locale end;

  -- Wersja z klienta — tylko OPUBLIKOWANY wiersz dokumentu 'cookies' (jak w 0142),
  -- wiersz językowy wg kolejności z nagłówka migracji.
  v_version_wanted := nullif(btrim(coalesce(left(p_version, 64), '')), '');
  if v_version_wanted is not null then
    select id into v_version from public.consent_versions
      where document = 'cookies' and version = v_version_wanted
        and published_at is not null and published_at <= now()
      order by (v_locale is not null and locale = v_locale) desc,
               (locale is null) desc,
               (locale = 'en') desc nulls last, locale,
               published_at desc nulls last, created_at desc, id
      limit 1;
  end if;

  -- Brak/nieznana wersja klienta → bieżąca wersja 'cookies', ta sama kolejność języków.
  if v_version is null then
    select id into v_version from public.consent_versions
      where document = 'cookies' and is_current = true
      order by (v_locale is not null and locale = v_locale) desc,
               (locale is null) desc,
               (locale = 'en') desc nulls last, locale,
               published_at desc nulls last, created_at desc, id
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
revoke all on function public.record_consent(jsonb, text, text, text, text, text, text) from public;
grant execute on function public.record_consent(jsonb, text, text, text, text, text, text) to anon, authenticated;
