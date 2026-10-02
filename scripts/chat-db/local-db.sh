#!/usr/bin/env bash
# Build a disposable local Postgres for the chat database checks and load runs.
# Free-plan friendly: no Supabase branch needed.
#   CHAT_PG_PORT=54329 scripts/chat-db/local-db.sh [data-dir]
# Then: DATABASE_URL_FRESH=postgresql://postgres@localhost:54329/nb_chat_test npm run check:chat:db
set -euo pipefail

PORT="${CHAT_PG_PORT:-54329}"
DATA="${1:-${TMPDIR:-/tmp}/nb-chat-pg}"
DB="${CHAT_PG_DB:-nb_chat_test}"
URL="postgresql://postgres@localhost:${PORT}/${DB}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ ! -d "$DATA" ]; then
  initdb -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
  cat >> "$DATA/postgresql.conf" <<CONF
port = ${PORT}
max_connections = 300
shared_buffers = 512MB
wal_level = logical
CONF
fi
pg_ctl -D "$DATA" -l "$DATA/server.log" -w status >/dev/null 2>&1 || pg_ctl -D "$DATA" -l "$DATA/server.log" -w start >/dev/null

psql -h localhost -p "$PORT" -U postgres -qc "DROP DATABASE IF EXISTS ${DB}" -c "CREATE DATABASE ${DB}"
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/chat-db/supabase-shim.sql" 2>/dev/null
(cd "$ROOT" && DATABASE_URL="$URL" npx drizzle-kit push --force >/dev/null 2>&1)
# The Drizzle typings declare chat_* as plain tables; 0180 owns their real
# (partitioned) shape, so drop the pushed copies before applying it.
psql "$URL" -q -c "DROP TABLE IF EXISTS chat_reports, chat_pins, chat_thread_follows, chat_mentions, chat_reactions, chat_attachments, chat_message_cards, chat_messages, chat_channel_members, chat_channels CASCADE"
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/scripts/chat-db/local-app-stubs.sql"
for migration in "$ROOT"/drizzle/018[0-9]_chat_*.sql; do
  [ -e "$migration" ] || continue
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done
echo "$URL"
