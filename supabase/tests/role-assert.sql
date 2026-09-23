-- =============================================================================
-- supabase/tests/role-assert.sql — dowód, że asercja działa na roli klienta pod RLS.
--
-- Dołączane przez \ir w role-guard.sql i rls.sql. Zielony test RLS nic nie znaczy,
-- jeśli zapytanie wykonał superuser, właściciel tabeli albo rola z BYPASSRLS —
-- wtedy polityki są pomijane i asercje „allow" przechodzą niezależnie od RLS.
--
-- pg_temp.assert_client_role() rzuca wyjątek, jeśli bieżąca rola:
--   * nie jest jedną z ról klienta (anon / authenticated),
--   * ma SUPERUSER lub BYPASSRLS albo może się na taką rolę przełączyć (MEMBER),
--   * posiada (bezpośrednio lub przez członkostwo) którąkolwiek tabelę/widok
--     w schematach public/auth — właściciel omija RLS bez FORCE ROW LEVEL SECURITY,
--   * działa z row_security != on.
-- SECURITY INVOKER: katalog czytamy z uprawnieniami bieżącej roli, jak aplikacja.
-- =============================================================================

create function pg_temp.assert_client_role() returns void
language plpgsql as $$
declare
  v_owned text;
begin
  if current_user not in ('anon', 'authenticated') then
    raise exception 'ROLE GUARD: zapytanie działa jako %, a nie rola klienta', current_user;
  end if;

  if exists (
    select 1 from pg_roles r
    where (r.rolsuper or r.rolbypassrls)
      and pg_has_role(current_user, r.oid, 'MEMBER')
  ) then
    raise exception 'ROLE GUARD: % ma lub może przejąć SUPERUSER/BYPASSRLS', current_user;
  end if;

  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname)
    into v_owned
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'auth')
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and pg_has_role(current_user, c.relowner, 'MEMBER');
  if v_owned is not null then
    raise exception 'ROLE GUARD: % jest właścicielem (omija RLS): %', current_user, v_owned;
  end if;

  if current_setting('row_security') <> 'on' then
    raise exception 'ROLE GUARD: row_security=% zamiast on', current_setting('row_security');
  end if;
end $$;
