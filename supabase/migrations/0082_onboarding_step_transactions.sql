-- =============================================================================
-- 0082 — onboarding kandydata: jeden krok = jedna transakcja (#142).
--
-- Kroki 3 i 5 kreatora składały się z kilku osobnych żądań (upsert doświadczenia +
-- set_candidate_skills; set_candidate_languages + set_candidate_certificates). Każde żądanie
-- zatwierdzało się samo, więc błąd drugiej części zostawiał pierwszą zapisaną, choć akcja
-- zwracała niepowodzenie. Dodajemy po jednej funkcji na cały krok:
--
--   save_candidate_onboarding_step3(p_experience_years, p_skills)
--   save_candidate_onboarding_step5(p_languages, p_certificates)
--
-- Jedno wywołanie funkcji = jedna instrukcja = jedna transakcja: dowolny błąd w środku
-- wycofuje cały krok. Autoryzacja (zalogowany + rola kandydata) jest w
-- ensure_candidate_profile(); limity, normalizacja i replace-all pochodzą z tych samych
-- funkcji set_candidate_* (0028/0079), które wołamy wewnątrz. Retry z tymi samymi danymi
-- daje ten sam stan (replace-all + dedup), bez duplikatów.
--
-- Rollback: `drop function public.save_candidate_onboarding_step3(integer, text[]);`
-- i `drop function public.save_candidate_onboarding_step5(jsonb, jsonb);`. Dane bez zmian.
-- =============================================================================

create function public.save_candidate_onboarding_step3(p_experience_years integer, p_skills text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cp uuid := public.ensure_candidate_profile();
begin
  if p_experience_years is null or p_experience_years < 0 or p_experience_years > 60 then
    raise exception 'VALIDATION_FAILED: experience_years' using errcode = '22023';
  end if;
  update public.candidate_profiles set experience_years = p_experience_years where id = v_cp;
  perform public.set_candidate_skills(p_skills);
end $$;
revoke all on function public.save_candidate_onboarding_step3(integer, text[]) from public, anon;
grant execute on function public.save_candidate_onboarding_step3(integer, text[]) to authenticated;

create function public.save_candidate_onboarding_step5(p_languages jsonb, p_certificates jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.ensure_candidate_profile();
  if p_languages is not null and jsonb_typeof(p_languages) <> 'array' then
    raise exception 'VALIDATION_FAILED: languages must be an array' using errcode = '22023';
  end if;
  perform public.set_candidate_languages(p_languages);
  perform public.set_candidate_certificates(p_certificates);
end $$;
revoke all on function public.save_candidate_onboarding_step5(jsonb, jsonb) from public, anon;
grant execute on function public.save_candidate_onboarding_step5(jsonb, jsonb) to authenticated;
