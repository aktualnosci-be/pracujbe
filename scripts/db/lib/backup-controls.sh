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
