-- Report §32.4: an organization's Members → Requests updates by itself. A join request that arrives, changes or ends
-- tells the organization's owner and admins on their own user topic, never the organization's topic, which anyone
-- who can see the organization hears. The event carries only the organization's id; the screen reloads its own data.
CREATE FUNCTION app_private.live_join_request_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_org uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_role uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  v_person uuid;
BEGIN
  IF v_role IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_org AND w.kind = 'organization') THEN
    RETURN NULL;
  END IF;
  FOR v_person IN
    SELECT w.owner_id FROM public.workspaces w WHERE w.id = v_org
    UNION SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = v_org AND m.role = 'admin'
  LOOP
    PERFORM app_private.live_send('chat:user:' || v_person::text, 'org.requests.changed', jsonb_build_object('workspace_id', v_org));
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_join_request_event() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER live_join_request_event AFTER INSERT OR UPDATE OF status, message OR DELETE ON public.role_applications
  FOR EACH ROW EXECUTE FUNCTION app_private.live_join_request_event();
