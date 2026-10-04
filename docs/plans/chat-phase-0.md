# Chat rebuild, Phase 0: proof at 1M-user scale

Date: 2026-10-02 · Plan: `~/.claude/plans/docs-plans-messaging-slack-rebuild-repo-lovely-acorn.md` · Report: `docs/plans/messaging-slack-rebuild-report.md`

## Why local, not a Supabase branch

The project is on the Supabase free plan, so no branch database or Realtime load test was run against Supabase. The database side was proven on a local Postgres instead. The code targets 1M users now; the Supabase plan (Pro, Team, or Enterprise) is upgraded later, and the Realtime limits in report section 8.3 are configuration, not code.

## Setup

- Postgres 14.20 (Homebrew), Apple M2, 8 cores, 8 GB RAM, `fsync = off` (CPU-bound measurement; production disk adds commit latency).
- Database built by `scripts/chat-db/local-db.sh`: Supabase shim (`scripts/chat-db/supabase-shim.sql`) → app schema via `drizzle-kit push` → `drizzle/0180_chat_rebuild_additive.sql`.
- Data: `scripts/chat-load/seed.sql` with `users=1000000 projects=100000 dms=1000000 dm_msgs=3 ch_msgs=23 power=1000`.

| Rows | Count |
|---|---|
| profiles | 1,000,000 |
| chat_channels | 1,399,995 (300k project channels, 1.1M DMs) |
| chat_channel_members | 3,729,981 |
| chat_messages | 10,199,985 (32 hash partitions) |
| database size | 5.4 GB |

1,000 "heavy" users each have 100+ DMs and 30+ extra channels; the entry and poll benchmarks use only them (worst case).

## Correctness: `npm run check:chat:db`

65 checks pass. They cover:
- DM uniqueness and the self-DM;
- privacy and blocks;
- gap-free `channel_seq` under 20 concurrent sends, and idempotency;
- caps (500 members, 200 channels per project, `@channel` at most 100);
- threads, the read cursor, edit, delete, react, pin and report permissions;
- group chats, application channels, live-card triggers, project membership sync and bootstrap;
- RLS, including direct partition access;
- the Realtime topic policies.

## Latency gates (`scripts/chat-load/run.sh`, 60 s per script at the target rate)

| Script | Rate | p50 | p95 | p99 | Gate (report 8.2 / plan) |
|---|---|---|---|---|---|
| `SELECT 1` baseline | 1,000/s | 0.69 ms | 2.55 ms | 3.90 ms | none: round-trip overhead |
| send (`chat_send_message`) | 700/s | 1.73 ms | 4.31 ms | 5.91 ms | p95 ≤ 10 ms ✓ |
| background poll (`chat_bootstrap`, since 90 s) | 1,100/s | 1.50 ms | 3.52 ms | 6.12 ms | p95 ≤ 15 ms ✓ |
| timeline page (50 messages) | 700/s | 1.96 ms | 4.56 ms | 6.20 ms | p95 ≤ 20 ms ✓ |
| app entry (full bootstrap, heavy user) | 100/s | 9.97 ms | 21.19 ms | 36.70 ms | no gate: once per page load |

The poll row is from a 45-second rerun on its own. In the combined run its p99 showed a single 300 ms pgbench scheduling spike, with p95 at 3.9 ms.

`EXPLAIN ANALYZE` for the full bootstrap of a heavy user: 30 ms execution, 68 shared buffer hits, no disk reads.

## Realtime (not soaked on the free plan)

The free plan allows 200 connections and 100 messages/s, so a 5,000-client soak is impossible there. What is verified instead:
- Topic authorization in SQL (`check:chat:db`).
- The REST publish format against the Supabase docs (`tests/unit/chat-server-broadcast.test.ts`).
- The per-connection channel budget and reconnect jitter as client code in Phase 3.

Ledger **L-33**: run a real-connection soak (5,000 clients) on the paid plan before real traffic reaches 1,000 concurrent users.

## Upgrade checklist (report 8.3, when traffic grows)

| Limit | Free | Pro / Team | Our 1M peak |
|---|---|---|---|
| Concurrent connections | 200 | 500 (no cap: 10,000) | ≈130,000 → custom limit |
| Messages per second | 100 | 500 (no cap: 2,500) | ≈2,400 → raise to ≥10,000 |
| Channels per connection | 100 | 100 | ≈8 |

## Reproduce

```bash
CHAT_PG_DB=nb_chat_test scripts/chat-db/local-db.sh /path/to/pgdata
DATABASE_URL_FRESH=postgresql://postgres@localhost:54329/nb_chat_test npm run check:chat:db
CHAT_PG_DB=nb_chat_load scripts/chat-db/local-db.sh /path/to/pgdata
psql postgresql://postgres@localhost:54329/nb_chat_load -v users=1000000 -v projects=100000 -v dms=1000000 -v dm_msgs=3 -v ch_msgs=23 -v power=1000 -f scripts/chat-load/seed.sql
scripts/chat-load/run.sh postgresql://postgres@localhost:54329/nb_chat_load 60
```
