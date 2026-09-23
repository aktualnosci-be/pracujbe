-- =============================================================================
-- 0068 — deny-by-default dla zapisu klienta (#25, Invariant #5).
--
-- Bootstrap nadaje `authenticated` domyślne INSERT/UPDATE/DELETE na każdej nowej
-- tabeli public. Tam, gdzie nie ma odpowiadającej polityki RLS, zapis i tak jest
-- odrzucany — jedyną barierą jest RLS. Odbieramy więc grant DML na każde polecenie,
-- dla którego żadna polityka nie dopuszcza roli authenticated (bezpośrednio lub
-- przez PUBLIC). Zachowanie aplikacji się nie zmienia: te zapisy już dziś kończą
-- się odmową RLS, a RPC SECURITY DEFINER i service_role działają bez zmian.
--
-- Nowe tabele: domyślnie BEZ zapisu klienta. Migracja, która chce zapisu z sesji,
-- nadaje GRANT jawnie razem z polityką. Strażnik w supabase/tests/role-guard.sql
-- odrzuca grant DML bez polityki.
--
-- Rollback: `GRANT INSERT, UPDATE, DELETE ON <tabela> TO authenticated` dla tabel
-- z listy NOTICE oraz `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT,
-- UPDATE, DELETE ON TABLES TO authenticated`. Migracja nie zmienia danych.
-- =============================================================================

do $$
declare
  t record;
  v_cmd text;
  v_revoked text[] := '{}';
begin
  for t in
    select c.oid, format('%I.%I', n.nspname, c.relname) as qualified
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p')
  loop
    foreach v_cmd in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', t.oid, v_cmd)
         and not exists (
           select 1 from pg_policy p
           where p.polrelid = t.oid
             and p.polcmd in ('*', case v_cmd when 'INSERT' then 'a' when 'UPDATE' then 'w' else 'd' end)
             and (0::oid = any(p.polroles)
                  or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles))
         ) then
        execute format('revoke %s on %s from authenticated', v_cmd, t.qualified);
        v_revoked := v_revoked || (v_cmd || ' ' || t.qualified);
      end if;
    end loop;
  end loop;
  raise notice '0068: odebrano authenticated (% poleceń): %',
    cardinality(v_revoked), array_to_string(v_revoked, ', ');
end $$;

alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
