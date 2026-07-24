-- =============================================================================
-- 0025_trust_boundary.sql
-- Remediacja audytu 2026-07-24 — Wave A: SPÓJNA GRANICA ZAUFANIA (RPC-only DML).
--
-- Problem (SEC-05/06/07): tabele procesowe miały bezpieczne RPC (apply_to_job,
-- send_offer/respond_to_offer, send_message/get_or_create_conversation), ale domyślne
-- granty Supabase pozwalały `authenticated` na BEZPOŚREDNI INSERT/UPDATE/DELETE przez
-- PostgREST — z pominięciem walidacji, rate-limitu, powiadomień i kolejki e-mail (część
-- integralności łapały triggery, ale skutki uboczne i limity NIE). Zamykamy bezpośredni
-- DML: klient może już tylko CZYTAĆ (pod RLS) i MUTOWAĆ przez SECURITY DEFINER RPC.
-- Triggery integralności nadal działają (odpalają się także dla zapisu z RPC), więc
-- pozostają jako defense-in-depth.
--
-- SEC-01: `rate_limit_hit` był EXECUTE dla anon/authenticated — klient mógł wołać go wprost
-- z dowolnym kluczem/limitem/oknem (zatruwanie limitera, wzrost tabeli). Odbieramy grant;
-- limiter woła wyłącznie zaufany backend (service_role, admin client) z kluczem budowanym
-- po stronie serwera.
-- =============================================================================

-- --- SEC-05/06/07: RPC-only DML na tabelach procesowych -----------------------
-- Zostaje SELECT (RLS decyduje o widoczności wierszy). Zabieramy INSERT/UPDATE/DELETE.
-- SECURITY DEFINER RPC (własność właściciela migracji) piszą niezależnie od tych grantów.
revoke insert, update, delete on public.applications          from anon, authenticated;
revoke insert, update, delete on public.offers               from anon, authenticated;
revoke insert, update, delete on public.conversations        from anon, authenticated;
revoke insert, update, delete on public.conversation_members from anon, authenticated;
revoke insert, update, delete on public.messages             from anon, authenticated;

-- --- Kandydat wycofuje aplikację przez RPC (był bezpośredni UPDATE) ------------
-- Idempotentny, autoryzowany po auth.uid() = candidate_id. Zwraca finalny status.
-- Trigger enforce_application_integrity dodatkowo pilnuje przejścia (defense-in-depth).
create or replace function public.withdraw_application(p_application_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null then
    raise exception 'PERMISSION_DENIED: brak sesji' using errcode = '42501';
  end if;

  select status::text into v_status
  from public.applications
  where id = p_application_id and candidate_id = auth.uid() and deleted_at is null
  for update;

  if v_status is null then
    raise exception 'NOT_FOUND: aplikacja nie istnieje lub brak dostępu' using errcode = 'P0002';
  end if;

  -- Idempotencja: już wycofana → zwróć bez zmiany (brak duplikatów historii).
  if v_status = 'withdrawn' then
    return v_status;
  end if;

  update public.applications
    set status = 'withdrawn'
    where id = p_application_id and candidate_id = auth.uid();

  return 'withdrawn';
end $$;
revoke all on function public.withdraw_application(uuid) from public;
grant execute on function public.withdraw_application(uuid) to authenticated;

-- --- SEC-01: lockdown publicznego limitera --------------------------------------
-- Klient nie może już wołać ogólnego limitera z dowolnym kluczem/limitem/oknem.
revoke execute on function public.rate_limit_hit(text, integer, integer) from anon, authenticated;
-- Limiter woła zaufany backend (admin client = service_role). Grant jawnie dla service_role.
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
