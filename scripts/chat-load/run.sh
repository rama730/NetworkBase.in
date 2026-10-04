#!/usr/bin/env bash
# Phase 0 latency gates (report 8.2 / plan Phase 0). Runs each script at its
# target rate and prints p50/p95/p99 in ms, minus the SELECT 1 round trip.
#   scripts/chat-load/run.sh postgresql://postgres@localhost:54329/nb_chat_load [seconds]
set -euo pipefail
URL="$1"; SECS="${2:-60}"; DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/chat-load-$$"; mkdir -p "$OUT"

measure() { # name script rate clients
  local name="$1" script="$2" rate="$3" clients="$4"
  ( cd "$OUT" && pgbench -n -f "$DIR/$script" -R "$rate" -T "$SECS" -c "$clients" -j 4 -l --log-prefix="$name" "$URL" >/dev/null 2>&1 )
  cat "$OUT/$name".* | awk '{print $3}' | sort -n | awk -v name="$name" -v rate="$rate" '
    {v[NR]=$1} END {
      if (NR == 0) { print name ": no samples"; exit }
      printf "%-16s rate=%5s/s n=%7d p50=%6.2fms p95=%6.2fms p99=%6.2fms\n", name, rate, NR,
        v[int(NR*0.50)]/1000, v[int(NR*0.95)]/1000, v[int(NR*0.99)]/1000 }'
}

measure baseline  baseline.sql        1000 16
measure send      send.sql             700 24
measure poll      bootstrap.sql       1100 24
measure entry     bootstrap-full.sql   100  8
measure timeline  timeline.sql         700 16
echo "logs: $OUT"
