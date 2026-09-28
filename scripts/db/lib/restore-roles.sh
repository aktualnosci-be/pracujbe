# shellcheck shell=bash
# Role potrzebne do odtworzenia kopii z uprawnieniami (OPS14-01) — restore-backup.sh
# i verify-restore.sh. Role są globalne dla klastra, więc nie ma ich w kopii: zbieramy
# nazwy z polityk RLS i z GRANT/REVOKE/ALTER DEFAULT PRIVILEGES archiwum, a brakujące
# tworzymy wg kontraktu database/bootstrap (NOLOGIN, bez atrybutów; BYPASSRLS tylko
# service_role; pracujbe_app członkiem anon i authenticated). Loginy i hasła
# provisionuje operator (scripts/db/runtime-logins.mjs). Odtwarzamy z --no-owner:
# obiekty należą do loginu odtwarzającego, żadna rola z kopii nie zostaje właścicielem.
# Wymaga funkcji fail() i dst() skryptu wołającego.

# Argument: archiwum -Fc. Wynik: nazwy ról, jedna w wierszu (bez PUBLIC).
restore_dump_roles() {
  local sql
  sql="$(pg_restore --schema-only --file=- "$1" 2>/dev/null)" || fail 'Odczyt ról z archiwum.'
  printf '%s\n' "$sql" | sed -nE \
    -e 's/^CREATE POLICY .* TO ([a-z_][a-z0-9_]*( *, *[a-z_][a-z0-9_]*)*)( USING| WITH CHECK|;).*/\1/p' \
    -e 's/^GRANT .* TO (.*);$/\1/p' \
    -e 's/^REVOKE .* FROM (.*);$/\1/p' \
    -e 's/^ALTER DEFAULT PRIVILEGES FOR ROLE ([^ ]+) .*/\1/p' \
    | sed -E 's/ WITH GRANT OPTION$//; s/ GRANTED BY .*$//' \
    | tr ',' '\n' | tr -d ' ' | grep -Eiv '^(public)?$' \
    | awk '{print} /^(anon|authenticated)$/ {app=1} END {if (app) print "pracujbe_app"}' \
    | LC_ALL=C sort -u || true
}

# Argument: lista ról z restore_dump_roles. Tworzy brakujące role na celu.
restore_prepare_roles() {
  local role attrs created=''
  for role in $1; do
    [[ "$role" =~ ^[a-z_][a-z0-9_]*$ ]] || fail 'Nieoczekiwana nazwa roli w kopii.'
    [ -z "$(dst -c "select 1 from pg_roles where rolname = '$role'")" ] || continue
    [[ "$role" != pg_* ]] || fail 'Kopia odwołuje się do roli systemowej, której nie ma na celu.'
    attrs='nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls'
    [ "$role" != service_role ] || attrs="${attrs% nobypassrls} bypassrls"
    dst -c "create role \"$role\" $attrs" >/dev/null || fail 'Nie można utworzyć roli na celu.' 2
    created+=" $role "
  done
  if [[ "$created" == *' pracujbe_app '* ]] \
     && [ "$(dst -c "select count(*) from pg_roles where rolname in ('anon','authenticated')")" = 2 ]; then
    dst -c 'grant anon, authenticated to pracujbe_app' >/dev/null || fail 'Nie można nadać członkostw ról.' 2
  fi
  if [ -n "$created" ]; then
    echo "RESTORE: utworzono role wg kontraktu bootstrapu (NOLOGIN): $(printf '%s' "$created" | xargs)"
  fi
}
