# shellcheck shell=bash
# Wspólne zapytania kontrolne backup.sh ↔ restore-backup.sh (#47). Ten sam SQL na
# źródle (snapshot zrzutu) i na odtworzonej bazie; porównujemy SHA-256 wyniku.

# Tabele objęte kontrolą liczności — kolejność stała (sortowanie po nazwie).
BACKUP_TABLES_SQL="select format('%I.%I', n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','auth','app_migrations')
  order by 1;"

# Argument: lista tabel (jedna na wiersz, już w formie %I.%I z BACKUP_TABLES_SQL).
# Wynik: historia migracji (nazwa:SHA-256), tabele z RLS, liczba polityk, liczba
# wierszy każdej tabeli — każda linia deterministyczna.
backup_controls_sql() {
  cat <<'SQL'
select 'migration ' || name || ':' || checksum from app_migrations.history order by name;
select 'rls ' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity and n.nspname in ('public','auth') order by 1;
select 'policies ' || count(*) from pg_policy;
SQL
  printf '%s\n' "$1" | awk '{q=$0; gsub(/\x27/, "\x27\x27", q); printf "select \x27rows %s \x27 || count(*) from %s;\n", q, $0}'
}

# OPS14-01: odcisk uprawnień. Kopia jest robiona i odtwarzana z ACL (bez --no-acl), więc
# odtworzona baza musi mieć te same GRANT/REVOKE co źródło — także odebrane EXECUTE dla PUBLIC
# (acldefault = uprawnienia domyślne, gdy ACL jest NULL). Pomijamy wpisy właściciela
# i grantora (przy --no-owner właścicielem jest login odtwarzający). Dochodzą atrybuty
# i członkostwa ról, którym nadano uprawnienia (role są globalne dla klastra, nie ma ich
# w kopii — restore-backup.sh tworzy brakujące; lib/restore-roles.sh). pracujbe_app zawsze:
# to przez nią login WWW dostaje anon/authenticated (database/bootstrap).
BACKUP_ACL_SQL="with objs(kind, ident, owner, acl) as (
  select 'schema', quote_ident(n.nspname), n.nspowner, coalesce(n.nspacl, acldefault('n', n.nspowner))
    from pg_namespace n where n.nspname in ('public','auth','app_migrations')
  union all
  select case c.relkind when 'S' then 'sequence' else 'relation' end, format('%I.%I', n.nspname, c.relname),
         c.relowner, coalesce(c.relacl, acldefault(case c.relkind when 'S' then 's' else 'r' end::\"char\", c.relowner))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','auth','app_migrations') and c.relkind in ('r','p','v','m','f','S')
  union all
  select 'column', format('%I.%I.%I', n.nspname, c.relname, a.attname), c.relowner, a.attacl
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','auth','app_migrations') and a.attnum > 0 and not a.attisdropped
      and a.attacl is not null
  union all
  select 'function', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
         p.proowner, coalesce(p.proacl, acldefault('f', p.proowner))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','auth','app_migrations')
  union all
  select 'type', format('%I.%I', n.nspname, t.typname), t.typowner, coalesce(t.typacl, acldefault('T', t.typowner))
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public','auth','app_migrations') and t.typrelid = 0 and t.typcategory <> 'A'
  union all
  select 'default', pg_get_userbyid(d.defaclrole) || ' ' || coalesce(quote_ident(n.nspname), '-') || ' '
         || d.defaclobjtype::text, d.defaclrole, d.defaclacl
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
), items as (
  select o.kind, o.ident, a.grantee, a.privilege_type, a.is_grantable
    from objs o cross join lateral aclexplode(o.acl) a where a.grantee <> o.owner
), grantees as (
  select grantee as oid from items where grantee <> 0
  union select oid from pg_roles where rolname = 'pracujbe_app'
)
select line from (
  select 'acl ' || i.kind || ' ' || i.ident || ' '
         || case when i.grantee = 0 then 'PUBLIC' else pg_get_userbyid(i.grantee) end
         || ' ' || i.privilege_type || case when i.is_grantable then '*' else '' end as line
    from items i
  union all
  select format('role %s super=%s inherit=%s login=%s bypassrls=%s createrole=%s createdb=%s replication=%s',
         r.rolname, r.rolsuper, r.rolinherit, r.rolcanlogin, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
         r.rolreplication)
    from pg_roles r join grantees g on g.oid = r.oid
  union all
  select format('member %s in %s admin=%s', m_role.rolname, p_role.rolname, m.admin_option)
    from pg_auth_members m
    join grantees gm on gm.oid = m.member join grantees gp on gp.oid = m.roleid
    join pg_roles m_role on m_role.oid = m.member join pg_roles p_role on p_role.oid = m.roleid
) lines order by line collate \"C\";"
