-- Report §30.3: an organization's 200-channel limit leaves #general out; it is always there and can't be removed.
CREATE OR REPLACE FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_workspace_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspaces p
    WHERE p.id = p_project_id AND p.kind = 'organization' AND p.owner_id <> p_creator
      AND NOT coalesce((p.org_settings->>'membersCreateChannels')::boolean, p.org_type IS DISTINCT FROM 'education')
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = p_creator AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_channels_admins_only';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
  END IF;
  -- Serialize channel creation per project so the 200-channel limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-project-channels:' || p_project_id::text, 0));
  IF (
    SELECT count(*) FROM public.chat_channels
    WHERE workspace_id = p_project_id AND application_id IS NULL AND archived_at IS NULL AND NOT is_default
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(ARRAY[p_creator]);

  INSERT INTO public.chat_channels (kind, name, description, workspace_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$_$;
--> statement-breakpoint
-- Report §37.8, decision 103: followers of a public organization aren't its members. Joining ends the follow
-- quietly, and the count moves with it; leaving later doesn't bring it back.
CREATE FUNCTION app_private.org_member_ends_follow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_removed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.kind = 'organization') THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.workspace_follows f WHERE f.workspace_id = NEW.workspace_id AND f.user_id = NEW.user_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    UPDATE public.workspaces SET followers_count = greatest(followers_count - v_removed, 0) WHERE id = NEW.workspace_id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.org_member_ends_follow() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER org_member_ends_follow AFTER INSERT ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION app_private.org_member_ends_follow();
