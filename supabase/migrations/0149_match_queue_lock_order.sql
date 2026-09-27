-- =============================================================================
-- 0149_match_queue_lock_order.sql
-- Kolejka `match_recompute_queue` (0147): stała kolejność blokad „wiersz podmiotu →
-- wiersz kolejki”, koniec zakleszczeń przy równoległych zapisach profilu kandydata.
--
-- Błąd: dwa równoległe kroki onboardingu tego samego kandydata (np. podwójne „Dalej”
-- w krokach 3 i 5) kończyły się `deadlock detected` → akcja zwracała INTERNAL.
--   T5 (krok 5): set_candidate_languages → trigger relacji → match_enqueue blokuje wiersz
--                kolejki (candidate, X);
--   T3 (krok 3): UPDATE candidate_profiles (blokada wiersza profilu) → trigger profilu →
--                match_enqueue czeka na wiersz kolejki trzymany przez T5;
--   T5:          set_candidate_certificates → ensure_candidate_profile (INSERT … ON CONFLICT
--                na profilu) czeka na niezatwierdzoną zmianę profilu przez T3 → cykl.
-- Ścieżka relacji brała blokady w kolejności kolejka → profil, ścieżka profilu odwrotnie.
--
-- Poprawka: `match_enqueue` przed zapisem do kolejki blokuje wiersz podmiotu
-- (`candidate_profiles` kandydata albo `jobs` oferty) w trybie FOR NO KEY UPDATE. Każda
-- ścieżka zgłoszenia (triggery profilu, relacji, konta, blokad, wieku, ofert, firmy) bierze
-- więc najpierw wiersz podmiotu, a dopiero potem wiersz kolejki — ta sama kolejność co
-- UPDATE profilu/oferty, więc druga transakcja czeka na pierwszą zamiast tworzyć cykl.
-- FOR NO KEY UPDATE nie koliduje z FOR KEY SHARE (klucze obce relacji i `matches`), więc
-- wstawianie relacji ani zapis workera nie czekają dłużej niż dotąd.
--
-- Semantyka kolejki bez zmian: jeden wiersz na podmiot (PK), ponowne zgłoszenie podbija
-- `version` i zeruje `attempts`, worker materializuje (0147). Podmiot bez wiersza (np.
-- deklaracja wieku przed utworzeniem profilu, usunięty profil) jest kolejkowany jak dotąd.
--
-- Dowód: supabase/tests/rls.sql sekcja MQ233 (dwie sesje przez dblink, kontrola ujemna
-- z definicją z 0147 → deadlock).
-- Rollback: ponowne `create or replace` funkcji `match_enqueue` z 0147 (wraca błąd).
-- =============================================================================

create or replace function public.match_enqueue(p_kind text, p_subject uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_subject is null or p_kind not in ('candidate', 'job') then
    return;
  end if;

  -- Stała kolejność blokad: najpierw wiersz podmiotu, potem wiersz kolejki.
  if p_kind = 'candidate' then
    perform 1 from public.candidate_profiles cp where cp.profile_id = p_subject
      for no key update;
  else
    perform 1 from public.jobs j where j.id = p_subject for no key update;
  end if;

  insert into public.match_recompute_queue as q (kind, subject_id)
  values (p_kind, p_subject)
  on conflict (kind, subject_id) do update
    set version = q.version + 1, attempts = 0, enqueued_at = now();
end $$;
revoke all on function public.match_enqueue(text, uuid) from public, anon, authenticated;
