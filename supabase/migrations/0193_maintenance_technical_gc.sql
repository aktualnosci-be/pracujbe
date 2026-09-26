-- =============================================================================
-- 0193 (NUMER TYMCZASOWY — ostateczny nada integrator) — sprzątanie tabel technicznych
-- w /api/maintenance (K2 z docs/LAUNCH_CHECKLIST.md, #17).
--
-- Problem: rate_limit_gc (0015) i processed_webhooks_gc (0036) istnieją, ale nikt ich nie
-- woła, a po `revoke all ... from public` nie ma ich EXECUTE także service_role — zadanie
-- maintenance dostałoby `permission denied`. Tabele rosną bez końca:
--   * rate_limits — jeden wiersz na klucz limitera (skrót adresu/konta + akcja);
--   * processed_webhooks — inbox deduplikacji webhooków (EmailLabs/Resend).
--
-- Zmiana:
--   1. rate_limit_gc: dolna granica wieku = 86 400 s (najdłuższe okno limitera w kodzie
--      to doba — `*-day` w akcjach AI). Wiersz nieaktualizowany dłużej niż doba ma okno
--      już zamknięte, więc usunięcie nie zeruje żadnego trwającego limitu. Mniejszy argument
--      jest podnoszony do tej granicy (wywołujący nie skasuje aktywnych okien).
--   2. processed_webhooks_gc: usuwa wyłącznie wpisy rozstrzygnięte (`completed`/`failed`,
--      0038) starsze niż N dni (min. 7). Wpis `processing` zostaje — to dzierżawa (0053)
--      i jej obsługa należy do inboxu, nie do GC.
--   3. EXECUTE tylko dla service_role (pula `DATABASE_SERVICE_URL`, /api/maintenance).
--
-- Poza zakresem: email_deliveries_gc (0022) — okres przechowywania e-maili to decyzja
-- administratora danych (#574, retencja), nie sprzątanie techniczne.
-- Dowód: supabase/tests/rls.sql sekcja GC193 (z kontrolą ujemną).
-- =============================================================================

create or replace function public.rate_limit_gc(p_older_than_seconds integer default 86400)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.rate_limits
    where updated_at < now() - make_interval(secs => greatest(coalesce(p_older_than_seconds, 86400), 86400));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.rate_limit_gc(integer) from public, anon, authenticated;
grant execute on function public.rate_limit_gc(integer) to service_role;

create or replace function public.processed_webhooks_gc(p_older_than_days integer default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.processed_webhooks
    where status in ('completed', 'failed')
      and seen_at < now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 7));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.processed_webhooks_gc(integer) from public, anon, authenticated;
grant execute on function public.processed_webhooks_gc(integer) to service_role;
