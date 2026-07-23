-- =============================================================================
-- 0015_rate_limiting.sql
-- Aplikacyjny rate limiting (F-05/P2-02) — brak jakiegokolwiek limitera był luką.
-- Stały okno (fixed window) w tabeli rate_limits + RPC rate_limit_hit(). Trwałe między
-- instancjami serverless (inaczej niż licznik w pamięci). Wołane z Server Actions
-- (auth/aplikowanie) z kluczem typu 'signin:<ip>' / 'apply:<uid>'.
-- Tabela niedostępna dla anon/authenticated wprost (RLS deny) — zapis tylko przez RPC.
-- =============================================================================

create table if not exists public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
-- Brak polityk => deny dla anon/authenticated. Dostęp wyłącznie przez RPC (security definer)
-- oraz service_role (BYPASSRLS).
revoke all on table public.rate_limits from anon, authenticated;

-- RPC: rejestruje próbę i zwraca TRUE, gdy mieści się w limicie (p_max na p_window_seconds),
-- FALSE gdy przekroczono. Reset okna po upływie p_window_seconds.
create or replace function public.rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer; v_start timestamptz; v_now timestamptz := now();
begin
  insert into public.rate_limits (key, window_start, count, updated_at)
    values (p_key, v_now, 1, v_now)
  on conflict (key) do update
    set count = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                    then 1                                   -- nowe okno
                  else public.rate_limits.count + 1
                end,
        window_start = case
                  when public.rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                    then v_now
                  else public.rate_limits.window_start
                end,
        updated_at = v_now
  returning count into v_count;

  return v_count <= p_max;
end $$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public;
grant execute on function public.rate_limit_hit(text, integer, integer) to anon, authenticated;

-- Sprzątanie starych wpisów (wywoływane opcjonalnie przez cron/worker).
create or replace function public.rate_limit_gc(p_older_than_seconds integer default 86400)
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.rate_limits
    where updated_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.rate_limit_gc(integer) from public;
