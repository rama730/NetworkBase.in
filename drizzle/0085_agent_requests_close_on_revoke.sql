-- Report A5 "Asking for more" (found in the M1 live check, 11 Nov 2026): revoking an agent's sign-in left its
-- waiting requests open and their inbox items pointing at a page that no longer exists. Every way of revoking
-- (Settings, nb token revoke, nb logout, sign out everywhere) sets revoked_at, so one trigger closes them all.
CREATE FUNCTION app_private.nb_close_agent_requests_on_revoke() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    WITH closed AS (
      UPDATE public.agent_access_requests SET status = 'expired'
      WHERE session_id = NEW.id AND status IN ('open', 'once')
      RETURNING id
    )
    DELETE FROM public.user_notifications n USING closed
    WHERE n.user_id = NEW.user_id AND n.dedupe_key = 'agent-access-request:' || closed.id::text;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER extension_device_sessions_close_agent_requests AFTER UPDATE OF revoked_at ON public.extension_device_sessions
    FOR EACH ROW EXECUTE FUNCTION app_private.nb_close_agent_requests_on_revoke();
--> statement-breakpoint
-- Requests of sign-ins revoked before this migration (the live check's own).
WITH closed AS (
  UPDATE public.agent_access_requests r SET status = 'expired'
  FROM public.extension_device_sessions s
  WHERE s.id = r.session_id AND s.revoked_at IS NOT NULL AND r.status IN ('open', 'once')
  RETURNING r.id, r.user_id
)
DELETE FROM public.user_notifications n USING closed
WHERE n.user_id = closed.user_id AND n.dedupe_key = 'agent-access-request:' || closed.id::text;
