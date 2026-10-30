-- Seed a 1M-user-shaped chat dataset for the Phase 0 latency gates.
-- Run on a disposable database that already has the migrations applied, e.g.:
--   psql "$URL" -v users=1000000 -v projects=100000 -v dms=1000000 \
--        -v dm_msgs=3 -v ch_msgs=23 -v power=1000 -f scripts/chat-load/seed.sql
-- Defaults give ~1.3M channels, ~3.6M memberships and ~10M messages.
\set ON_ERROR_STOP on
SET synchronous_commit = off;
SET maintenance_work_mem = '512MB';

\echo users
WITH auth_users AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), 'load' || g || '@load.test' FROM generate_series(1, :users) g
  RETURNING id, email)
INSERT INTO profiles (id, email, username)
SELECT id, email, split_part(email, '@', 1) FROM auth_users;
CREATE TABLE load_users AS
  SELECT row_number() OVER (ORDER BY email) AS rn, id FROM profiles WHERE email LIKE '%@load.test';
CREATE UNIQUE INDEX ON load_users (rn);
ANALYZE load_users;

\echo projects
CREATE TABLE load_projects AS
  SELECT gen_random_uuid() AS id, (1 + floor(random() * :users))::bigint AS owner_rn, g
  FROM generate_series(1, :projects) g;
INSERT INTO workspaces (id, owner_id, title)
SELECT p.id, u.id, 'Load project ' || p.g FROM load_projects p JOIN load_users u ON u.rn = p.owner_rn;
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT p.id, u.id, 'owner' FROM load_projects p JOIN load_users u ON u.rn = p.owner_rn;
WITH picks AS MATERIALIZED (
  SELECT p.id AS workspace_id, (1 + floor(random() * :users))::bigint AS rn
  FROM load_projects p CROSS JOIN generate_series(1, 4)
)
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT DISTINCT picks.workspace_id, u.id, 'member'
FROM picks JOIN load_users u ON u.rn = picks.rn
WHERE NOT EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = picks.workspace_id AND pm.user_id = u.id);

\echo project channels
INSERT INTO chat_channels (kind, name, workspace_id, is_default, created_by)
SELECT 'public', 'general', p.id, true, u.id FROM load_projects p JOIN load_users u ON u.rn = p.owner_rn;
INSERT INTO chat_channels (kind, name, workspace_id, created_by)
SELECT 'public', 'topic-' || k, p.id, u.id
FROM load_projects p JOIN load_users u ON u.rn = p.owner_rn CROSS JOIN generate_series(1, 2) k;
INSERT INTO chat_channel_members (channel_id, user_id, role)
SELECT c.id, pm.user_id, CASE WHEN pm.role = 'owner' THEN 'owner' ELSE 'member' END
FROM chat_channels c JOIN workspace_members pm ON pm.workspace_id = c.workspace_id
WHERE c.workspace_id IN (SELECT id FROM load_projects);

\echo direct messages
CREATE TABLE load_dm AS
  SELECT (1 + floor(random() * :users))::bigint AS a, (1 + floor(random() * :users))::bigint AS b
  FROM generate_series(1, :dms);
-- Heavy users: 100 DMs each, the worst case for the entry call.
INSERT INTO load_dm (a, b)
SELECT p, (1 + floor(random() * :users))::bigint FROM generate_series(1, :power) p CROSS JOIN generate_series(1, 100);
INSERT INTO chat_channels (kind, dm_key, created_by)
SELECT 'dm', least(ua.id::text, ub.id::text) || ':' || greatest(ua.id::text, ub.id::text), ua.id
FROM load_dm d JOIN load_users ua ON ua.rn = d.a JOIN load_users ub ON ub.rn = d.b
WHERE d.a <> d.b
ON CONFLICT DO NOTHING;
INSERT INTO chat_channel_members (channel_id, user_id)
SELECT c.id, split_part(c.dm_key, ':', k)::uuid
FROM chat_channels c CROSS JOIN generate_series(1, 2) k
WHERE c.kind = 'dm'
ON CONFLICT DO NOTHING;

\echo heavy users join 30 extra project channels each
INSERT INTO chat_channel_members (channel_id, user_id)
SELECT DISTINCT c.id, u.id
FROM load_users u
CROSS JOIN LATERAL (
  SELECT id FROM chat_channels
  WHERE kind = 'public' AND NOT is_default
  OFFSET floor(random() * 150000)::int LIMIT 30
) c
WHERE u.rn <= :power
ON CONFLICT DO NOTHING;

UPDATE chat_channels c SET member_count = x.n
FROM (SELECT channel_id, count(*) AS n FROM chat_channel_members GROUP BY channel_id) x
WHERE c.id = x.channel_id;

\echo messages
INSERT INTO chat_messages (channel_id, channel_seq, author_id, body, created_at)
SELECT c.id, s, c.created_by, 'seed message number ' || s,
       now() - ((CASE WHEN c.kind = 'dm' THEN :dm_msgs ELSE :ch_msgs END) - s) * interval '1 minute'
FROM chat_channels c
CROSS JOIN LATERAL generate_series(1, CASE WHEN c.kind = 'dm' THEN :dm_msgs ELSE :ch_msgs END) s;

UPDATE chat_channels SET
  last_seq = CASE WHEN kind = 'dm' THEN :dm_msgs ELSE :ch_msgs END,
  last_top_seq = CASE WHEN kind = 'dm' THEN :dm_msgs ELSE :ch_msgs END,
  last_message_at = now() - interval '1 minute' * (random() * 10000),
  last_preview = 'seed message number ' || CASE WHEN kind = 'dm' THEN :dm_msgs ELSE :ch_msgs END,
  last_author_id = created_by;

\echo benchmark samples
CREATE TABLE load_send_targets AS
  SELECT row_number() OVER () AS rn, channel_id, user_id
  FROM (SELECT channel_id, user_id FROM chat_channel_members TABLESAMPLE SYSTEM (5) LIMIT 100000) x;
CREATE UNIQUE INDEX ON load_send_targets (rn);
CREATE TABLE load_power_users AS SELECT rn, id FROM load_users WHERE rn <= :power;
CREATE UNIQUE INDEX ON load_power_users (rn);
CREATE TABLE load_timeline AS
  SELECT row_number() OVER () AS rn, id AS channel_id, last_seq
  FROM (SELECT id, last_seq FROM chat_channels TABLESAMPLE SYSTEM (5) WHERE kind = 'public' LIMIT 10000) x;
CREATE UNIQUE INDEX ON load_timeline (rn);

VACUUM ANALYZE;
SELECT
  (SELECT count(*) FROM profiles) AS users,
  (SELECT count(*) FROM chat_channels) AS channels,
  (SELECT count(*) FROM chat_channel_members) AS memberships,
  (SELECT count(*) FROM chat_messages) AS messages,
  pg_size_pretty(pg_database_size(current_database())) AS size;
