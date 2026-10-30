#!/usr/bin/env bash
# Builds a disposable local Postgres 17 with the production schema: Supabase
# shim -> every migration, from empty.
# Free, no Supabase branch. Prints the URL to export as DATABASE_URL_FRESH.
#   scripts/db/disposable-db.sh [data-dir]
#   DATABASE_URL_FRESH=$(scripts/db/disposable-db.sh) npm run test:db
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"  # macOS postmaster refuses an unset locale

PORT="${NB_TEST_PG_PORT:-54332}"
DB="${NB_TEST_PG_DB:-nb_test}"
DATA="${1:-${TMPDIR:-/tmp}/nb-test-pg17}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for dir in "${PG_BIN:-}" /opt/homebrew/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
  if [ -n "$dir" ] && [ -x "$dir/initdb" ]; then BIN="$dir"; break; fi
done
BIN="${BIN:?Postgres 17 binaries not found; set PG_BIN}"
URL="postgresql://postgres@localhost:${PORT}/${DB}"

if [ ! -d "$DATA" ]; then
  "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
  printf "port = %s\nunix_socket_directories = '/tmp'\nmax_connections = 300\nwal_level = logical\n" "$PORT" >> "$DATA/postgresql.conf"
fi
"$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w status >/dev/null 2>&1 || "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w start >/dev/null

"$BIN/psql" -h localhost -p "$PORT" -U postgres -qc "DROP DATABASE IF EXISTS ${DB} WITH (FORCE)" -c "CREATE DATABASE ${DB}"
"$BIN/psql" "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/db/supabase-shim.sql" >/dev/null
(cd "$ROOT" && DATABASE_URL="$URL" npx tsx scripts/setup-database.ts >&2)
echo "$URL"
