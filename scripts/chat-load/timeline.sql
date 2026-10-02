-- One timeline page: 50 top-level messages before the newest.
\set r random(1, 10000)
SELECT m.channel_seq, m.author_id, m.body, m.created_at
FROM load_timeline t
JOIN LATERAL (
  SELECT channel_seq, author_id, body, created_at FROM chat_messages
  WHERE channel_id = t.channel_id AND thread_root_seq IS NULL AND channel_seq <= t.last_seq
  ORDER BY channel_seq DESC LIMIT 50
) m ON true
WHERE t.rn = :r;
