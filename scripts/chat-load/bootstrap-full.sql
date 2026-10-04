-- App entry: full bootstrap for a heavy user (100+ DMs, 30+ channels).
\set r random(1, 1000)
SELECT app_private.chat_bootstrap(u.id, NULL) FROM load_power_users u WHERE u.rn = :r;
