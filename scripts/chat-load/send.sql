-- One send through the real path: permission checks, seq allocation, insert.
\set r random(1, 100000)
SELECT app_private.chat_send_message(t.channel_id, t.user_id, 'load test message') FROM load_send_targets t WHERE t.rn = :r;
