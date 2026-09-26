-- =============================================================================
-- 0134_ai_budget_gc.sql — #609: porzucone rezerwacje budżetu AI mają TTL i nie blokują
-- limitów na stałe.
--
-- Numer migracji tymczasowy (sesja potomna) — koordynator nadaje ostateczny.
--
-- Kontekst: rezerwacja z `ai_budget_reserve` (0120) zostaje w `ai_usage_ledger` ze
-- statusem 'reserved' aż do `ai_budget_settle`. Jeśli proces skończy się MIĘDZY
-- rezerwacją a rozliczeniem (crash/restart/redeploy/timeout), wiersz nigdy się nie
-- rozlicza — `ai_budget_spent` liczy go w całości bezterminowo, więc pojedyncza awaria
-- trwale zabiera część dziennego/miesięcznego budżetu.
--
-- `ai_budget_release_stale_reservations` (service_role, wywoływana z /api/maintenance —
-- app-layer): idempotentne GC. Rezerwacja starsza niż TTL i wciąż 'reserved' jest
-- rozliczana jako `outcome='failed'`, `cost_micro_usd=0` — ślad audytowy zostaje (wiersz,
-- nie usunięty), ale PRZESTAJE liczyć się do wydanego budżetu, więc limit wraca do użycia.
-- TTL (domyślnie 60 minut) jest wyraźnie dłuższy niż próg ostrzeżenia `staleReservations`
-- w `ai_budget_status` (15 minut) — normalne, wciąż trwające wywołanie modelu nie zostanie
-- przedwcześnie zwolnione. `FOR UPDATE SKIP LOCKED` + filtr `status = 'reserved'`: dwa
-- równoległe przebiegi GC nie rozliczą tego samego wiersza dwa razy i nie kolidują
-- z `ai_budget_settle` wciąż trwającego wywołania.
--
-- Rollback: drop function ai_budget_release_stale_reservations(integer, integer).
-- Migracja nie zmienia istniejących danych ani schematu tabel.
-- =============================================================================

create or replace function public.ai_budget_release_stale_reservations(
  p_older_than_minutes integer default 60,
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Dolna granica 15 minut = próg ostrzeżenia w ai_budget_status; GC nigdy nie jest
  -- agresywniejsze niż monitoring. Górna granica 1440 minut (doba) to bezpiecznik wywołania.
  v_minutes integer := greatest(15, least(coalesce(p_older_than_minutes, 60), 1440));
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_released integer;
begin
  with stale as (
    select id
      from public.ai_usage_ledger
     where status = 'reserved'
       and created_at < now() - make_interval(mins => v_minutes)
     order by created_at
     limit v_limit
       for update skip locked
  )
  update public.ai_usage_ledger l
     set status = 'settled',
         outcome = 'failed',
         cost_micro_usd = 0,
         settled_at = now()
    from stale
   where l.id = stale.id;
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke all on function public.ai_budget_release_stale_reservations(integer, integer) from public, anon, authenticated;
grant execute on function public.ai_budget_release_stale_reservations(integer, integer) to service_role;
