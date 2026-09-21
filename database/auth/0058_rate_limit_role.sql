-- Wąska rola backendowego limitera. Migracja po bootstrapie i migracjach domeny.
-- Osobny login operatora: NOINHERIT, bez SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB,
-- członkostwo tylko pracujbe_rate_limit, bez ADMIN OPTION. Nie dodawać do puli WWW/auth.
-- Sam brak GRANT nie izoluje roli: PUBLIC dawał wszystkim rolom EXECUTE na
-- części aplikacyjnych SECURITY DEFINER. Przenosimy tylko te istniejące prawa
-- do dotychczasowych ról domeny. Funkcje rozszerzeń i pg_catalog pozostają bez
-- zmian, tak samo globalne uprawnienia domyślne. Nowe definery wymagają REVOKE.
-- Rollback: odłączyć helper, odebrać EXECUTE i członkostwo dedykowanemu loginowi.
-- Nie usuwać tabeli rate_limits ani liczników innych działających procesów.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migracja limitera wymaga wydzielonego migratora postgres.';
  end if;
  if to_regprocedure('public.rate_limit_hit(text,integer,integer)') is null then
    raise exception 'Najpierw wykonaj migracje domenowe limitera.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pracujbe_rate_limit') then
    create role pracujbe_rate_limit nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_roles where rolname = 'pracujbe_rate_limit'
    and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole))
    or exists (select 1 from pg_auth_members where member = 'pracujbe_rate_limit'::regrole)
  then
    raise exception 'Istniejąca rola limitera ma niezgodne uprawnienia.';
  end if;
end $$;

do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'auth')
      and exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', routine.signature);
    execute format('revoke execute on function %s from public', routine.signature);
  end loop;
end $$;

grant usage on schema public to pracujbe_rate_limit;
grant execute on function public.rate_limit_hit(text, integer, integer) to pracujbe_rate_limit;
