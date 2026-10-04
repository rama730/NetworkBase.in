-- Background poll (the 1.1k/s case): only channels changed in the last 90 s.
\set r random(1, 1000)
SELECT app_private.chat_bootstrap(u.id, now() - interval '90 seconds') FROM load_power_users u WHERE u.rn = :r;
