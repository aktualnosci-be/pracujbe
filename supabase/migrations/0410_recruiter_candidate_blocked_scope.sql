-- =============================================================================
-- 0410 — blokada firmy przez kandydata egzekwowana per FIRMA aplikacji, nie per
-- DOWOLNA firma rekrutera (#912). NUMER TYMCZASOWY — ostateczny nada integrator.
--
-- Problem: `company_can_view_candidate(candidate_id)` (0078/0033/0027) odpowiada „tak", gdy
-- WYWOŁUJĄCY ma niezablokowaną relację (aplikacja/propozycja) z kandydatem przez DOWOLNĄ
-- zarządzaną firmę — RLS `profiles_select_company_candidate` i `candidate_profiles_select_company`
-- (0009) korzystają z tej samej funkcji. Rekruter aktywny w firmach A i B, z historyczną
-- aplikacją kandydata C do obu, nadal widział profil/PII C w szczególe zgłoszenia A, mimo że C
-- zablokował właśnie A — bo niezablokowana relacja z B "przykrywała" blokadę A. Ogólna funkcja
-- zostaje bez zmian (używana też przy wyszukiwaniu/wiadomościach, gdzie zakres "dowolna firma
-- wywołującego" jest zamierzony).
--
-- Naprawa jest w WARSTWIE ODCZYTU konkretnej aplikacji/kandydata, nie w RLS: nowa funkcja
-- `recruiter_candidate_blocked(p_candidate_id, p_company_id)` odpowiada na pytanie "czy TA
-- firma jest zablokowana przez TEGO kandydata", ale TYLKO gdy wywołujący jest aktywnym
-- recruiter+ TEJ firmy (inaczej `true` — fail-closed, brak wycieku samego faktu blokady).
-- `getEmployerApplicationDetail`/`getEmployerCandidateDetail` (src/lib/data/employer.ts)
-- odczytują flagę obok reszty danych i pomijają profil/imię, gdy blokada dotyczy AKTYWNEJ
-- firmy — niezależnie od tego, co pozwoliłaby przeczytać ambientna RLS przez inną firmę.
-- Historia zgłoszeń (status, wiadomość nadesłana firmie, wiadomość) zostaje nietknięta —
-- zgodnie z zasadą 0078 "Historia (aplikacje, ...) zostaje nietknięta".
--
-- Rollback: `drop function public.recruiter_candidate_blocked(uuid, uuid);` — kod aplikacji
-- (0410) przestaje wtedy dostawać flagę `blocked` z zapytań (traktuje jej brak jako `false`,
-- czyli wraca do stanu SPRZED tej migracji — nie do awarii).
-- =============================================================================

create or replace function public.recruiter_candidate_blocked(p_candidate_id uuid, p_company_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_candidate_id is null or p_company_id is null then false
    when exists (
      select 1 from public.company_members cm
      where cm.company_id = p_company_id
        and cm.profile_id = auth.uid()
        and cm.is_active = true
        and cm.role in ('owner', 'admin', 'recruiter')
    )
    then public.candidate_blocked_company(p_candidate_id, p_company_id)
    -- Wywołujący nie zarządza tą firmą: fail-closed (nie ujawniamy stanu blokady ani PII).
    else true
  end;
$$;
revoke all on function public.recruiter_candidate_blocked(uuid, uuid) from public, anon;
grant execute on function public.recruiter_candidate_blocked(uuid, uuid) to authenticated;
