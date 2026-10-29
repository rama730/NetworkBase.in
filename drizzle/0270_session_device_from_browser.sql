-- Sign-in runs on the server, so Supabase records the server runtime ("node", "undici", ...) as the session's
-- device and sometimes the server's address. Such a value counts as unknown: the browser's device name and
-- address replace it. A real browser already recorded is kept, and only a missing address is filled.
CREATE OR REPLACE FUNCTION app_private.nb_session_set_device(p_session_id uuid, p_user_agent text, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE auth.sessions s
  SET user_agent = CASE WHEN replaceable THEN p_user_agent ELSE s.user_agent END,
      ip = CASE WHEN replaceable THEN COALESCE(p_ip, s.ip) ELSE COALESCE(s.ip, p_ip) END
  FROM (
    SELECT p_user_agent IS NOT NULL AND (
      x.user_agent IS NULL OR btrim(x.user_agent) IN ('', 'Unknown device')
      OR x.user_agent ~* '^(node|undici|node-fetch|axios|got|deno|bun|next\.js)\M'
    ) AS replaceable
    FROM auth.sessions x WHERE x.id = p_session_id
  ) r
  WHERE s.id = p_session_id;
END;
$$;
