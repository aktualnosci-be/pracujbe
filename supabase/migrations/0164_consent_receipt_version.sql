-- =============================================================================
-- 0164_consent_receipt_version.sql  (numer tymczasowy — integrator nada ostateczny)
-- Dokończenie #349: receipt zgody cookies ma zapisywać wersję polityki, którą
-- użytkownik FAKTYCZNIE widział (z cookie klienta), a nie zawsze bieżącą.
--
-- Problem: `record_consent` (0043) zawsze dobierał AKTUALNĄ wersję dokumentu 'cookies'
-- (is_current = true) — jeśli polityka zmieniła się MIĘDZY wyświetleniem baneru a wysyłką
-- (albo klient miał starszy cookie), receipt kłamał o tym, co użytkownik naprawdę widział.
--
-- Naprawa (bezpiecznie — bez ufania klientowi na ślepo):
--  - `record_consent` przyjmuje nowy, OPCJONALNY parametr `p_version` (tekst wersji z cookie
--    klienta, `ConsentRecord.v` w `src/lib/consent.ts`);
--  - serwer PRZYJMUJE tę wersję TYLKO, jeśli istnieje jako wiersz `consent_versions` dla
--    document='cookies' (dowolne `locale`, niekoniecznie `is_current` — polityka mogła się
--    zmienić już po tym, jak użytkownik ją zaakceptował, a receipt ma mówić prawdę o momencie
--    zgody, nie o stanie bieżącym);
--  - gdy wersja nieznana/brak parametru → CICHY FALLBACK do bieżącej wersji 'cookies'
--    (dokładnie jak w 0043) — NIE odrzucamy całego receiptu (log zgód jest best-effort,
--    Invariant #8: awaria pomocniczego logu nie może zaburzyć zapisu zgody w przeglądarce)
--    i NIE dodajemy nowej kolumny/flagi do `consents` — kolumna `consent_version_id` i tak
--    wskazuje realny wiersz `consent_versions`, więc audytor odróżni „wersja z klienta"
--    od „fallback na bieżącą" przez proste porównanie z `is_current`/`published_at` tego wiersza.
--
-- Zgodność: JEDYNY wołający to `recordConsent` (src/lib/actions/consent.ts) — zastępujemy
-- starą sygnaturę (5 argumentów) nową (6. argument `p_version`, DOMYŚLNIE null) i aktualizujemy
-- tego jedynego wołającego w tym samym PR. Stara sygnatura jest jawnie usuwana (DROP), żeby
-- w bazie nie zostały dwa przeciążenia tej samej funkcji.
-- =============================================================================

drop function if exists public.record_consent(jsonb, text, text, text, text);

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
  cats text[] := array['necessary', 'preferences', 'analytics', 'marketing'];
begin
  -- Źródło z allow-listy (nieznane → baner).
  v_src := case when p_source in ('cookie_banner', 'cookie_settings', 'footer', 'onboarding')
                then p_source else 'cookie_banner' end;

  -- Wersja z klienta (obcięta, pusta = brak) — przyjmujemy TYLKO, jeśli realnie istnieje
  -- jako wiersz dokumentu 'cookies'; inaczej cichy fallback do bieżącej (jak w 0043).
  v_version_wanted := nullif(btrim(coalesce(left(p_version, 64), '')), '');
  if v_version_wanted is not null then
    select id into v_version from public.consent_versions
      where document = 'cookies' and version = v_version_wanted
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
